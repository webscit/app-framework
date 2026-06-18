"""Reachy Mini choreography producer — event types, safety checking, and runner.

The choreography runner drives the Reachy Mini simulation via the official SDK,
publishing live telemetry, safety margins, and state transitions to the EventBus.

``reachy_mini`` is imported lazily inside ``run_choreography`` so the module is
importable and testable without the SDK installed.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from framework_core.bus import BaseEvent, EventBus

logger = logging.getLogger(__name__)

# ─── Safety limits ────────────────────────────────────────────────────────────

ROLL_WARN_DEG: float = 30.0
"""Head roll warning threshold (degrees, absolute value)."""

ROLL_VIOLATION_DEG: float = 40.0
"""Head roll violation threshold (degrees, absolute value)."""

Z_WARN_MM: float = 25.0
"""Head vertical position warning threshold (mm)."""

Z_VIOLATION_MM: float = 35.0
"""Head vertical position violation threshold (mm)."""

DURATION_WARN_S: float = 0.5
"""Step duration warning threshold (seconds) — below this is too fast."""

DURATION_VIOLATION_S: float = 0.3
"""Step duration violation threshold (seconds) — below this causes instability."""

# ─── Event types ──────────────────────────────────────────────────────────────


class ReachyTelemetryEvent(BaseEvent):
    """Live head pose sample published after each goto_target() call."""

    step: int
    """Choreography step index within the current loop (0–3)."""

    loop: int
    """Loop index (0-based)."""

    roll_deg: float
    """Commanded head roll angle in degrees."""

    z_mm: float
    """Commanded head vertical position in millimetres."""

    antenna_l: float
    """Left antenna position (range ≈ -0.6 to 0.6)."""

    antenna_r: float
    """Right antenna position (range ≈ -0.6 to 0.6)."""

    duration_s: float
    """Duration of this movement step in seconds."""


class ReachySafetyEvent(BaseEvent):
    """Safety margin assessment for a single movement step."""

    step: int
    """Choreography step index."""

    loop: int
    """Loop index."""

    roll_margin_deg: float
    """Degrees to roll violation limit (positive = safe, negative = violated)."""

    z_margin_mm: float
    """Millimetres to z violation limit (positive = safe, negative = violated)."""

    duration_margin_s: float
    """Seconds above the violation threshold (positive = safe, negative = too fast)."""

    status: str
    """Overall status: ``"ok"`` | ``"warning"`` | ``"violation"``."""

    violated_axes: list[str]
    """Axes that crossed the violation threshold, e.g. ``["roll", "duration"]``."""

    warning_axes: list[str]
    """Axes approaching their limit but not yet violated, e.g. ``["roll"]``."""


class ReachyStateEvent(BaseEvent):
    """Simulation phase transition event."""

    phase: str
    """Current phase: ``"idle"`` | ``"running"`` | ``"warning"``
    | ``"violation"`` | ``"done"``."""

    verdict: str
    """Run verdict: ``"PASS"`` | ``"FAIL"`` | ``""`` (empty until run completes)."""

    message: str
    """Human-readable description of the transition."""


class ReachyLogEvent(BaseEvent):
    """Human-readable log message from the choreography runner."""

    level: str
    """Log level: ``"info"`` | ``"warning"`` | ``"error"``."""

    message: str
    """Log message text."""


class ReachyControlEvent(BaseEvent):
    """Parameter update or lifecycle command published by the frontend."""

    roll_amplitude_deg: float | None = None
    """New roll amplitude in degrees, or ``None`` if unchanged."""

    z_amplitude_mm: float | None = None
    """New z amplitude in millimetres, or ``None`` if unchanged."""

    step_duration_s: float | None = None
    """New step duration in seconds, or ``None`` if unchanged."""

    antenna_amplitude: float | None = None
    """New antenna amplitude (0.0–0.6), or ``None`` if unchanged."""

    num_loops: int | None = None
    """New loop count, or ``None`` if unchanged."""

    preset: str | None = None
    """Apply a named preset: ``"safe"`` | ``"aggressive"`` | ``None``."""

    command: str | None = None
    """Lifecycle command: ``"start"`` | ``"stop"`` | ``"reset"`` | ``None``."""


# ─── Parameters and presets ───────────────────────────────────────────────────


@dataclass
class ChoreographyParams:
    """Mutable choreography parameters shared between the consumer and runner.

    Updated at runtime when the frontend publishes to ``reachy/control``.
    """

    roll_amplitude_deg: float = 15.0
    """Maximum head roll angle in degrees."""

    z_amplitude_mm: float = 15.0
    """Maximum head vertical travel in millimetres."""

    step_duration_s: float = 1.0
    """Duration of each movement step in seconds."""

    antenna_amplitude: float = 0.4
    """Antenna wiggle amplitude (0.0–0.6)."""

    num_loops: int = 2
    """Number of times to repeat the 4-step sequence."""


SAFE_PRESET = ChoreographyParams(
    roll_amplitude_deg=15.0,
    z_amplitude_mm=15.0,
    step_duration_s=1.0,
    antenna_amplitude=0.4,
    num_loops=2,
)
"""Conservative parameters — all steps remain within safe limits."""

AGGRESSIVE_PRESET = ChoreographyParams(
    roll_amplitude_deg=42.0,
    z_amplitude_mm=36.0,
    step_duration_s=0.25,
    antenna_amplitude=0.6,
    num_loops=2,
)
"""Intentionally unsafe parameters — triggers roll + z + duration violations."""

# ─── Choreography step ────────────────────────────────────────────────────────


@dataclass
class ChoreographyStep:
    """A single commanded pose within the choreography sequence."""

    step_idx: int
    """Index within the 4-step sequence (0–3)."""

    roll_deg: float
    """Head roll angle for this step (degrees)."""

    z_mm: float
    """Head vertical position for this step (mm)."""

    antenna_l: float
    """Left antenna position."""

    antenna_r: float
    """Right antenna position."""

    duration_s: float
    """Duration of this movement (seconds)."""


# ─── Pure helpers ─────────────────────────────────────────────────────────────


def build_steps(params: ChoreographyParams) -> list[ChoreographyStep]:
    """Return the 4-step choreography sequence for the given parameters.

    The sequence is:
    0. Tilt right (roll = +amplitude)
    1. Tilt left  (roll = -amplitude)
    2. Raise and tilt right + wiggle antennas
    3. Return to home position

    Args:
        params: Current choreography parameters.

    Returns:
        List of four :class:`ChoreographyStep` objects.
    """
    a = params.antenna_amplitude
    d = params.step_duration_s
    return [
        ChoreographyStep(
            step_idx=0,
            roll_deg=params.roll_amplitude_deg,
            z_mm=0.0,
            antenna_l=0.0,
            antenna_r=0.0,
            duration_s=d,
        ),
        ChoreographyStep(
            step_idx=1,
            roll_deg=-params.roll_amplitude_deg,
            z_mm=0.0,
            antenna_l=0.0,
            antenna_r=0.0,
            duration_s=d,
        ),
        ChoreographyStep(
            step_idx=2,
            roll_deg=params.roll_amplitude_deg * 0.5,
            z_mm=params.z_amplitude_mm,
            antenna_l=a,
            antenna_r=-a,
            duration_s=d,
        ),
        ChoreographyStep(
            step_idx=3,
            roll_deg=0.0,
            z_mm=0.0,
            antenna_l=0.0,
            antenna_r=0.0,
            duration_s=d,
        ),
    ]


def compute_safety(
    roll_deg: float,
    z_mm: float,
    duration_s: float,
    step: int,
    loop: int,
) -> ReachySafetyEvent:
    """Compute safety margins and status for a single movement step.

    This is a pure function — it has no side effects and does not publish
    to the bus, making it straightforward to unit test.

    Args:
        roll_deg: Commanded head roll angle in degrees (positive or negative).
        z_mm: Commanded head vertical position in millimetres.
        duration_s: Duration of the movement step in seconds.
        step: Step index within the loop (0–3).
        loop: Loop index (0-based).

    Returns:
        :class:`ReachySafetyEvent` with margins, status, and violated axes.
    """
    abs_roll = abs(roll_deg)
    roll_margin = ROLL_VIOLATION_DEG - abs_roll
    z_margin = Z_VIOLATION_MM - z_mm
    duration_margin = duration_s - DURATION_VIOLATION_S

    violated_axes: list[str] = []
    warning_axes: list[str] = []

    if abs_roll >= ROLL_VIOLATION_DEG:
        violated_axes.append("roll")
    elif abs_roll > ROLL_WARN_DEG:
        warning_axes.append("roll")

    if z_mm >= Z_VIOLATION_MM:
        violated_axes.append("z")
    elif z_mm > Z_WARN_MM:
        warning_axes.append("z")

    if duration_s <= DURATION_VIOLATION_S:
        violated_axes.append("duration")
    elif duration_s < DURATION_WARN_S:
        warning_axes.append("duration")

    if violated_axes:
        status = "violation"
    elif warning_axes:
        status = "warning"
    else:
        status = "ok"

    return ReachySafetyEvent(
        step=step,
        loop=loop,
        roll_margin_deg=roll_margin,
        z_margin_mm=z_margin,
        duration_margin_s=duration_margin,
        status=status,
        violated_axes=violated_axes,
        warning_axes=warning_axes,
    )


# ─── Choreography runner ──────────────────────────────────────────────────────


async def run_choreography(bus: EventBus, params: ChoreographyParams) -> None:
    """Connect to the Reachy Mini simulation and run the choreography sequence.

    Publishes telemetry, safety, state, and log events to the bus on each step.
    Stops immediately if a safety violation is detected.

    ``reachy_mini`` is imported lazily so the module can be used and tested
    without the SDK installed. The SDK (and the daemon) must be running before
    this coroutine is awaited.

    Args:
        bus: The shared EventBus to publish events on.
        params: Choreography parameters (may be mutated by the consumer between runs).

    Raises:
        asyncio.CancelledError: When the consumer calls stop — re-raised after cleanup.
    """
    # Lazy import — only fails at call time, not at module import time.
    from reachy_mini import ReachyMini  # type: ignore[import-untyped]
    from reachy_mini.utils import create_head_pose  # type: ignore[import-untyped]

    await bus.publish(
        "reachy/state",
        ReachyStateEvent(phase="running", verdict="", message="Choreography started"),
    )
    await bus.publish(
        "reachy/log",
        ReachyLogEvent(
            level="info",
            message=(
                f"Starting {params.num_loops} loop(s) — "
                f"roll={params.roll_amplitude_deg}°, "
                f"z={params.z_amplitude_mm}mm, "
                f"duration={params.step_duration_s}s"
            ),
        ),
    )

    steps = build_steps(params)

    try:
        with ReachyMini() as mini:
            for loop_idx in range(params.num_loops):
                for step in steps:
                    # Evaluate safety against the commanded values *before*
                    # sending the move — an unsafe step must never reach the
                    # SDK, since these values are known statically up front.
                    safety = compute_safety(
                        roll_deg=step.roll_deg,
                        z_mm=step.z_mm,
                        duration_s=step.duration_s,
                        step=step.step_idx,
                        loop=loop_idx,
                    )

                    if safety.status == "violation":
                        await bus.publish("reachy/safety", safety)
                        await bus.publish(
                            "reachy/state",
                            ReachyStateEvent(
                                phase="violation",
                                verdict="FAIL",
                                message=(
                                    f"Loop {loop_idx} step {step.step_idx}: VIOLATION "
                                    f"on {safety.violated_axes} — move blocked"
                                ),
                            ),
                        )
                        await bus.publish(
                            "reachy/log",
                            ReachyLogEvent(
                                level="error",
                                message=(
                                    f"Step {step.step_idx} VIOLATION: axes "
                                    f"{safety.violated_axes} exceeded limits — "
                                    f"move not sent"
                                ),
                            ),
                        )
                        return

                    head = create_head_pose(
                        z=step.z_mm,
                        roll=step.roll_deg,
                        mm=True,
                        degrees=True,
                    )
                    # goto_target is synchronous and blocks for `duration` seconds.
                    # Run in a thread so the event loop stays responsive.
                    await asyncio.to_thread(
                        lambda s=step, h=head: mini.goto_target(
                            head=h,
                            antennas=[s.antenna_l, s.antenna_r],
                            duration=s.duration_s,
                        )
                    )

                    telemetry = ReachyTelemetryEvent(
                        step=step.step_idx,
                        loop=loop_idx,
                        roll_deg=step.roll_deg,
                        z_mm=step.z_mm,
                        antenna_l=step.antenna_l,
                        antenna_r=step.antenna_r,
                        duration_s=step.duration_s,
                    )
                    await bus.publish("reachy/telemetry", telemetry)
                    await bus.publish("reachy/safety", safety)

                    if safety.status == "warning":
                        await bus.publish(
                            "reachy/state",
                            ReachyStateEvent(
                                phase="warning",
                                verdict="",
                                message=(
                                    f"Loop {loop_idx} step {step.step_idx}: "
                                    f"warning on {safety.warning_axes}"
                                ),
                            ),
                        )
                        await bus.publish(
                            "reachy/log",
                            ReachyLogEvent(
                                level="warning",
                                message=(
                                    f"Step {step.step_idx}: approaching limits on "
                                    f"{safety.warning_axes}"
                                ),
                            ),
                        )

        await bus.publish(
            "reachy/state",
            ReachyStateEvent(
                phase="done", verdict="PASS", message="All steps completed safely"
            ),
        )
        await bus.publish(
            "reachy/log",
            ReachyLogEvent(level="info", message="Choreography complete — PASS"),
        )

    except asyncio.CancelledError:
        await bus.publish(
            "reachy/state",
            ReachyStateEvent(phase="idle", verdict="", message="Run stopped by user"),
        )
        await bus.publish(
            "reachy/log",
            ReachyLogEvent(level="info", message="Run cancelled"),
        )
        raise

    except Exception as exc:
        logger.exception("Choreography run failed with an unexpected error")
        await bus.publish(
            "reachy/state",
            ReachyStateEvent(
                phase="violation", verdict="FAIL", message=f"Run failed: {exc}"
            ),
        )
        await bus.publish(
            "reachy/log",
            ReachyLogEvent(level="error", message=f"Unhandled error: {exc}"),
        )
