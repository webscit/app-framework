from __future__ import annotations

import asyncio
import fnmatch
import uuid
from collections.abc import Awaitable, Callable
from time import time_ns

from pydantic import BaseModel, Field

EventHandler = Callable[["str", "BaseEvent"], Awaitable[None]]


class BaseEvent(BaseModel):
    """Base class for all framework events.

    Provides standard header fields that are set automatically on instantiation.
    Subclasses only need to define their domain-specific payload fields.

    The ``message_id`` and ``timestamp`` fields mirror the wire-format envelope
    ``headers`` object and the ``EventHeaders`` TypeScript interface.
    """

    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """Unique message identifier (UUID v4), auto-generated."""

    timestamp: int = Field(default_factory=lambda: time_ns() // 1_000_000)
    """Creation time in **milliseconds** since Unix epoch, auto-generated."""


class EventBus:
    """In-process pub/sub broker.

    Design decisions
    ----------------
    - Consumers register **async handler callbacks** — no queue objects are
      ever exposed.
    - Channel routing uses ``fnmatch``-style glob patterns (e.g. ``sensor/*``,
      ``*``).
    - The bus stores the **last message per channel** so new subscribers
      receive it immediately on subscribe.
    - Messages are delivered in **publish order** — a more recent event is
      never delivered before an older one on the same channel.
    - Internal implementation details (storage, matching) are never visible to
      framework consumers.
    """

    def __init__(self) -> None:
        """Initialise empty subscription and replay stores.

        Returns:
            None.
        """
        # pattern → list of handlers
        self._subscriptions: dict[str, list[EventHandler]] = {}
        # exact channel → last published message
        self._last_by_channel: dict[str, tuple[str, BaseEvent]] = {}

    def subscribe(self, channel: str, handler: EventHandler) -> None:
        """Register a handler for channels matching a glob pattern.

        `channel` supports `fnmatch` glob patterns (for example, ``sensor/*``).
        If replay data exists for matching channels, the handler is scheduled
        immediately through `asyncio.create_task`.

        Args:
            channel: Subscription channel pattern.
            handler: Async callback receiving ``(channel, message)``.

        Returns:
            None.
        """
        handlers = self._subscriptions.setdefault(channel, [])
        handlers.append(handler)

        # Replay any stored last messages whose channel matches the pattern.
        for stored_channel, (_, message) in list(self._last_by_channel.items()):
            if fnmatch.fnmatch(stored_channel, channel):
                asyncio.get_event_loop().create_task(  # noqa: RUF006
                    handler(stored_channel, message)  # type: ignore[arg-type]
                )  # noqa: RUF006

    def unsubscribe(self, channel: str, handler: EventHandler) -> None:
        """Remove a previously registered handler for a pattern.

        Args:
            channel: Subscription channel pattern used during subscribe.
            handler: Handler function to remove.

        Returns:
            None. This method is a no-op if the handler is not registered.
        """
        handlers = self._subscriptions.get(channel)
        if handlers is None:
            return
        try:
            handlers.remove(handler)
        except ValueError:
            pass
        if not handlers:
            del self._subscriptions[channel]

    async def publish(self, channel: str, message: BaseEvent) -> None:
        """Publish an event to all handlers whose pattern matches a channel.

        The message is saved as replay state for the exact channel and then
        delivered to matching handlers in subscription order.

        Args:
            channel: Concrete channel to publish to.
            message: Event payload object.

        Returns:
            None.
        """
        self._last_by_channel[channel] = (channel, message)

        for pattern, handlers in list(self._subscriptions.items()):
            if fnmatch.fnmatch(channel, pattern):
                for handler in list(handlers):
                    await handler(channel, message)
