"""Reachy Mini control consumer — handles reachy/control events from the frontend.

Subscribes to the ``reachy/control`` channel and:
- Applies parameter updates (individual fields or named presets) to the shared
  :class:`~producers.ChoreographyParams` instance.
- Executes lifecycle commands: ``"start"`` (launch a new run), ``"stop"``
  (cancel a running task), and ``"reset"`` (cancel + restore the default preset).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from framework_core.bus import BaseEvent, EventBus

from .producers import (
    AGGRESSIVE_PRESET,
    SAFE_PRESET,
    ChoreographyParams,
    ReachyLogEvent,
    ReachyStateEvent,
    run_choreography,
)

logger = logging.getLogger(__name__)


class ControlConsumer:
    """Stateful consumer that owns the active choreography task.

    One instance should be created per application lifetime and registered
    via :func:`register_consumers`.

    Args:
        bus: The shared EventBus used to publish state/log events and to
            launch :func:`~producers.run_choreography`.
        params: The shared :class:`~producers.ChoreographyParams` that is
            mutated in-place when the frontend sends parameter updates.
    """

    def __init__(self, bus: EventBus, params: ChoreographyParams) -> None:
        self._bus = bus
        self._params = params
        self._task: asyncio.Task[None] | None = None

    async def __call__(self, channel: str, message: BaseEvent) -> None:
        """Handle an incoming ``reachy/control`` event.

        Delegates to :meth:`_apply_params` then :meth:`_handle_command`.

        Args:
            channel: The channel the event arrived on (always ``reachy/control``).
            message: The raw event from the EventBus.
        """
        data = message.model_dump()
        # Frontend publishes arrive wrapped in _ClientPublishEvent — unwrap payload
        payload: dict[str, Any] = data.get("payload", data)
        if not isinstance(payload, dict):
            return

        self._apply_params(payload)
        await self._handle_command(payload.get("command"))

    # ── Private helpers ───────────────────────────────────────────────────────

    def _apply_params(self, payload: dict[str, Any]) -> None:
        """Apply parameter fields and/or a named preset from a control payload.

        A named preset (``preset: "safe"`` or ``preset: "aggressive"``) is
        applied first, then individual fields override the preset values.

        Args:
            payload: Deserialised control event dict.
        """
        preset = payload.get("preset")
        if preset == "safe":
            self._copy_preset(SAFE_PRESET)
            logger.info("Applied SAFE preset")
        elif preset == "aggressive":
            self._copy_preset(AGGRESSIVE_PRESET)
            logger.info("Applied AGGRESSIVE preset")

        _set_float(
            self._params, "roll_amplitude_deg", payload.get("roll_amplitude_deg")
        )
        _set_float(self._params, "z_amplitude_mm", payload.get("z_amplitude_mm"))
        _set_float(self._params, "step_duration_s", payload.get("step_duration_s"))
        _set_float(self._params, "antenna_amplitude", payload.get("antenna_amplitude"))
        _set_int(self._params, "num_loops", payload.get("num_loops"))

    def _copy_preset(self, preset: ChoreographyParams) -> None:
        """Overwrite all params from *preset* in-place."""
        self._params.roll_amplitude_deg = preset.roll_amplitude_deg
        self._params.z_amplitude_mm = preset.z_amplitude_mm
        self._params.step_duration_s = preset.step_duration_s
        self._params.antenna_amplitude = preset.antenna_amplitude
        self._params.num_loops = preset.num_loops

    async def _handle_command(self, command: str | None) -> None:
        """Execute a lifecycle command.

        - ``"start"``: cancel any running task, then launch a new one.
        - ``"stop"``: cancel the running task (publishes idle state).
        - ``"reset"``: cancel the running task and restore the aggressive preset.
        - ``None``: no-op.

        Args:
            command: The lifecycle command string, or ``None``.
        """
        if command == "start":
            await self._cancel_running()
            self._task = asyncio.create_task(run_choreography(self._bus, self._params))
            logger.info("Choreography task started")

        elif command == "stop":
            await self._cancel_running()

        elif command == "reset":
            await self._cancel_running()
            self._copy_preset(AGGRESSIVE_PRESET)
            await self._bus.publish(
                "reachy/state",
                ReachyStateEvent(
                    phase="idle",
                    verdict="",
                    message="Parameters reset to aggressive preset",
                ),
            )
            await self._bus.publish(
                "reachy/log",
                ReachyLogEvent(
                    level="info",
                    message="Reset — params restored to aggressive preset",
                ),
            )
            logger.info("Parameters reset to aggressive preset")

    async def _cancel_running(self) -> None:
        """Cancel the active choreography task if one is running."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Choreography task raised during cancellation")
        self._task = None


# ── Field helpers ─────────────────────────────────────────────────────────────


def _set_float(params: ChoreographyParams, field: str, value: object) -> None:
    """Set *field* on *params* to *float(value)* if value is not None.

    Args:
        params: The params object to mutate.
        field: Attribute name on *params*.
        value: Incoming value from the payload dict, or ``None``.
    """
    if value is None:
        return
    try:
        setattr(params, field, float(value))
    except (TypeError, ValueError):
        logger.warning("Invalid value for %s: %r", field, value)


def _set_int(params: ChoreographyParams, field: str, value: object) -> None:
    """Set *field* on *params* to *int(value)* if value is not None.

    Args:
        params: The params object to mutate.
        field: Attribute name on *params*.
        value: Incoming value from the payload dict, or ``None``.
    """
    if value is None:
        return
    try:
        setattr(params, field, int(value))
    except (TypeError, ValueError):
        logger.warning("Invalid value for %s: %r", field, value)


# ── Registration ──────────────────────────────────────────────────────────────


def register_consumers(bus: EventBus, params: ChoreographyParams) -> None:
    """Register all Reachy Mini consumers on the EventBus.

    Creates a :class:`ControlConsumer` instance and subscribes it to the
    ``reachy/control`` channel.  Call this once inside the application
    lifespan, after the bus is available.

    Args:
        bus: The shared EventBus to subscribe consumers on.
        params: The shared :class:`~producers.ChoreographyParams` instance.
    """
    consumer = ControlConsumer(bus, params)
    bus.subscribe("reachy/control", consumer)
