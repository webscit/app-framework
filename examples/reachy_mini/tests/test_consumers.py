from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from framework_core.bus import EventBus

from examples.reachy_mini.backend.consumers import (
    ControlConsumer,
    _set_float,
    _set_int,
    register_consumers,
)
from examples.reachy_mini.backend.producers import (
    AGGRESSIVE_PRESET,
    SAFE_PRESET,
    ChoreographyParams,
    ReachyStateEvent,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_params() -> ChoreographyParams:
    """Return an aggressive-preset params copy (default broken state)."""
    return ChoreographyParams(
        roll_amplitude_deg=AGGRESSIVE_PRESET.roll_amplitude_deg,
        z_amplitude_mm=AGGRESSIVE_PRESET.z_amplitude_mm,
        step_duration_s=AGGRESSIVE_PRESET.step_duration_s,
        antenna_amplitude=AGGRESSIVE_PRESET.antenna_amplitude,
        num_loops=AGGRESSIVE_PRESET.num_loops,
    )


def _make_control_event(payload: dict) -> MagicMock:
    """Wrap *payload* in a mock BaseEvent with a model_dump that returns it directly."""
    event = MagicMock()
    event.model_dump.return_value = payload
    return event


# ── _set_float / _set_int ─────────────────────────────────────────────────────


def test_set_float_updates_field() -> None:
    params = ChoreographyParams()
    _set_float(params, "roll_amplitude_deg", "22.5")
    assert params.roll_amplitude_deg == pytest.approx(22.5)


def test_set_float_skips_none() -> None:
    params = ChoreographyParams()
    original = params.roll_amplitude_deg
    _set_float(params, "roll_amplitude_deg", None)
    assert params.roll_amplitude_deg == original


def test_set_float_ignores_invalid() -> None:
    params = ChoreographyParams()
    original = params.roll_amplitude_deg
    _set_float(params, "roll_amplitude_deg", "not_a_number")
    assert params.roll_amplitude_deg == original


def test_set_int_updates_field() -> None:
    params = ChoreographyParams()
    _set_int(params, "num_loops", "3")
    assert params.num_loops == 3


def test_set_int_skips_none() -> None:
    params = ChoreographyParams()
    original = params.num_loops
    _set_int(params, "num_loops", None)
    assert params.num_loops == original


# ── _apply_params via __call__ ────────────────────────────────────────────────


@pytest.mark.anyio
async def test_apply_safe_preset() -> None:
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params)

    await consumer("reachy/control", _make_control_event({"preset": "safe"}))

    assert params.roll_amplitude_deg == pytest.approx(SAFE_PRESET.roll_amplitude_deg)
    assert params.step_duration_s == pytest.approx(SAFE_PRESET.step_duration_s)


@pytest.mark.anyio
async def test_apply_aggressive_preset() -> None:
    bus = EventBus()
    params = ChoreographyParams()  # start from safe defaults
    consumer = ControlConsumer(bus, params)

    await consumer("reachy/control", _make_control_event({"preset": "aggressive"}))

    expected_roll = AGGRESSIVE_PRESET.roll_amplitude_deg
    assert params.roll_amplitude_deg == pytest.approx(expected_roll)
    assert params.step_duration_s == pytest.approx(AGGRESSIVE_PRESET.step_duration_s)


@pytest.mark.anyio
async def test_individual_field_overrides_preset() -> None:
    """Individual field update is applied after preset, overriding the preset value."""
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params)

    await consumer(
        "reachy/control",
        _make_control_event({"preset": "safe", "roll_amplitude_deg": 20.0}),
    )

    # Preset applied first, then field override
    assert params.roll_amplitude_deg == pytest.approx(20.0)
    assert params.step_duration_s == pytest.approx(SAFE_PRESET.step_duration_s)


@pytest.mark.anyio
async def test_payload_wrapped_in_client_publish_event() -> None:
    """Frontend publishes arrive wrapped: { payload: { ... } }."""
    bus = EventBus()
    params = _make_params()
    consumer = ControlConsumer(bus, params)

    event = MagicMock()
    event.model_dump.return_value = {"payload": {"roll_amplitude_deg": 18.0}}

    await consumer("reachy/control", event)

    assert params.roll_amplitude_deg == pytest.approx(18.0)


@pytest.mark.anyio
async def test_unknown_preset_is_ignored() -> None:
    bus = EventBus()
    params = _make_params()
    original_roll = params.roll_amplitude_deg
    consumer = ControlConsumer(bus, params)

    await consumer("reachy/control", _make_control_event({"preset": "turbo"}))

    assert params.roll_amplitude_deg == pytest.approx(original_roll)


# ── Lifecycle commands ────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_start_command_launches_task(
    reachy_modules: dict[str, MagicMock],
) -> None:
    bus = EventBus()
    params = ChoreographyParams()
    consumer = ControlConsumer(bus, params)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(return_value=None)),
    ):
        await consumer("reachy/control", _make_control_event({"command": "start"}))
        assert consumer._task is not None
        # Let it finish
        await consumer._task


@pytest.mark.anyio
async def test_stop_command_cancels_running_task(
    reachy_modules: dict[str, MagicMock],
) -> None:
    bus = EventBus()
    params = ChoreographyParams()
    consumer = ControlConsumer(bus, params)

    async def hang(*_: object, **__: object) -> None:
        await asyncio.sleep(60)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(side_effect=hang)),
    ):
        await consumer("reachy/control", _make_control_event({"command": "start"}))
        await asyncio.sleep(0)  # let task start
        assert consumer._task is not None
        await consumer("reachy/control", _make_control_event({"command": "stop"}))

    assert consumer._task is None


@pytest.mark.anyio
async def test_start_replaces_running_task(
    reachy_modules: dict[str, MagicMock],
) -> None:
    """A second 'start' cancels the first task and starts a fresh one."""
    bus = EventBus()
    params = ChoreographyParams()
    consumer = ControlConsumer(bus, params)

    async def hang(*_: object, **__: object) -> None:
        await asyncio.sleep(60)

    with (
        patch.dict(sys.modules, reachy_modules),
        patch("asyncio.to_thread", new=AsyncMock(side_effect=hang)),
    ):
        await consumer("reachy/control", _make_control_event({"command": "start"}))
        first_task = consumer._task
        await asyncio.sleep(0)

        # Second start — should cancel first
        await consumer("reachy/control", _make_control_event({"command": "start"}))
        assert consumer._task is not first_task
        assert first_task is not None and first_task.cancelled()


@pytest.mark.anyio
async def test_reset_restores_aggressive_preset() -> None:
    bus = EventBus()
    params = ChoreographyParams(roll_amplitude_deg=10.0)  # custom value
    consumer = ControlConsumer(bus, params)

    states: list[ReachyStateEvent] = []

    async def capture(channel: str, event: object) -> None:
        if isinstance(event, ReachyStateEvent):
            states.append(event)

    bus.subscribe("reachy/state", capture)

    await consumer("reachy/control", _make_control_event({"command": "reset"}))

    expected_roll = AGGRESSIVE_PRESET.roll_amplitude_deg
    assert params.roll_amplitude_deg == pytest.approx(expected_roll)
    assert any(s.phase == "idle" for s in states)


@pytest.mark.anyio
async def test_stop_with_no_running_task_is_safe() -> None:
    """Stop when idle should not raise."""
    bus = EventBus()
    params = ChoreographyParams()
    consumer = ControlConsumer(bus, params)

    await consumer("reachy/control", _make_control_event({"command": "stop"}))
    assert consumer._task is None


@pytest.mark.anyio
async def test_cancel_running_swallows_unexpected_exception_without_raising() -> None:
    """A non-cancellation exception raised during cancellation must not propagate."""
    bus = EventBus()
    params = ChoreographyParams()
    consumer = ControlConsumer(bus, params)

    async def flaky() -> None:
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise RuntimeError("cleanup failed") from None

    consumer._task = asyncio.create_task(flaky())
    await asyncio.sleep(0)  # let it start awaiting sleep

    # Cancelling raises RuntimeError instead of propagating CancelledError —
    # _cancel_running must log it, not let it escape stop/reset handling.
    await consumer("reachy/control", _make_control_event({"command": "stop"}))
    assert consumer._task is None


# ── register_consumers ────────────────────────────────────────────────────────


def test_register_consumers_subscribes_to_control_channel() -> None:
    bus = EventBus()
    params = ChoreographyParams()
    register_consumers(bus, params)
    # The subscription exists — channel is in the bus subscriber map
    assert "reachy/control" in bus._subscriptions
