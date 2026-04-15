from __future__ import annotations

import asyncio
import math

from framework_core.bus import BaseEvent, EventBus


class SineReading(BaseEvent):
    """Sine wave sample event for the demo channel."""

    value: float


class LogEntry(BaseEvent):
    """Application log event emitted by the demo producer."""

    level: str
    message: str


async def start_sine_wave_producer(bus: EventBus) -> None:
    """Publish a sine wave reading to ``data/sine`` every 100 ms."""

    t = 0.0
    while True:
        await bus.publish("data/sine", SineReading(value=math.sin(t)))
        t += 0.1
        await asyncio.sleep(0.1)


async def start_log_producer(bus: EventBus) -> None:
    """Publish a heartbeat log entry to ``logs/app`` every second."""

    while True:
        await bus.publish("logs/app", LogEntry(level="info", message="heartbeat"))
        await asyncio.sleep(1.0)
