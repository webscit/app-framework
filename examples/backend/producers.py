from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from typing import Any

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


async def start_sine_wave_producer(bus: EventBus, params: SineParams) -> None:
    """Publish a sine wave reading to ``data/sine`` every 100 ms.

    The wave shape is controlled by ``params`` which is updated in real time
    by the ``params/control`` consumer.

    Args:
        bus: The shared EventBus to publish events on.
        params: Mutable sine wave parameters shared with the consumer.
    """

    t = 0.0
    while True:
        value = params.amplitude * math.sin(2 * math.pi * params.frequency * t)
        await bus.publish("data/sine", SineReading(value=value))
        t += params.time_step
        await asyncio.sleep(0.1)


async def start_log_producer(bus: EventBus) -> None:
    """Publish a heartbeat log entry to ``logs/app`` every second."""

    while True:
        await bus.publish("logs/app", LogEntry(level="info", message="heartbeat"))
        await asyncio.sleep(1.0)


class TableRowEvent(BaseEvent):  # type: ignore[misc]
    """Single row of tabular simulation results published to a ``table/*`` channel."""

    row: dict[str, Any]


async def start_table_producer(bus: EventBus) -> None:
    """Publish mock solver iteration rows to ``table/results`` every 500 ms.

    Args:
        bus: The shared EventBus to publish events on.
    """

    step = 0
    while True:
        residual = round(1.0 / (step + 1), 6)
        await bus.publish(
            "table/results",
            TableRowEvent(
                row={
                    "step": step,
                    "time_s": round(step * 0.5, 1),
                    "residual": residual,
                    "status": "converged" if residual < 0.01 else "converging",
                }
            ),
        )
        step += 1
        await asyncio.sleep(0.5)
