"""Drone control consumer — handles ``drone/control`` events from the frontend.

Subscribes to ``drone/control`` and:
- Applies parameter updates (individual manoeuvre fields or a named preset) to
  the shared :class:`~manoeuvre.ManoeuvreParams`.
- Executes lifecycle commands: ``"start"`` (run the manoeuvre on a fresh FMU
  instance), ``"stop"`` (cancel a running task), ``"reset"`` (cancel + restore
  the aggressive preset).

The FMU is created per run via an injected ``fmu_factory`` so the consumer is
testable with a stub and the heavy FMPy import stays in ``main.py``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from framework_core.bus import BaseEvent, EventBus

from .events import DroneLogEvent, DroneStateEvent
from .fmu_runner import Fmu, run_manoeuvre
from .manoeuvre import AGGRESSIVE_PRESET, GENTLE_PRESET, ManoeuvreParams

logger = logging.getLogger(__name__)

FmuFactory = Callable[[], Fmu | None]
"""Zero-arg callable that returns a fresh, initialised FMU (or ``None``)."""


class ControlConsumer:
    """Stateful consumer that owns the active manoeuvre task.

    One instance per application lifetime, registered via
    :func:`register_consumers`.

    Args:
        bus: Shared EventBus used to publish state/log events and run the
            manoeuvre.
        params: Shared :class:`~manoeuvre.ManoeuvreParams` mutated in-place on
            parameter updates.
        fmu_factory: Builds a fresh initialised FMU per run. If it returns
            ``None`` (FMU unavailable) the start command is reported as an error
            instead of crashing.
    """

    def __init__(
        self,
        bus: EventBus,
        params: ManoeuvreParams,
        fmu_factory: FmuFactory,
    ) -> None:
        self._bus = bus
        self._params = params
        self._fmu_factory = fmu_factory
        self._task: asyncio.Task[None] | None = None

    async def __call__(self, channel: str, message: BaseEvent) -> None:
        """Handle an incoming ``drone/control`` event.

        Args:
            channel: The channel the event arrived on (``drone/control``).
            message: The raw event from the EventBus.
        """
        data = message.model_dump()
        # Frontend publishes arrive wrapped in _ClientPublishEvent — unwrap.
        payload: dict[str, Any] = data.get("payload", data)
        if not isinstance(payload, dict):
            return

        self._apply_params(payload)
        await self._handle_command(payload.get("command"))

    # ── Private helpers ───────────────────────────────────────────────────────

    def _apply_params(self, payload: dict[str, Any]) -> None:
        """Apply a named preset then any individual field overrides.

        Args:
            payload: Deserialised control event dict.
        """
        preset = payload.get("preset")
        if preset == "gentle":
            self._copy_preset(GENTLE_PRESET)
            logger.info("Applied GENTLE preset")
        elif preset == "aggressive":
            self._copy_preset(AGGRESSIVE_PRESET)
            logger.info("Applied AGGRESSIVE preset")

        _set_float(self._params, "setpoint_step_m", payload.get("setpoint_step_m"))
        _set_float(
            self._params, "change_frequency_hz", payload.get("change_frequency_hz")
        )
        _set_int(self._params, "num_segments", payload.get("num_segments"))

    def _copy_preset(self, preset: ManoeuvreParams) -> None:
        """Overwrite all params from *preset* in-place."""
        self._params.setpoint_step_m = preset.setpoint_step_m
        self._params.change_frequency_hz = preset.change_frequency_hz
        self._params.num_segments = preset.num_segments

    async def _handle_command(self, command: str | None) -> None:
        """Execute a lifecycle command.

        - ``"start"``: cancel any running task, then launch a new one.
        - ``"stop"``: cancel the running task.
        - ``"reset"``: cancel + restore the aggressive preset.
        - ``None``: no-op.

        Args:
            command: The lifecycle command string, or ``None``.
        """
        if command == "start":
            await self._cancel_running()
            fmu = self._fmu_factory()
            if fmu is None:
                await self._bus.publish(
                    "drone/state",
                    DroneStateEvent(
                        phase="idle",
                        verdict="",
                        message="FMU unavailable — cannot start (see backend logs)",
                    ),
                )
                logger.error("FMU factory returned None; start aborted")
                return
            self._task = asyncio.create_task(self._run(fmu))
            logger.info("Manoeuvre task started")

        elif command == "stop":
            await self._cancel_running()

        elif command == "reset":
            await self._cancel_running()
            self._copy_preset(AGGRESSIVE_PRESET)
            await self._bus.publish(
                "drone/state",
                DroneStateEvent(
                    phase="idle",
                    verdict="",
                    message="Parameters reset to aggressive preset",
                ),
            )
            await self._bus.publish(
                "drone/log",
                DroneLogEvent(
                    level="info",
                    message="Reset — params restored to aggressive preset",
                ),
            )
            logger.info("Parameters reset to aggressive preset")

    async def _run(self, fmu: Fmu) -> None:
        """Run the manoeuvre on *fmu*, freeing it afterwards if it supports it."""
        try:
            await run_manoeuvre(self._bus, replace(self._params), fmu)
        finally:
            terminate = getattr(fmu, "terminate", None)
            if callable(terminate):
                try:
                    terminate()
                except Exception:  # pragma: no cover - depends on FMU state
                    logger.exception("FMU terminate failed")

    async def _cancel_running(self) -> None:
        """Cancel the active manoeuvre task if one is running."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Manoeuvre task raised during cancellation")
        self._task = None


# ── Field helpers ─────────────────────────────────────────────────────────────


def _set_float(params: ManoeuvreParams, field: str, value: object) -> None:
    """Set *field* on *params* to ``float(value)`` if value is not None."""
    if value is None:
        return
    try:
        setattr(params, field, float(value))
    except (TypeError, ValueError):
        logger.warning("Invalid value for %s: %r", field, value)


def _set_int(params: ManoeuvreParams, field: str, value: object) -> None:
    """Set *field* on *params* to ``int(value)`` if value is not None."""
    if value is None:
        return
    try:
        setattr(params, field, int(value))
    except (TypeError, ValueError):
        logger.warning("Invalid value for %s: %r", field, value)


# ── Registration ──────────────────────────────────────────────────────────────


def register_consumers(
    bus: EventBus,
    params: ManoeuvreParams,
    fmu_factory: FmuFactory,
) -> None:
    """Register the drone control consumer on the EventBus.

    Args:
        bus: The shared EventBus to subscribe on.
        params: The shared :class:`~manoeuvre.ManoeuvreParams` instance.
        fmu_factory: Builds a fresh initialised FMU per run.
    """
    consumer = ControlConsumer(bus, params, fmu_factory)
    bus.subscribe("drone/control", consumer)
