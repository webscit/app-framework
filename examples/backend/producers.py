from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass

from framework_core.bus import BaseEvent, EventBus


class SineReading(BaseEvent):  # type: ignore[misc]
    """Sine wave sample event for the demo channel."""

    value: float


class LogEntry(BaseEvent):  # type: ignore[misc]
    """Application log event emitted by the demo producer."""

    level: str
    message: str


@dataclass
class SineParams:
    """Mutable parameters for the sine wave producer.

    Updated at runtime by the ``params/control`` consumer whenever the
    frontend ``ParameterController`` widget publishes new values.
    """

    frequency: float = 1.0
    amplitude: float = 1.0
    time_step: float = 0.1


#: Shared singleton — consumers write to this, the producer reads from it.
sine_params: SineParams = SineParams()


async def start_sine_wave_producer(bus: EventBus) -> None:
    """Publish a sine wave reading to ``data/sine`` every 100 ms.

    The wave shape is controlled by :data:`sine_params` which is updated
    in real time by the ``params/control`` consumer.
    """

    t = 0.0
    while True:
        params = sine_params
        value = params.amplitude * math.sin(2 * math.pi * params.frequency * t)
        await bus.publish("data/sine", SineReading(value=value))
        t += params.time_step
        await asyncio.sleep(0.1)


async def start_log_producer(bus: EventBus) -> None:
    """Publish a heartbeat log entry to ``logs/app`` every second."""

    while True:
        await bus.publish("logs/app", LogEntry(level="info", message="heartbeat"))
        await asyncio.sleep(1.0)
