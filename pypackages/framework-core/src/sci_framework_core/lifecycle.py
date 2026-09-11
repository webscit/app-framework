"""Shared simulation start/stop task-lifecycle bookkeeping.

``LifecycleConsumer`` extracts the cancel-then-launch task bookkeeping that
domain consumers (e.g. drone, reachy_mini) currently duplicate around their
own FMU/choreography-specific ``run()`` logic. Domain apps subclass it and
implement ``apply_params`` and ``run``; everything else (task tracking,
cancellation, payload unwrapping) is handled here.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any

from .bus import BaseEvent, EventBus

logger = logging.getLogger(__name__)


class SimulationStateEvent(BaseEvent):
    """Generic state payload published on a simulation's state channel.

    Domain apps may subclass this to add fields (e.g. a ``verdict`` field),
    the same way ``DroneStateEvent``/``ReachyStateEvent`` do today — this
    class only needs to satisfy ``LifecycleConsumer``'s bookkeeping, not
    replace domain-specific event types.
    """

    phase: str
    """Current lifecycle phase, e.g. ``"idle"``, ``"running"``, ``"done"``."""

    message: str = ""
    """Optional human-readable detail about the current phase."""


class LifecycleConsumer(ABC):
    """Owns the running-task lifecycle for a start/stop-shaped simulation.

    Subclasses implement ``apply_params`` (synchronous parameter overrides
    from a control payload) and ``run`` (one simulation run to completion,
    publishing ``SimulationStateEvent``s as it goes). This base class handles
    cancel-then-launch bookkeeping on ``"start"``/``"stop"`` commands and
    cancellation on a second ``"start"`` while one run is already active.

    Args:
        bus: Shared EventBus used to publish state events and run the task.
        state_channel: Channel this consumer's ``run()`` implementation
            should publish ``SimulationStateEvent``s to.
    """

    def __init__(self, bus: EventBus, state_channel: str) -> None:
        self._bus = bus
        self.state_channel = state_channel
        self._task: asyncio.Task[None] | None = None

    async def __call__(self, channel: str, message: BaseEvent) -> None:
        """Handle an incoming control-channel event.

        Args:
            channel: The channel the event arrived on.
            message: The raw event from the EventBus. Frontend publishes
                arrive wrapped in a ``payload`` field — unwrapped here to
                match the existing ``_ClientPublishEvent`` convention.

        Returns:
            None. Non-dict payloads are silently ignored.
        """
        data = message.model_dump()
        payload = data.get("payload", data)
        if not isinstance(payload, dict):
            return
        self.apply_params(payload)
        await self._handle_command(payload.get("command"))

    async def _handle_command(self, command: str | None) -> None:
        """Execute a lifecycle command.

        Args:
            command: ``"start"`` cancels any running task then launches a new
                one via ``run()``. ``"stop"`` cancels the running task. Any
                other value (including ``None``) is a no-op, leaving room for
                subclasses to handle their own commands (e.g. ``"reset"``) in
                ``apply_params`` without conflicting with this base class.

        Returns:
            None.
        """
        if command == "start":
            await self._cancel_running()
            self._task = asyncio.create_task(self.run())
            self._task.add_done_callback(self._log_unretrieved_exception)
        elif command == "stop":
            await self._cancel_running()

    async def _cancel_running(self) -> None:
        """Cancel the active run task, if any, and clear it.

        Returns:
            None.
        """
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Simulation task raised during cancellation")
        self._task = None

    @staticmethod
    def _log_unretrieved_exception(task: asyncio.Task[None]) -> None:
        """Surface an exception from a run task that nothing else awaited.

        Attached as a done-callback on the task created for a ``"start"``
        command. Without this, an exception raised by ``run()`` and never
        retrieved (because no subsequent ``"stop"``/``"start"`` awaited the
        task via ``_cancel_running``) would only surface as an asyncio
        "exception was never retrieved" warning when the task is garbage
        collected.

        Args:
            task: The completed task, passed by asyncio's done-callback
                protocol.

        Returns:
            None.
        """
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(
                "Simulation run task raised an unhandled exception", exc_info=exc
            )

    @abstractmethod
    def apply_params(self, payload: dict[str, Any]) -> None:
        """Apply domain-specific parameter overrides from a control payload.

        Args:
            payload: Unwrapped control-event payload dict.

        Returns:
            None.
        """

    @abstractmethod
    async def run(self) -> None:
        """Run one simulation to completion, publishing SimulationStateEvents.

        Returns:
            None. Implementations should be cancellation-safe: on
            ``asyncio.CancelledError`` they should stop cleanly (the base
            class re-raises after catching it in ``_cancel_running``).
        """
