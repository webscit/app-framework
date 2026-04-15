from __future__ import annotations

import asyncio

import pytest
from framework_core.bus import BaseEvent, EventBus


class TemperatureReading(BaseEvent):
    value: float
    unit: str = "celsius"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_base_event_sets_headers_automatically() -> None:
    reading = TemperatureReading(value=22.5)

    assert reading.message_id
    assert isinstance(reading.timestamp, int)
    assert reading.timestamp > 0


@pytest.mark.anyio
async def test_publish_delivers_to_exact_subscription() -> None:
    bus = EventBus()
    received: list[tuple[str, BaseEvent]] = []

    async def handler(channel: str, message: BaseEvent) -> None:
        received.append((channel, message))

    bus.subscribe("sensor/temperature", handler)
    message = TemperatureReading(value=20.0)

    await bus.publish("sensor/temperature", message)

    assert received == [("sensor/temperature", message)]


@pytest.mark.anyio
async def test_publish_matches_wildcard_subscription() -> None:
    bus = EventBus()
    channels: list[str] = []

    async def handler(channel: str, message: BaseEvent) -> None:
        channels.append(channel)

    bus.subscribe("sensor/*", handler)

    await bus.publish("sensor/temperature", TemperatureReading(value=20.0))
    await bus.publish("sensor/humidity", TemperatureReading(value=30.0))

    assert channels == ["sensor/temperature", "sensor/humidity"]


@pytest.mark.anyio
async def test_unsubscribe_stops_delivery() -> None:
    bus = EventBus()
    received: list[tuple[str, BaseEvent]] = []

    async def handler(channel: str, message: BaseEvent) -> None:
        received.append((channel, message))

    bus.subscribe("sensor/temperature", handler)
    bus.unsubscribe("sensor/temperature", handler)

    await bus.publish("sensor/temperature", TemperatureReading(value=19.2))

    assert received == []


@pytest.mark.anyio
async def test_subscribe_replays_last_message_for_matching_channel() -> None:
    """New subscribers receive the last stored message immediately on subscribe.

    EventBus.subscribe schedules the replay as an asyncio.create_task so the
    async handler is properly awaited.  A single event-loop iteration
    (asyncio.sleep(0)) is enough to let the task run.
    """
    bus = EventBus()
    message = TemperatureReading(value=18.4)
    received: list[tuple[str, BaseEvent]] = []

    await bus.publish("sensor/temperature", message)

    async def handler(channel: str, replayed_message: BaseEvent) -> None:
        received.append((channel, replayed_message))

    bus.subscribe("sensor/*", handler)
    # Yield to the event loop so the scheduled replay task can execute.
    await asyncio.sleep(0)

    assert received == [("sensor/temperature", message)]


@pytest.mark.anyio
async def test_subscribe_does_not_replay_non_matching_channel() -> None:
    """Last-message replay must not fire when the glob does not match.

    Publishing to ``sensor/temperature`` and then subscribing to ``logs/*``
    should not deliver the temperature message to the logs handler.
    """
    bus = EventBus()
    received: list[tuple[str, BaseEvent]] = []

    await bus.publish("sensor/temperature", TemperatureReading(value=99.0))

    async def handler(channel: str, message: BaseEvent) -> None:
        received.append((channel, message))

    bus.subscribe("logs/*", handler)
    await asyncio.sleep(0)

    assert received == []


@pytest.mark.anyio
async def test_publish_preserves_order_per_channel() -> None:
    bus = EventBus()
    seen_values: list[float] = []

    async def handler(channel: str, message: BaseEvent) -> None:
        assert isinstance(message, TemperatureReading)
        seen_values.append(message.value)

    bus.subscribe("sensor/temperature", handler)

    await bus.publish("sensor/temperature", TemperatureReading(value=1.0))
    await bus.publish("sensor/temperature", TemperatureReading(value=2.0))

    assert seen_values == [1.0, 2.0]


@pytest.mark.anyio
async def test_publish_with_no_subscribers_is_noop() -> None:
    bus = EventBus()

    # Should not raise even though nothing is subscribed.
    await bus.publish("sensor/temperature", TemperatureReading(value=11.1))
