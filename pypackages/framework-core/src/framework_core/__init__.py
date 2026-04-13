import asyncio
import math
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .bus import EventBus


async def _demo_data_publisher(bus: EventBus) -> None:
    t = 0
    await bus.publish({"stream": "control", "event": "run_started"})

    while True:
        value = math.sin(t * 0.1)
        await bus.publish(
            {"stream": "data", "channel": "sine.output", "value": value, "t": t}
        )

        if t % 10 == 0:
            await bus.publish({"stream": "log", "text": f"step {t} complete"})

        t += 1
        await asyncio.sleep(0.25)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    bus: EventBus = app.state.event_bus
    app.state.publisher_task = asyncio.create_task(_demo_data_publisher(bus))

    yield

    task: asyncio.Task[None] | None = app.state.publisher_task
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.state.event_bus = EventBus()
    app.state.publisher_task = None

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket_stream(websocket: WebSocket) -> None:
        await websocket.accept()
        queue = app.state.event_bus.subscribe()
        try:
            while True:
                message: dict[str, Any] = await queue.get()
                await websocket.send_json(message)
        except WebSocketDisconnect:
            pass
        finally:
            app.state.event_bus.unsubscribe(queue)

    return app


app = create_app()
