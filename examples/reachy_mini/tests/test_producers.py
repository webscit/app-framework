from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from framework_core.bus import EventBus

from examples.reachy_mini.backend.producers import (
    AGGRESSIVE_PRESET,
    DEFAULT_SEQUENCE,
    DURATION_VIOLATION_S,
    ROLL_VIOLATION_DEG,
    ROLL_WARN_DEG,
    SAFE_PRESET,
    Z_VIOLATION_MM,
    Z_WARN_MM,
    ChoreographyParams,
    ReachySafetyEvent,
    ReachyStateEvent,
    ReachyTelemetryEvent,
    StepSpec,
    build_steps,
    compute_safety,
    run_choreography,
)

# ─── compute_safety ───────────────────────────────────────────────────────────


def test_safety_check_ok() -> None:
    event = compute_safety(roll_deg=10.0, z_mm=10.0, duration_s=1.0, step=0, loop=0)
    assert event.status == "ok"
    assert event.violated_axes == []
    assert event.roll_margin_deg == pytest.approx(ROLL_VIOLATION_DEG - 10.0)
    assert event.z_margin_mm == pytest.approx(Z_VIOLATION_MM - 10.0)


def test_safety_check_warning_roll() -> None:
    roll = ROLL_WARN_DEG + 1.0
    event = compute_safety(roll_deg=roll, z_mm=5.0, duration_s=1.0, step=1, loop=0)
    assert event.status == "warning"
    assert event.violated_axes == []
    assert event.warning_axes == ["roll"]


def test_safety_check_warning_z() -> None:
    z = Z_WARN_MM + 1.0
    event = compute_safety(roll_deg=5.0, z_mm=z, duration_s=1.0, step=2, loop=0)
    assert event.status == "warning"
    assert event.violated_axes == []
    assert event.warning_axes == ["z"]


def test_safety_check_warning_duration() -> None:
    event = compute_safety(roll_deg=5.0, z_mm=5.0, duration_s=0.4, step=0, loop=0)
    assert event.status == "warning"
    assert event.violated_axes == []
    assert event.warning_axes == ["duration"]


def test_safety_check_violation_roll_at_exact_threshold() -> None:
    """Roll exactly at the violation threshold counts as a violation, not a warning."""
    event = compute_safety(
        roll_deg=ROLL_VIOLATION_DEG, z_mm=5.0, duration_s=1.0, step=0, loop=0
    )
    assert event.status == "violation"
    assert "roll" in event.violated_axes


def test_safety_check_violation_duration_at_exact_threshold() -> None:
    """A duration exactly at the violation threshold counts as a violation."""
    event = compute_safety(
        roll_deg=5.0, z_mm=5.0, duration_s=DURATION_VIOLATION_S, step=0, loop=0
    )
    assert event.status == "violation"
    assert "duration" in event.violated_axes


def test_safety_check_violation_roll() -> None:
    roll = ROLL_VIOLATION_DEG + 1.0
    event = compute_safety(roll_deg=roll, z_mm=5.0, duration_s=1.0, step=0, loop=0)
    assert event.status == "violation"
    assert "roll" in event.violated_axes


def test_safety_check_violation_z() -> None:
    z = Z_VIOLATION_MM + 1.0
    event = compute_safety(roll_deg=5.0, z_mm=z, duration_s=1.0, step=0, loop=0)
    assert event.status == "violation"
    assert "z" in event.violated_axes


def test_safety_check_violation_duration() -> None:
    event = compute_safety(roll_deg=5.0, z_mm=5.0, duration_s=0.2, step=0, loop=0)
    assert event.status == "violation"
    assert "duration" in event.violated_axes


def test_safety_check_violation_takes_precedence_over_warning() -> None:
    """Roll violation + z warning → overall status is violation, not warning."""
    roll = ROLL_VIOLATION_DEG + 1.0
    z = Z_WARN_MM + 1.0
    event = compute_safety(roll_deg=roll, z_mm=z, duration_s=1.0, step=0, loop=0)
    assert event.status == "violation"
    assert "roll" in event.violated_axes
    assert "z" not in event.violated_axes


def test_safety_check_negative_roll_is_checked_by_magnitude() -> None:
    """Negative roll angles are assessed by absolute value."""
    roll = -(ROLL_VIOLATION_DEG + 1.0)
    event = compute_safety(roll_deg=roll, z_mm=5.0, duration_s=1.0, step=0, loop=0)
    assert event.status == "violation"
    assert "roll" in event.violated_axes


def test_safety_check_step_and_loop_propagated() -> None:
    event = compute_safety(roll_deg=5.0, z_mm=5.0, duration_s=1.0, step=3, loop=2)
    assert event.step == 3
    assert event.loop == 2


# ─── build_steps ─────────────────────────────────────────────────────────────


def test_build_steps_returns_four_steps() -> None:
    params = ChoreographyParams()
    steps = build_steps(params)
    assert len(steps) == 4


def test_build_steps_indices() -> None:
    steps = build_steps(ChoreographyParams())
    assert [s.step_idx for s in steps] == [0, 1, 2, 3]


def test_build_steps_roll_amplitudes() -> None:
    params = ChoreographyParams(roll_amplitude_deg=20.0)
    steps = build_steps(params)
    assert steps[0].roll_deg == pytest.approx(20.0)  # tilt right
    assert steps[1].roll_deg == pytest.approx(-20.0)  # tilt left
    assert steps[2].roll_deg == pytest.approx(10.0)  # half amplitude
    assert steps[3].roll_deg == pytest.approx(0.0)  # home


def test_build_steps_z_amplitudes() -> None:
    params = ChoreographyParams(z_amplitude_mm=18.0)
    steps = build_steps(params)
    assert steps[0].z_mm == pytest.approx(0.0)
    assert steps[1].z_mm == pytest.approx(0.0)
    assert steps[2].z_mm == pytest.approx(18.0)
    assert steps[3].z_mm == pytest.approx(0.0)


def test_build_steps_antenna_amplitudes() -> None:
    params = ChoreographyParams(antenna_amplitude=0.5)
    steps = build_steps(params)
    assert steps[0].antenna_l == pytest.approx(0.0)
    assert steps[2].antenna_l == pytest.approx(0.5)
    assert steps[2].antenna_r == pytest.approx(-0.5)
    assert steps[3].antenna_l == pytest.approx(0.0)


def test_build_steps_duration_applied_to_all() -> None:
    params = ChoreographyParams(step_duration_s=0.8)
    steps = build_steps(params)
    assert all(s.duration_s == pytest.approx(0.8) for s in steps)


def test_build_steps_default_params_use_default_sequence() -> None:
    """Default ChoreographyParams resolves to the standard 4-step sequence."""
    params = ChoreographyParams()
    assert params.sequence == DEFAULT_SEQUENCE
    steps = build_steps(params)
    assert [s.label for s in steps] == [spec.label for spec in DEFAULT_SEQUENCE]


def test_build_steps_custom_sequence_overrides_default() -> None:
    """A custom sequence on params produces steps matching only that sequence."""
    custom_sequence = [
        StepSpec(label="nod", roll_factor=0.3),
        StepSpec(label="rise", z_factor=0.5),
    ]
    params = ChoreographyParams(
        roll_amplitude_deg=10.0, z_amplitude_mm=20.0, sequence=custom_sequence
    )
    steps = build_steps(params)
    assert len(steps) == 2
    assert steps[0].label == "nod"
    assert steps[0].roll_deg == pytest.approx(3.0)
    assert steps[1].label == "rise"
    assert steps[1].z_mm == pytest.approx(10.0)


def test_choreography_params_default_sequence_is_not_shared_mutable_state() -> None:
    """Each ChoreographyParams instance gets its own sequence list."""
    params_a = ChoreographyParams()
    params_b = ChoreographyParams()
    assert params_a.sequence is not params_b.sequence
    params_a.sequence.append(StepSpec(label="extra"))
    assert len(params_b.sequence) == len(DEFAULT_SEQUENCE)


# ─── Presets ─────────────────────────────────────────────────────────────────


def test_safe_preset_all_steps_pass() -> None:
    """Every step of the safe preset must compute to status 'ok'."""
    steps = build_steps(SAFE_PRESET)
    for loop in range(SAFE_PRESET.num_loops):
        for step in steps:
            safety = compute_safety(
                roll_deg=step.roll_deg,
                z_mm=step.z_mm,
                duration_s=step.duration_s,
                step=step.step_idx,
                loop=loop,
            )
            assert safety.status == "ok", (
                f"Safe preset failed on loop={loop} step={step.step_idx}: "
                f"roll={step.roll_deg}, z={step.z_mm}, dur={step.duration_s}, "
                f"violated={safety.violated_axes}"
            )


def test_aggressive_preset_has_at_least_one_violation() -> None:
    """The aggressive preset must trigger at least one violation."""
    steps = build_steps(AGGRESSIVE_PRESET)
    violations = [
        compute_safety(
            roll_deg=step.roll_deg,
            z_mm=step.z_mm,
            duration_s=step.duration_s,
            step=step.step_idx,
            loop=0,
        )
        for step in steps
        if compute_safety(
            roll_deg=step.roll_deg,
            z_mm=step.z_mm,
            duration_s=step.duration_s,
            step=step.step_idx,
            loop=0,
        ).status
        == "violation"
    ]
    assert len(violations) > 0, "Aggressive preset must produce at least one violation"


# ─── run_choreography ────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_run_choreography_safe_preset_publishes_pass(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """Safe preset completes all steps and publishes a PASS state."""
    bus = EventBus()
    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(return_value=None)),
    ):
        await run_choreography(bus, SAFE_PRESET)

    phases = [s.phase for s in states]
    assert "running" in phases
    assert "done" in phases
    assert all(p != "violation" for p in phases)

    done = next(s for s in states if s.phase == "done")
    assert done.verdict == "PASS"


@pytest.mark.anyio
async def test_run_choreography_aggressive_preset_stops_on_violation(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """Aggressive preset triggers a violation and stops without reaching 'done'."""
    bus = EventBus()
    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(return_value=None)),
    ):
        await run_choreography(bus, AGGRESSIVE_PRESET)

    phases = [s.phase for s in states]
    assert "violation" in phases
    assert "done" not in phases

    violation = next(s for s in states if s.phase == "violation")
    assert violation.verdict == "FAIL"


@pytest.mark.anyio
async def test_run_choreography_violation_blocks_the_move(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """The unsafe move never reaches the SDK — safety is checked before goto_target."""
    bus = EventBus()
    mock_to_thread = AsyncMock(return_value=None)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=mock_to_thread),
    ):
        await run_choreography(bus, AGGRESSIVE_PRESET)

    # Step 0 of AGGRESSIVE_PRESET already violates roll — goto_target must
    # never be reached.
    mock_to_thread.assert_not_called()


@pytest.mark.anyio
async def test_run_choreography_publishes_telemetry_and_safety(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """Telemetry and safety events are published for each executed step."""
    bus = EventBus()
    telemetry_events: list[ReachyTelemetryEvent] = []
    safety_events: list[ReachySafetyEvent] = []

    async def on_telemetry(channel: str, event: object) -> None:
        if isinstance(event, ReachyTelemetryEvent):
            telemetry_events.append(event)

    async def on_safety(channel: str, event: object) -> None:
        if isinstance(event, ReachySafetyEvent):
            safety_events.append(event)

    bus.subscribe("reachy/telemetry", on_telemetry)
    bus.subscribe("reachy/safety", on_safety)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(return_value=None)),
    ):
        await run_choreography(bus, SAFE_PRESET)

    # 4 steps × 2 loops = 8 events each
    assert len(telemetry_events) == 4 * SAFE_PRESET.num_loops
    assert len(safety_events) == 4 * SAFE_PRESET.num_loops


@pytest.mark.anyio
async def test_run_choreography_warning_message_names_the_axis(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """A warning-phase state event names the actual axis, not 'unknown'."""
    bus = EventBus()
    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    warning_params = ChoreographyParams(
        roll_amplitude_deg=ROLL_WARN_DEG + 1.0,
        z_amplitude_mm=0.0,
        step_duration_s=1.0,
        antenna_amplitude=0.4,
        num_loops=1,
    )

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(return_value=None)),
    ):
        await run_choreography(bus, warning_params)

    warning_states = [s for s in states if s.phase == "warning"]
    assert warning_states, "expected at least one warning state event"
    assert "unknown" not in warning_states[0].message
    assert "roll" in warning_states[0].message


@pytest.mark.anyio
async def test_run_choreography_cancelled_publishes_idle(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """Cancelling the task transitions state back to idle."""
    bus = EventBus()
    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    async def slow_goto(*args: object, **kwargs: object) -> None:
        await asyncio.sleep(10)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(side_effect=slow_goto)),
    ):
        task = asyncio.create_task(run_choreography(bus, SAFE_PRESET))
        await asyncio.sleep(0)  # let the task start
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    phases = [s.phase for s in states]
    assert "idle" in phases


@pytest.mark.anyio
async def test_run_choreography_sdk_exception_publishes_fail(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """A non-cancellation exception from the SDK is caught and surfaced as FAIL."""
    bus = EventBus()
    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch(
            "asyncio.to_thread",
            new=AsyncMock(side_effect=RuntimeError("daemon down")),
        ),
    ):
        await run_choreography(bus, SAFE_PRESET)

    phases = [s.phase for s in states]
    assert "violation" in phases
    failed = next(s for s in states if s.phase == "violation")
    assert failed.verdict == "FAIL"
    assert "daemon down" in failed.message
