from __future__ import annotations

import logging

from framework_core.bus import BaseEvent, EventBus

logger = logging.getLogger(__name__)


async def log_consumer(channel: str, message: BaseEvent) -> None:
    """Forward ``logs/app`` events to the Python logger."""

    logger.info("[%s] %s", channel, message.model_dump())


def register_consumers(bus: EventBus) -> None:
    """Register example backend consumers on the shared EventBus."""

    bus.subscribe("logs/app", log_consumer)
