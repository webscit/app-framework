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
    RobotRenderer,
    StepSpec,
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
        renderer: Robot renderer injected into each run so the dashboard
            receives rendered frames. ``None`` runs without frames.
    """

    def __init__(
        self,
        bus: EventBus,
        params: ChoreographyParams,
        renderer: RobotRenderer | None = None,
    ) -> None:
        self._bus = bus
        self._params = params
        self._renderer = renderer
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
        _set_sequence(self._params, payload.get("sequence"))

    def _copy_preset(self, preset: ChoreographyParams) -> None:
        """Overwrite all params from *preset* in-place."""
        self._params.roll_amplitude_deg = preset.roll_amplitude_deg
        self._params.z_amplitude_mm = preset.z_amplitude_mm
        self._params.step_duration_s = preset.step_duration_s
        self._params.antenna_amplitude = preset.antenna_amplitude
        self._params.num_loops = preset.num_loops
        self._params.sequence = list(preset.sequence)

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
            self._task = asyncio.create_task(
                run_choreography(self._bus, self._params, self._renderer)
            )
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


def _set_sequence(params: ChoreographyParams, value: object) -> None:
    """Replace ``params.sequence`` from a list of step-factor dicts, if valid.

    This is the hook a frontend-authored choreography widget (or an
    AI-suggested fix) uses to redefine the sequence itself, not just the
    amplitude/duration params. Invalid or empty input is logged and ignored
    so a malformed payload can never leave ``params`` with no steps.

    Args:
        params: The params object to mutate.
        value: Expected to be a list of dicts with keys ``label`` (str) and
            optional ``roll_factor``, ``z_factor``, ``antenna_factor``
            (floats, default 0.0), or ``None`` if unchanged.
    """
    if value is None:
        return
    if not isinstance(value, list) or not value:
        logger.warning("Invalid sequence value: %r", value)
        return
    try:
        new_sequence = [
            StepSpec(
                label=str(step.get("label", f"step_{idx}")),
                roll_factor=float(step.get("roll_factor", 0.0)),
                z_factor=float(step.get("z_factor", 0.0)),
                antenna_factor=float(step.get("antenna_factor", 0.0)),
            )
            for idx, step in enumerate(value)
        ]
    except (AttributeError, TypeError, ValueError):
        logger.warning("Invalid sequence entries: %r", value)
        return
    params.sequence = new_sequence
    logger.info("Applied custom sequence with %d step(s)", len(new_sequence))


# ── Registration ──────────────────────────────────────────────────────────────


def register_consumers(
    bus: EventBus,
    params: ChoreographyParams,
    renderer: RobotRenderer | None = None,
) -> None:
    """Register all Reachy Mini consumers on the EventBus.

    Creates a :class:`ControlConsumer` instance and subscribes it to the
    ``reachy/control`` channel.  Call this once inside the application
    lifespan, after the bus is available.

    Args:
        bus: The shared EventBus to subscribe consumers on.
        params: The shared :class:`~producers.ChoreographyParams` instance.
        renderer: Robot renderer injected into each run for dashboard frames.
    """
    consumer = ControlConsumer(bus, params, renderer)
    bus.subscribe("reachy/control", consumer)
