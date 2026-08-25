from __future__ import annotations

import math
from unittest.mock import MagicMock

import pytest
from drone_example import fmu_runner
from drone_example.consumers import (
    ControlConsumer,
    _set_float,
    _set_int,
)
from drone_example.events import DroneStateEvent
from drone_example.fmu_runner import (
    VR_ATTITUDE,
    VR_POSITION,
    VR_PROP,
    VR_TARGET,
    VR_VELOCITY,
)
from drone_example.manoeuvre import (
    AGGRESSIVE_PRESET,
    GENTLE_PRESET,
    ManoeuvreParams,
)
from framework_core.bus import EventBus


class StubFmu:
    """FMI2-slave stand-in for consumer tests (position tracks setpoint)."""

    def __init__(self, roll_deg: float = 0.0) -> None:
        self.roll_deg = roll_deg
        self.target = [0.0, 0.0, 0.0]
        self.terminated = False

    def setReal(self, vr: list[int], value: list[float]) -> None:  # noqa: N802
        if list(vr) == VR_TARGET:
            self.target = list(value)

    def doStep(self, current: float, step_size: float) -> None:  # noqa: N802
        pass

    def getReal(self, vr: list[int]) -> list[float]:  # noqa: N802
        vr = list(vr)
        if vr == VR_POSITION:
            return list(self.target)
        if vr == VR_ATTITUDE:
            return [math.radians(self.roll_deg), 0.0, 0.0]
        if vr in (VR_VELOCITY,):
            return [0.0, 0.0, 0.0]
        if vr == VR_PROP:
            return [0.0, 0.0, 0.0, 0.0]
        raise KeyError(vr)

    def terminate(self) -> None:
        self.terminated = True


def _make_params() -> ManoeuvreParams:
    return ManoeuvreParams(setpoint_step_m=3.0, change_frequency_hz=5.0, num_segments=2)


def _event(payload: dict) -> MagicMock:
    event = MagicMock()
    event.model_dump.return_value = payload
    return event


@pytest.fixture(autouse=True)
def _no_pace(monkeypatch: pytest.MonkeyPatch) -> None:
    async def instant(_seconds: float) -> None:
        return None

    monkeypatch.setattr(fmu_runner, "_pace", instant)


# ── field helpers ─────────────────────────────────────────────────────────────


def test_set_float_updates_field() -> None:
    params = _make_params()
    _set_float(params, "setpoint_step_m", "8.5")
    assert params.setpoint_step_m == pytest.approx(8.5)


def test_set_float_ignores_invalid() -> None:
    params = _make_params()
    _set_float(params, "setpoint_step_m", "nope")
    assert params.setpoint_step_m == pytest.approx(3.0)


def test_set_int_updates_field() -> None:
    params = _make_params()
    _set_int(params, "num_segments", "5")
    assert params.num_segments == 5


# ── preset application ────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_apply_gentle_preset() -> None:
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params, lambda: StubFmu())
    await consumer("drone/control", _event({"preset": "gentle"}))
    assert params.setpoint_step_m == pytest.approx(GENTLE_PRESET.setpoint_step_m)
    assert params.change_frequency_hz == pytest.approx(
        GENTLE_PRESET.change_frequency_hz
    )


@pytest.mark.anyio
async def test_individual_field_overrides_preset() -> None:
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params, lambda: StubFmu())
    await consumer(
        "drone/control", _event({"preset": "gentle", "setpoint_step_m": 7.0})
    )
    assert params.setpoint_step_m == pytest.approx(7.0)


# ── lifecycle ─────────────────────────────────────────────────────────────────


async def _capture_states(bus: EventBus, states: list[DroneStateEvent]) -> None:
    async def cb(_c: str, e: object) -> None:
        if isinstance(e, DroneStateEvent):
            states.append(e)

    bus.subscribe("drone/state", cb)


@pytest.mark.anyio
async def test_start_runs_manoeuvre_to_a_pass() -> None:
    bus = EventBus()
    states: list[DroneStateEvent] = []
    await _capture_states(bus, states)
    stub = StubFmu(roll_deg=5.0)
    consumer = ControlConsumer(bus, _make_params(), lambda: stub)

    await consumer("drone/control", _event({"command": "start"}))
    await consumer._task  # let the run finish

    assert any(s.phase == "done" and s.verdict == "PASS" for s in states)
    assert stub.terminated  # FMU freed after the run


@pytest.mark.anyio
async def test_start_with_no_fmu_reports_idle() -> None:
    bus = EventBus()
    states: list[DroneStateEvent] = []
    await _capture_states(bus, states)
    consumer = ControlConsumer(bus, _make_params(), lambda: None)

    await consumer("drone/control", _event({"command": "start"}))

    assert any("FMU unavailable" in s.message for s in states)


@pytest.mark.anyio
async def test_reset_restores_aggressive_preset() -> None:
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params, lambda: StubFmu())
    await consumer("drone/control", _event({"command": "reset"}))
    assert params.setpoint_step_m == pytest.approx(AGGRESSIVE_PRESET.setpoint_step_m)
    assert params.num_segments == AGGRESSIVE_PRESET.num_segments
