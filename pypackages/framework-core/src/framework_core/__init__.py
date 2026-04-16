from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .bus import EventBus
from .default_widgets import LOG_VIEWER, STATUS_INDICATOR
from .widget_registry import WidgetDefinition, WidgetRegistry
from .ws_bridge import _mount_ws_bridge


def create_app(lifespan: Any = None) -> FastAPI:
    """Create and return a configured FastAPI application.

    Mounts the ``/ws`` WebSocket endpoint backed by a shared ``EventBus``
    and ``WidgetRegistry``.  Both are accessible via ``app.state``:

    - ``app.state.bus`` — in-process pub/sub broker.
    - ``app.state.widget_registry`` — catalog of available widget types.

    The registry is pre-populated with the built-in ``LogViewer`` and
    ``StatusIndicator`` widgets.  The ``GET /api/widgets`` endpoint exposes
    the full catalog as JSON for frontend hydration.

    Args:
        lifespan: Optional async context manager for startup/shutdown hooks.
                  It receives the ``FastAPI`` app instance and must be an
                  ``@asynccontextmanager`` that yields once.  The framework
                  sets both state attributes *before* entering the custom
                  lifespan, so they are always available when your hooks run.

    Returns:
        Configured ``FastAPI`` application with shared bus, registry,
        and websocket bridge at ``/ws``.

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
    widget_registry = WidgetRegistry()
    widget_registry.register(LOG_VIEWER)
    widget_registry.register(STATUS_INDICATOR)

    @asynccontextmanager
    async def _framework_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        app.state.bus = bus
        app.state.widget_registry = widget_registry
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

    @app.get("/api/widgets")
    async def get_widgets() -> JSONResponse:
        """Return all registered widget definitions as a JSON array.

        Used by the frontend ``EventBusProvider`` to hydrate its local
        ``WidgetRegistry`` on WebSocket connect so both sides stay in sync.

        Returns:
            JSON array of ``WidgetDefinition`` objects.
        """
        widgets = [w.model_dump() for w in widget_registry.list()]
        return JSONResponse(content=widgets)

    _mount_ws_bridge(app, bus)
    return app


__all__ = [
    "create_app",
    "WidgetDefinition",
    "WidgetRegistry",
    "LOG_VIEWER",
    "STATUS_INDICATOR",
]
