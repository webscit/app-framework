from __future__ import annotations

from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .bus import BaseEvent, EventBus, EventHandler


class _ClientPublishEvent(BaseEvent):
    """Wraps a raw JSON payload published by a frontend client over WebSocket.

    Backend consumers subscribed to the same channel will receive this type.
    The original payload is preserved in the ``payload`` field.
    """

    payload: Any


def _event_to_wire_message(channel: str, message: BaseEvent) -> dict[str, Any]:
    """Serialise ``message`` into the wire envelope format.

    The envelope separates standard header fields (``message_id``,
    ``timestamp``) from domain-specific payload fields so consumers on
    both ends of the socket have a consistent structure to parse.

    Returns a dict of the shape::

        {
            "channel": "sensor/temperature",
            "headers": {"message_id": "...", "timestamp": 1712345678123},
            "payload": {"value": 22.5, "unit": "celsius"},
        }
    """
    payload = message.model_dump(exclude={"message_id", "timestamp"})
    return {
        "channel": channel,
        "headers": {
            "message_id": message.message_id,
            "timestamp": message.timestamp,
        },
        "payload": payload,
    }


def _mount_ws_bridge(app: FastAPI, bus: EventBus) -> None:
    """Mount a multiplexed ``/ws`` WebSocket endpoint that bridges to ``bus``.

    Each connected client maintains its own subscription map.  All channel
    traffic for a single browser tab is multiplexed over one connection.

    Supported client actions
    ------------------------
    subscribe   – start receiving messages on *channel*; the last stored
                  message (if any) is sent immediately.
    unsubscribe – stop receiving messages on *channel*.
    publish     – forward a payload to all subscribers of *channel*,
                  including other connected WebSocket clients and any
                  backend consumers.

    The handler passed to ``bus.subscribe`` is async, so ``EventBus`` must
    schedule its invocation via ``asyncio.create_task`` to avoid blocking the
    publish call and to guarantee that the replay on subscribe is actually
    awaited (see ``EventBus.subscribe``).
    """

    @app.websocket("/ws")
    async def websocket_bridge(websocket: WebSocket) -> None:
        await websocket.accept()

        # channel → handler mapping for this connection only
        subscriptions: dict[str, EventHandler] = {}

        def _make_handler() -> EventHandler:
            async def _handler(channel: str, message: BaseEvent) -> None:
                await websocket.send_json(_event_to_wire_message(channel, message))

            return _handler

        try:
            while True:
                data = await websocket.receive_json()
                if not isinstance(data, dict):
                    await websocket.send_json({"error": "Invalid message format"})
                    continue

                action = data.get("action")
                channel = data.get("channel")
                if not isinstance(action, str) or not isinstance(channel, str):
                    await websocket.send_json(
                        {"error": "Messages must include string action and channel"}
                    )
                    continue

                if action == "subscribe":
                    if channel in subscriptions:
                        continue
                    handler = _make_handler()
                    subscriptions[channel] = handler
                    # EventBus.subscribe schedules any last-message replay as an
                    # asyncio task, so the async handler is properly awaited.
                    bus.subscribe(channel, handler)
                    continue

                if action == "unsubscribe":
                    if channel in subscriptions:
                        handler = subscriptions.pop(channel)
                        bus.unsubscribe(channel, handler)
                    continue

                if action == "publish":
                    payload = data.get("payload")
                    # Wrap the raw payload in a typed event so the bus can
                    # attach standard headers (message_id, timestamp) and
                    # route it to all subscribers including backend consumers.
                    # Backend consumers will receive a _ClientPublishEvent with
                    # the original payload preserved in the ``payload`` field.
                    await bus.publish(channel, _ClientPublishEvent(payload=payload))
                    continue

                await websocket.send_json({"error": f"Unsupported action: {action}"})
        except WebSocketDisconnect:
            pass
        finally:
            for ch, handler in list(subscriptions.items()):
                bus.unsubscribe(ch, handler)
