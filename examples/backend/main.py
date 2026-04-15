from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from framework_core import create_app

from .consumers import register_consumers
from .producers import start_log_producer, start_sine_wave_producer


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Register demo services and manage producer task lifecycle."""

    register_consumers(app.state.bus)
    tasks = [
        asyncio.create_task(start_sine_wave_producer(app.state.bus)),
        asyncio.create_task(start_log_producer(app.state.bus)),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = create_app(lifespan=lifespan)
