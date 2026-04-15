from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from framework_core import create_app
from framework_core.bus import BaseEvent


class TemperatureReading(BaseEvent):
    value: float


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_websocket_subscribe_replays_last_message() -> None:
    """Subscribing to a channel that already has a stored message delivers it
    immediately, without waiting for the next publish cycle.

    The last message is published via a WebSocket ``publish`` action so that
    the test stays within a single event loop managed by ``TestClient``.
    Using ``asyncio.run(bus.publish(...))`` would create a *separate* loop and
    the message would never reach the app's loop.
    """
    app = create_app()

    with TestClient(app) as client:
        # Publish the seed message through the WebSocket itself so it lands in
        # the same event loop that the app is running on.
        with client.websocket_connect("/ws") as seed_ws:
            seed_ws.send_json(
                {
                    "action": "publish",
                    "channel": "sensor/temperature",
                    "payload": {"value": 22.5},
                }
            )

        # A fresh connection subscribes and should receive the replayed message.
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"action": "subscribe", "channel": "sensor/temperature"})
            received = ws.receive_json()

    assert received["channel"] == "sensor/temperature"
    assert received["headers"]["message_id"]
    assert isinstance(received["headers"]["timestamp"], int)
    # The payload from a client publish is wrapped in _ClientPublishEvent, so
    # the wire payload will be {"payload": {"value": 22.5}}.
    assert received["payload"]["payload"] == {"value": 22.5}


def test_websocket_subscribe_and_receive_live_message() -> None:
    """A subscriber receives a message published after it subscribed."""
    app = create_app()

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as subscriber:
            subscriber.send_json(
                {"action": "subscribe", "channel": "sensor/temperature"}
            )

            # Publish from a second connection on the same app.
            with client.websocket_connect("/ws") as publisher:
                publisher.send_json(
                    {
                        "action": "publish",
                        "channel": "sensor/temperature",
                        "payload": {"value": 37.0},
                    }
                )

            received = subscriber.receive_json()

    assert received["channel"] == "sensor/temperature"
    assert received["payload"]["payload"] == {"value": 37.0}


def test_websocket_unsubscribe_stops_delivery() -> None:
    """After unsubscribing, subsequent messages on that channel are not delivered."""
    app = create_app()

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"action": "subscribe", "channel": "sensor/temperature"})
            ws.send_json({"action": "unsubscribe", "channel": "sensor/temperature"})

            with client.websocket_connect("/ws") as publisher:
                publisher.send_json(
                    {
                        "action": "publish",
                        "channel": "sensor/temperature",
                        "payload": {"value": 0.0},
                    }
                )

            # No message should arrive; receive_json would block, so we check
            # the connection is still open and no data is pending instead.
            # TestClient's WebSocket doesn't expose a non-blocking peek, so we
            # send an invalid action and assert the error reply arrives first,
            # meaning no queued temperature message was buffered before it.
            ws.send_json({"action": "ping", "channel": "x"})
            reply = ws.receive_json()

    assert reply == {"error": "Unsupported action: ping"}


def test_websocket_invalid_action_returns_error() -> None:
    app = create_app()

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"action": "unknown", "channel": "sensor/temperature"})
            received = ws.receive_json()

    assert received == {"error": "Unsupported action: unknown"}


def test_websocket_missing_channel_returns_error() -> None:
    app = create_app()

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"action": "subscribe"})
            received = ws.receive_json()

    assert "error" in received


def test_create_app_uses_custom_lifespan_and_exposes_bus() -> None:
    """create_app() calls the custom lifespan and exposes the bus on app.state."""
    marker: dict[str, bool] = {"started": False, "stopped": False}

    @asynccontextmanager
    async def custom_lifespan(app: FastAPI):
        # By the time our lifespan runs, the framework has already set app.state.bus
        marker["started"] = hasattr(app.state, "bus")
        yield
        marker["stopped"] = True

    app = create_app(lifespan=custom_lifespan)

    # TestClient's context manager triggers startup and shutdown.
    with TestClient(app):
        pass

    assert marker == {"started": True, "stopped": True}
