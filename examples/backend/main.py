from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from framework_core import create_app
from framework_core.ai_layout import mount_ai_routes

from .consumers import register_consumers
from .producers import SineParams, start_log_producer, start_sine_wave_producer

params = SineParams()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Register demo services and manage producer task lifecycle."""

    register_consumers(app.state.bus, params)
    tasks = [
        asyncio.create_task(start_sine_wave_producer(app.state.bus, params)),
        asyncio.create_task(start_log_producer(app.state.bus)),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = create_app(lifespan=lifespan)
mount_ai_routes(app)
