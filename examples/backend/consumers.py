from __future__ import annotations

import logging

from framework_core.bus import BaseEvent, EventBus

from .producers import sine_params

logger = logging.getLogger(__name__)


async def log_consumer(channel: str, message: BaseEvent) -> None:
    """Forward ``logs/app`` events to the Python logger."""

    logger.info("[%s] %s", channel, message.model_dump())


async def params_consumer(channel: str, message: BaseEvent) -> None:
    """Update sine wave producer params when a ``params/control`` event arrives.

    Frontend publishes are wrapped in a ``_ClientPublishEvent`` envelope so
    this handler unwraps the inner ``payload`` dict before reading values.
    Unknown or malformed keys are logged and skipped.

    Args:
        channel: The channel the event arrived on.
        message: The raw event from the EventBus.
    """

    data = message.model_dump()
    # Frontend publishes are wrapped in _ClientPublishEvent — unwrap the payload
    payload = data.get("payload", data)
    if not isinstance(payload, dict):
        return

    if "frequency" in payload:
        try:
            sine_params.frequency = float(payload["frequency"])
        except (TypeError, ValueError):
            logger.warning("Invalid frequency value: %r", payload["frequency"])

    if "amplitude" in payload:
        try:
            sine_params.amplitude = float(payload["amplitude"])
        except (TypeError, ValueError):
            logger.warning("Invalid amplitude value: %r", payload["amplitude"])

    if "time_step" in payload:
        try:
            sine_params.time_step = float(payload["time_step"])
        except (TypeError, ValueError):
            logger.warning("Invalid time_step value: %r", payload["time_step"])

    logger.info(
        "[%s] sine params updated: frequency=%.3f amplitude=%.3f time_step=%.3f",
        channel,
        sine_params.frequency,
        sine_params.amplitude,
        sine_params.time_step,
    )


def register_consumers(bus: EventBus) -> None:
    """Register example backend consumers on the shared EventBus.

    Args:
        bus: The shared EventBus to subscribe consumers on.
    """

    bus.subscribe("logs/app", log_consumer)
    bus.subscribe("params/control", params_consumer)
