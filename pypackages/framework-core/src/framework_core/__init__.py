from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from .bus import EventBus
from .ws_bridge import _mount_ws_bridge


def create_app(lifespan: Any = None) -> FastAPI:
    """Create and return a configured FastAPI application.

    Mounts the ``/ws`` WebSocket endpoint backed by a shared ``EventBus``.
    The application's ``EventBus`` is accessible via ``app.state.bus``.

    Args:
        lifespan: Optional async context manager for startup/shutdown hooks.
                  It receives the ``FastAPI`` app instance and must be an
                  ``@asynccontextmanager`` that yields once.  The framework
                  sets ``app.state.bus`` *before* entering the custom lifespan,
                  so the bus is always available when your hooks run.

    Returns:
        Configured ``FastAPI`` application with a shared ``EventBus`` and
        websocket bridge mounted at ``/ws``.

    Example::

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            tasks = [asyncio.create_task(start_producer(app.state.bus))]
            yield
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        app = create_app(lifespan=lifespan)
    """
    bus = EventBus()

    @asynccontextmanager
    async def _framework_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        app.state.bus = bus
        if lifespan is not None:
            async with lifespan(app):
                yield
        else:
            yield

    app = FastAPI(lifespan=_framework_lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Return a lightweight process-health response for checks/tests.

        Returns:
            Mapping containing ``{\"status\": \"ok\"}``.
        """
        return {"status": "ok"}

    _mount_ws_bridge(app, bus)
    return app
