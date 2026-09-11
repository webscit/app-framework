from __future__ import annotations

import asyncio
from typing import Any

import pytest
from sci_framework_core.bus import BaseEvent, EventBus
from sci_framework_core.lifecycle import LifecycleConsumer, SimulationStateEvent


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _ClientPublishEvent(BaseEvent):
    """Mirrors the wire-format wrapper the ws_bridge uses for client publishes."""

    payload: Any


class _CountingConsumer(LifecycleConsumer):
    """Minimal concrete subclass for exercising LifecycleConsumer bookkeeping."""

    def __init__(self, bus: EventBus, state_channel: str) -> None:
        super().__init__(bus, state_channel)
        self.apply_params_calls: list[dict[str, Any]] = []
        self.run_calls = 0
        self.cancelled = 0
        self.started_event = asyncio.Event()
        self.release_event = asyncio.Event()

    def apply_params(self, payload: dict[str, Any]) -> None:
        self.apply_params_calls.append(payload)

    async def run(self) -> None:
        self.run_calls += 1
        self.started_event.set()
        try:
            await self.release_event.wait()
        except asyncio.CancelledError:
            self.cancelled += 1
            raise


@pytest.mark.anyio
async def test_start_command_launches_run() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    assert consumer.run_calls == 1

    consumer.release_event.set()
    await consumer._cancel_running()


@pytest.mark.anyio
async def test_stop_command_cancels_running_task() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "stop"}))

    assert consumer.cancelled == 1
    assert consumer._task is None


@pytest.mark.anyio
async def test_second_start_cancels_first_run_before_starting_second() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)
    consumer.started_event.clear()

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    assert consumer.run_calls == 2
    assert consumer.cancelled == 1

    consumer.release_event.set()
    await consumer._cancel_running()


@pytest.mark.anyio
async def test_apply_params_called_on_every_message_run_not_called_for_other_commands(
) -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer(
        "sim/control", _ClientPublishEvent(payload={"command": "noop", "x": 1})
    )
    await consumer(
        "sim/control", _ClientPublishEvent(payload={"command": "noop", "x": 2})
    )

    assert consumer.apply_params_calls == [
        {"command": "noop", "x": 1},
        {"command": "noop", "x": 2},
    ]
    assert consumer.run_calls == 0


@pytest.mark.anyio
async def test_malformed_non_dict_payload_is_ignored_not_raised() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload="not-a-dict"))

    assert consumer.apply_params_calls == []
    assert consumer.run_calls == 0


def test_simulation_state_event_defaults() -> None:
    event = SimulationStateEvent(phase="idle")

    assert event.phase == "idle"
    assert event.message == ""
    assert event.message_id
    assert isinstance(event.timestamp, int)
