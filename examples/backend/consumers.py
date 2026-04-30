from __future__ import annotations

import logging

from framework_core.bus import BaseEvent, EventBus
from pydantic import BaseModel

from .producers import sine_params

logger = logging.getLogger(__name__)


async def log_consumer(channel: str, message: BaseEvent) -> None:
    """Forward ``logs/app`` events to the Python logger."""

    logger.info("[%s] %s", channel, message.model_dump())


class SineControlParams(BaseModel):
    """Parameter payload published by the ParameterController widget."""

    frequency: float = 1.0
    amplitude: float = 1.0


async def sine_param_consumer(channel: str, message: SineControlParams) -> None:
    """Update the sine wave producer state when parameters change."""

    sine_params["frequency"] = message.frequency
    sine_params["amplitude"] = message.amplitude
    logger.info(
        "[%s] updated sine_params: freq=%.2f amp=%.2f",
        channel,
        message.frequency,
        message.amplitude,
    )


def register_consumers(bus: EventBus) -> None:
    """Register example backend consumers on the shared EventBus."""

    bus.subscribe("logs/app", log_consumer)
    bus.subscribe("params/control", sine_param_consumer)
