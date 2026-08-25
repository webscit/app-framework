from __future__ import annotations

import math

import pytest
from drone_example import fmu_runner
from drone_example.events import (
    DroneStabilityEvent,
    DroneStateEvent,
    DroneTelemetryEvent,
)
from drone_example.fmu_runner import (
    VR_ATTITUDE,
    VR_POSITION,
    VR_PROP,
    VR_TARGET,
    VR_VELOCITY,
    run_manoeuvre,
)
from drone_example.manoeuvre import ManoeuvreParams
from sci_framework_core.bus import EventBus


class StubFmu:
    """Minimal FMI2-slave stand-in: position tracks the setpoint instantly and
    tilt is a fixed roll, so a run's PASS/FAIL is fully controllable."""

    def __init__(self, roll_deg: float = 0.0) -> None:
        self.roll_deg = roll_deg
        self.target = [0.0, 0.0, 0.0]
        self.steps = 0

    def setReal(self, vr: list[int], value: list[float]) -> None:  # noqa: N802
        if list(vr) == VR_TARGET:
            self.target = list(value)

    def doStep(self, current: float, step_size: float) -> None:  # noqa: N802
        self.steps += 1

    def getReal(self, vr: list[int]) -> list[float]:  # noqa: N802
        vr = list(vr)
        if vr == VR_POSITION:
            return list(self.target)
        if vr == VR_ATTITUDE:
            return [math.radians(self.roll_deg), 0.0, 0.0]
        if vr == VR_VELOCITY:
            return [0.0, 0.0, 0.0]
        if vr == VR_PROP:
            return [100.0, 100.0, 100.0, 100.0]
        raise KeyError(vr)


@pytest.fixture
def bus_and_events() -> tuple[EventBus, dict[str, list[object]]]:
    """An EventBus wired to capture every drone/* channel into lists."""
    bus = EventBus()
    got: dict[str, list[object]] = {
        "drone/telemetry": [],
        "drone/stability": [],
        "drone/state": [],
        "drone/log": [],
    }
    for ch in got:

        async def cb(_ch: str, event: object, _key: str = ch) -> None:
            got[_key].append(event)

        bus.subscribe(ch, cb)
    return bus, got


@pytest.fixture(autouse=True)
def _no_pace(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip real-time pacing so runs complete instantly."""

    async def instant(_seconds: float) -> None:
        return None

    monkeypatch.setattr(fmu_runner, "_pace", instant)


_SHORT = ManoeuvreParams(setpoint_step_m=3.0, change_frequency_hz=5.0, num_segments=2)


@pytest.mark.anyio
async def test_run_publishes_telemetry_stability_and_state(bus_and_events) -> None:
    bus, got = bus_and_events
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=5.0), dt=0.05)

    assert len(got["drone/telemetry"]) > 0
    assert all(isinstance(e, DroneTelemetryEvent) for e in got["drone/telemetry"])
    # One stability assessment per segment.
    assert len(got["drone/stability"]) == _SHORT.num_segments
    assert all(isinstance(e, DroneStabilityEvent) for e in got["drone/stability"])
    # A terminal done state with a PASS verdict.
    done = [
        e
        for e in got["drone/state"]
        if isinstance(e, DroneStateEvent) and e.phase == "done"
    ]
    assert done and done[-1].verdict == "PASS"


@pytest.mark.anyio
async def test_telemetry_attitude_is_in_degrees(bus_and_events) -> None:
    bus, got = bus_and_events
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=12.0), dt=0.05)
    sample = got["drone/telemetry"][0]
    assert sample.attitude[0] == pytest.approx(12.0)


@pytest.mark.anyio
async def test_high_tilt_run_fails(bus_and_events) -> None:
    bus, got = bus_and_events
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=40.0), dt=0.05)

    done = [e for e in got["drone/state"] if e.phase == "done"]
    assert done[-1].verdict == "FAIL"
    assert any(e.status == "violation" for e in got["drone/stability"])


@pytest.mark.anyio
async def test_setpoint_is_applied_each_segment(bus_and_events) -> None:
    bus, got = bus_and_events
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=5.0), dt=0.05)
    # Square wave: segment 0 targets the step, segment 1 returns to 0.
    seg0 = [e for e in got["drone/telemetry"] if e.segment == 0]
    seg1 = [e for e in got["drone/telemetry"] if e.segment == 1]
    assert seg0[-1].target[0] == pytest.approx(3.0)
    assert seg1[-1].target[0] == pytest.approx(0.0)


@pytest.mark.anyio
async def test_publishes_hover_warmup_telemetry_before_segments(bus_and_events) -> None:
    bus, got = bus_and_events
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=5.0), dt=0.05)
    # The hover warm-up publishes telemetry tagged segment -1.
    assert any(e.segment == -1 for e in got["drone/telemetry"])


@pytest.mark.anyio
async def test_stops_on_first_violation(bus_and_events) -> None:
    bus, got = bus_and_events
    # roll=40 violates every segment; the run must stop after the first, so
    # fewer than num_segments assessments are published.
    await run_manoeuvre(bus, _SHORT, StubFmu(roll_deg=40.0), dt=0.05)
    assert len(got["drone/stability"]) == 1
