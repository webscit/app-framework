"""Reachy Mini choreography producer — event types, safety checking, and runner.

The choreography runner drives an in-process MuJoCo simulation of the Reachy
Mini (see :mod:`sim`), publishing live telemetry, safety margins, rendered
frames, and state transitions to the EventBus. Running the simulation in our
own process — rather than over the SDK/daemon — is what lets the dashboard
show the robot's body directly, with no separate viewer window.

The renderer is dependency-injected as a :class:`RobotRenderer` so this module
stays importable and unit-testable without the heavy ``mujoco`` / ``reachy_mini``
native dependencies (which only ship for the Python version the daemon uses).
"""

from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass, field
from typing import Protocol

from framework_core.bus import BaseEvent, EventBus

logger = logging.getLogger(__name__)


class RobotRenderer(Protocol):
    """Renders the robot at a commanded step into JPEG frame bytes.

    Implemented by :class:`sim.ChoreographySimulator`; tests inject a fake.
    """

    async def render_step(self, step: ChoreographyStep) -> bytes:
        """Return JPEG bytes of the robot rendered at *step*'s pose."""
        ...


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


class ReachyFrameEvent(BaseEvent):
    """A rendered frame of the robot, published after each executed step."""

    step: int
    """Choreography step index the frame depicts."""

    loop: int
    """Loop index the frame depicts."""

    image: str
    """``data:image/jpeg;base64,...`` URL of the ``studio_close`` camera render."""


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

    sequence: list[dict[str, str | float]] | None = None
    """New choreography sequence as a list of step-factor dicts (``label``,
    ``roll_factor``, ``z_factor``, ``antenna_factor``), or ``None`` if unchanged."""

    preset: str | None = None
    """Apply a named preset: ``"safe"`` | ``"aggressive"`` | ``None``."""

    command: str | None = None
    """Lifecycle command: ``"start"`` | ``"stop"`` | ``"reset"`` | ``None``."""


# ─── Choreography sequence definition ─────────────────────────────────────────


@dataclass
class StepSpec:
    """One step in a choreography sequence, expressed as amplitude factors.

    A step is resolved into an executable :class:`ChoreographyStep` by
    multiplying these factors against the live amplitude/duration params at
    build time (see :func:`build_steps`). This indirection is what lets the
    sequence itself be replaced — e.g. from a frontend-authored widget, or an
    AI-suggested fix — without changing how amplitudes are interpreted.
    """

    label: str
    """Human-readable name for this step, e.g. ``"tilt_right"``."""

    roll_factor: float = 0.0
    """Multiplier applied to ``roll_amplitude_deg``."""

    z_factor: float = 0.0
    """Multiplier applied to ``z_amplitude_mm``."""

    antenna_factor: float = 0.0
    """Multiplier applied to ``antenna_amplitude``; the right antenna gets
    the negated value, so a positive factor wiggles the antennas apart."""


DEFAULT_SEQUENCE: list[StepSpec] = [
    StepSpec(label="tilt_right", roll_factor=1.0),
    StepSpec(label="tilt_left", roll_factor=-1.0),
    StepSpec(
        label="raise_tilt_wiggle", roll_factor=0.5, z_factor=1.0, antenna_factor=1.0
    ),
    StepSpec(label="home"),
]
"""Default 4-step greeting sequence: tilt right, tilt left, raise+tilt+wiggle, home."""


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
    """Number of times to repeat the sequence."""

    sequence: list[StepSpec] = field(default_factory=lambda: list(DEFAULT_SEQUENCE))
    """The choreography sequence as step factors. Defaults to the 4-step
    greeting routine; can be replaced wholesale to define a custom
    choreography (e.g. from a frontend-authored widget) without touching
    :func:`build_steps`."""


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
    """Index within the sequence."""

    label: str
    """Human-readable name carried over from the originating :class:`StepSpec`."""

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
    """Resolve ``params.sequence`` into an executable list of steps.

    Each :class:`StepSpec` factor is multiplied against the live amplitude
    and duration params to produce a concrete :class:`ChoreographyStep`.
    Swapping ``params.sequence`` (e.g. from a frontend-authored widget, or an
    AI-suggested fix) changes the resulting choreography without any change
    here.

    Args:
        params: Current choreography parameters, including the sequence.

    Returns:
        List of :class:`ChoreographyStep` objects, one per entry in
        ``params.sequence``.
    """
    return [
        ChoreographyStep(
            step_idx=idx,
            label=spec.label,
            roll_deg=spec.roll_factor * params.roll_amplitude_deg,
            z_mm=spec.z_factor * params.z_amplitude_mm,
            antenna_l=spec.antenna_factor * params.antenna_amplitude,
            antenna_r=-spec.antenna_factor * params.antenna_amplitude,
            duration_s=params.step_duration_s,
        )
        for idx, spec in enumerate(params.sequence)
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

HOME_STEP = ChoreographyStep(
    step_idx=0,
    label="home",
    roll_deg=0.0,
    z_mm=0.0,
    antenna_l=0.0,
    antenna_r=0.0,
    duration_s=1.0,
)
"""The robot's neutral resting pose — used to render an idle frame at startup."""


async def _pace(seconds: float) -> None:
    """Sleep between steps to play the run back at a watchable rate.

    A module-level indirection (rather than calling ``asyncio.sleep``
    directly) so tests can control run pacing without patching the global
    ``asyncio.sleep`` that test scaffolding itself relies on.
    """
    await asyncio.sleep(seconds)


async def _publish_frame(
    bus: EventBus, renderer: RobotRenderer, step: ChoreographyStep, loop: int
) -> None:
    """Render *step* and publish it as a ``reachy/frame`` event."""
    jpeg = await renderer.render_step(step)
    encoded = base64.b64encode(jpeg).decode("ascii")
    await bus.publish(
        "reachy/frame",
        ReachyFrameEvent(
            step=step.step_idx,
            loop=loop,
            image=f"data:image/jpeg;base64,{encoded}",
        ),
    )


async def publish_idle_frame(bus: EventBus, renderer: RobotRenderer) -> None:
    """Render the robot at its resting pose and publish it once.

    Called at startup so the dashboard shows the robot immediately — and so a
    later run that is blocked for a safety violation visibly leaves the robot
    sitting in this pose (the unsafe move was refused), rather than showing a
    blank panel. Failures are logged and swallowed so startup never breaks.
    """
    try:
        await _publish_frame(bus, renderer, HOME_STEP, loop=0)
    except Exception:
        logger.exception("Failed to render the initial idle frame")


async def run_choreography(
    bus: EventBus,
    params: ChoreographyParams,
    renderer: RobotRenderer | None = None,
) -> None:
    """Run the choreography against the in-process simulation.

    For each step, safety is evaluated against the commanded values *before*
    the move is rendered — an unsafe step is never executed, and the run stops
    immediately. Safe steps are rendered via *renderer* and published as
    telemetry, safety, and frame events, paced by each step's duration.

    Args:
        bus: The shared EventBus to publish events on.
        params: Choreography parameters (may be mutated by the consumer between runs).
        renderer: Robot renderer producing JPEG frames per step. When ``None``
            (e.g. if the simulation failed to initialise), the run proceeds
            without publishing frames.

    Raises:
        asyncio.CancelledError: When the consumer calls stop — re-raised after cleanup.
    """
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
        for loop_idx in range(params.num_loops):
            for step in steps:
                # Evaluate safety against the commanded values *before*
                # rendering the move — an unsafe step must never be executed,
                # since these values are known statically up front.
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
                                f"move not executed"
                            ),
                        ),
                    )
                    return

                # Render the robot at this pose (skipped if no renderer).
                if renderer is not None:
                    await _publish_frame(bus, renderer, step, loop_idx)

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

                # Pace the run by the step duration so the dashboard plays back
                # at a watchable rate, like a real movement taking this long.
                await _pace(step.duration_s)

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
