from __future__ import annotations

import asyncio
import math

from framework_core.bus import BaseEvent, EventBus


class SineReading(BaseEvent):  # type: ignore[misc]
    """Sine wave sample event for the demo channel."""

    value: float


class LogEntry(BaseEvent):  # type: ignore[misc]
    """Application log event emitted by the demo producer."""

    level: str
    message: str


# Mutable state updated by the parameter consumer in consumers.py.
# Read on every tick so changes take effect immediately.
sine_params: dict[str, float] = {
    "frequency": 1.0,
    "amplitude": 1.0,
}


async def start_sine_wave_producer(bus: EventBus) -> None:
    """Publish a sine wave reading to ``data/sine`` every 100 ms.

    Reads ``frequency`` and ``amplitude`` from ``sine_params`` on every tick
    so that parameter changes from the ParameterController take effect
    immediately without restarting the producer.
    """

    t = 0.0
    while True:
        freq = sine_params["frequency"]
        amp = sine_params["amplitude"]
        await bus.publish(
            "data/sine",
            SineReading(value=amp * math.sin(2 * math.pi * freq * t)),
        )
        t += 0.1
        await asyncio.sleep(0.1)


async def start_log_producer(bus: EventBus) -> None:
    """Publish a heartbeat log entry to ``logs/app`` every second."""

    while True:
        await bus.publish("logs/app", LogEntry(level="info", message="heartbeat"))
        await asyncio.sleep(1.0)
