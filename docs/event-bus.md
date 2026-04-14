# Event Bus & Real-Time Communication — API Specification

> **Status:** Draft — open for review before implementation  
> **Context:** Resolves the specification requirement raised in PR #4 review feedback.

---

## 1. Overview

This document specifies how **producers** and **consumers** of events interact with the framework's event system, on both the backend (Python/FastAPI) and the frontend (React/TypeScript).

The model is **channel-based**, following [AsyncAPI](https://www.asyncapi.com/en) conventions:

- A **channel** is a named address (e.g. `sensor/temperature`, `logs/app`) through which messages flow.
- A **producer** publishes messages to a channel.
- A **consumer** subscribes to a channel and receives messages via a handler callback.
- The **EventBus** is the in-process broker that routes messages between producers and consumers.
- The **WebSocket bridge** connects the backend EventBus to frontend consumers over a single, multiplexed WebSocket connection.

---

## 2. Package Layout

```
examples/                        ← all demo/example code lives here (root level)
  backend/
    producers.py                 ← demo sine-wave & log publishers
    consumers.py                 ← demo log consumer (writes to Python logger)
    main.py                      ← mounts framework + registers demo producers/consumers
  frontend/
    src/
      useSimulation.ts           ← simulation-specific hook (uses useChannel)
      main.tsx                   ← demo UI

pypackages/
  framework-core/                ← reusable framework only, no demo code
    src/framework_core/
      bus.py                     ← BaseEvent, EventBus
      ws_bridge.py               ← WebSocket → EventBus bridge
      __init__.py                ← create_app() factory

packages/
  framework-core-ui/             ← reusable frontend framework primitives
    src/
      EventBusContext.tsx        ← React context + provider
      useChannel.ts              ← generic channel subscription hook
      usePublish.ts              ← generic publish hook
      useEventBusStatus.ts       ← connection status hook
```

---

## 3. Backend API

### 3.1 Message Envelope — `BaseEvent`

All events published on the bus must inherit from `BaseEvent`. This provides a standard message header inspired by the [AsyncAPI MessageObject](https://www.asyncapi.com/docs/reference/specification/v3.1.0#messageObject) and [Jupyter messaging protocol](https://jupyter-protocol.readthedocs.io/en/latest/messaging.html#general-message-format).

```python
import uuid, time
from pydantic import BaseModel, Field

class BaseEvent(BaseModel):
    """Base class for all framework events.

    Provides standard header fields that are set automatically on instantiation.
    Subclasses only need to define their domain-specific fields.
    """
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """Unique message identifier (UUID v4), auto-generated."""

    timestamp: int = Field(default_factory=lambda: time.time_ns() // 1000)
    """Creation time in microseconds since Unix epoch, auto-generated."""
```

Subclasses only define their specific fields:

```python
# In example app — not in framework-core
from framework_core.bus import BaseEvent

class TemperatureReading(BaseEvent):
    value: float
    unit: str = "celsius"

class LogEntry(BaseEvent):
    level: str
    message: str

# message_id and timestamp are set automatically — no need to pass them
reading = TemperatureReading(value=22.5)
```

The wire format over WebSocket follows this envelope, aligned with AsyncAPI conventions:

```json
{
  "channel": "sensor/temperature",
  "headers": {
    "message_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": 1712345678123456
  },
  "payload": {
    "value": 22.5,
    "unit": "celsius"
  }
}
```

---

### 3.2 EventBus

The `EventBus` lives entirely in-process on the server. It is a **custom implementation** (no third-party library) designed as a facade — the internal implementation can be swapped for a more capable provider (e.g. Zenoh) later without affecting application code.

#### Key design decisions

- Consumers register **async handler callbacks** — no queue objects are ever exposed.
- Channel routing uses **`fnmatch`-style glob patterns**, so wildcards are supported from the start (e.g. `sensor/*`, `*`).
- The bus stores the **last message per channel** so new subscribers receive it immediately on subscribe.
- Messages are processed in **publish order** — a more recent event is never delivered before an older one on the same channel.
- The framework consumer never sees any third-party library types — only `BaseEvent` and the `EventBus` API.

#### Channel naming convention

Channels follow a `/`-separated path pattern, compatible with glob matching:

```
sensor/temperature
sensor/humidity
logs/app
commands/reset
```

#### Subscribing (consumer)

```python
from framework_core.bus import EventBus, BaseEvent

class TemperatureReading(BaseEvent):
    value: float
    unit: str = "celsius"

bus = EventBus()

async def on_temperature(channel: str, message: BaseEvent) -> None:
    """Called whenever a message arrives on a matching channel."""
    print(f"[{channel}] {message}")

# Exact channel
bus.subscribe("sensor/temperature", on_temperature)

# Wildcard — receives all sensor readings
bus.subscribe("sensor/*", on_temperature)
```

On subscribe, if the bus holds a last message for any channel matching the pattern, the handler is called immediately with it.

#### Unsubscribing

```python
bus.unsubscribe("sensor/temperature", on_temperature)
```

#### Publishing (producer)

```python
await bus.publish("sensor/temperature", TemperatureReading(value=22.5))
```

#### EventBus interface

```python
class EventBus:
    def subscribe(self, channel: str, handler: Callable[[str, BaseEvent], Awaitable[None]]) -> None:
        """Register an async handler for messages on channels matching `channel`.

        `channel` supports fnmatch glob patterns (e.g. 'sensor/*').
        If a last message exists for a matching channel, the handler is
        called immediately with it.
        """

    def unsubscribe(self, channel: str, handler: Callable[[str, BaseEvent], Awaitable[None]]) -> None:
        """Remove a previously registered handler."""

    async def publish(self, channel: str, message: BaseEvent) -> None:
        """Publish `message` to all handlers whose subscription pattern matches `channel`.

        Stores `message` as the last message for `channel`.
        Handlers are called in subscription order.
        """
```

#### Backend-to-backend pub/sub example

The bus is not only for frontend consumers. Backend services can subscribe to each other:

```python
# examples/backend/consumers.py
import logging
from framework_core.bus import EventBus, BaseEvent

logger = logging.getLogger(__name__)

async def log_consumer(channel: str, message: BaseEvent) -> None:
    """Subscribe to 'logs/app' and forward messages to Python's logging system."""
    logger.info("[%s] %s", channel, message.model_dump())

def register_consumers(bus: EventBus) -> None:
    bus.subscribe("logs/app", log_consumer)
```

---

### 3.3 Application Factory & Lifespan

`create_app()` is the framework's entry point. It accepts a `lifespan` context manager so the example app can register its producers and consumers cleanly, with guaranteed cleanup on shutdown.

Task references are kept to prevent garbage collection.

```python
# framework_core/__init__.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from framework_core.bus import EventBus

def create_app(lifespan=None) -> FastAPI:
    """Create and return a configured FastAPI application.

    Mounts the /ws WebSocket endpoint backed by a shared EventBus.
    The application's EventBus is accessible via app.state.bus.

    Args:
        lifespan: Optional async context manager for startup/shutdown hooks.
    """
    bus = EventBus()

    @asynccontextmanager
    async def _default_lifespan(app: FastAPI):
        app.state.bus = bus
        if lifespan:
            async with lifespan(app):
                yield
        else:
            yield

    app = FastAPI(lifespan=_default_lifespan)
    _mount_ws_bridge(app, bus)
    return app
```

The **example app** uses the lifespan to register producers and consumers, holding task references:

```python
# examples/backend/main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from framework_core import create_app
from examples.backend.producers import start_sine_wave_producer, start_log_producer
from examples.backend.consumers import register_consumers

@asynccontextmanager
async def lifespan(app: FastAPI):
    register_consumers(app.state.bus)
    tasks = [
        asyncio.create_task(start_sine_wave_producer(app.state.bus)),
        asyncio.create_task(start_log_producer(app.state.bus)),
    ]
    yield
    # Clean up on shutdown — cancel all background tasks
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

app = create_app(lifespan=lifespan)
```

---

### 3.4 WebSocket Bridge

The bridge exposes the backend `EventBus` to frontend clients over a **single WebSocket endpoint** (`/ws`). All channel traffic is multiplexed over this one connection. Each client only receives messages for channels it has explicitly subscribed to.

#### Subscription handshake (client → server)

```json
{ "action": "subscribe",   "channel": "sensor/temperature" }
{ "action": "unsubscribe", "channel": "sensor/temperature" }
```

On subscribe, if a last message exists for that channel, the server sends it immediately.

---

## 4. Frontend API

### 4.1 EventBusProvider

A single WebSocket connection is opened at the app root and shared across all widgets via React context — **one connection per browser tab**, regardless of how many widgets subscribe.

The provider takes a **path** only (not a full URL), making it deployment-friendly:

```tsx
import { EventBusProvider } from "@app-framework/core-ui";

function App() {
  return (
    <EventBusProvider path="/ws">
      <Dashboard />
    </EventBusProvider>
  );
}
```

The provider derives the full WebSocket URL from the current page's host at runtime, so no hardcoded hostnames leak into the code.

### 4.2 `useChannel<T>` — consuming events in a widget

Subscribes to a channel and returns the latest message. Supports wildcard patterns.

```tsx
import { useChannel } from "@app-framework/core-ui";

interface TemperatureReading {
  message_id: string;
  timestamp: number;
  value: number;
  unit: string;
}

function TemperatureWidget() {
  // Exact channel
  const data = useChannel<TemperatureReading>("sensor/temperature");

  // Or wildcard — receives latest message from any matching channel
  // const data = useChannel<TemperatureReading>("sensor/*");

  if (!data) return <p>Waiting for data…</p>;
  return <p>{data.value}°{data.unit}</p>;
}
```

Signature:

```ts
function useChannel<T>(channel: string): T | null;
```

- Sends `{ action: "subscribe", channel }` on mount.
- Sends `{ action: "unsubscribe", channel }` on unmount.
- Returns the latest deserialized payload (including `message_id` and `timestamp` from the envelope header), or `null` before the first message.
- If the backend has a last message for that channel, it arrives immediately — no waiting for the next publish cycle.

### 4.3 `usePublish` — sending events from a widget

```tsx
import { usePublish } from "@app-framework/core-ui";

function ResetButton() {
  const publish = usePublish();

  return (
    <button onClick={() => publish("commands/reset", { target: "sensor-1" })}>
      Reset Sensor
    </button>
  );
}
```

Signature:

```ts
function usePublish(): (channel: string, payload: unknown) => void;
```

### 4.4 `useEventBusStatus` — connection status

```tsx
import { useEventBusStatus } from "@app-framework/core-ui";

function StatusBar() {
  const status = useEventBusStatus(); // "connecting" | "connected" | "disconnected"
  return <span>Bus: {status}</span>;
}
```

---

## 5. Example App (end-to-end)

All example code lives under `examples/` — nothing simulation-specific leaks into framework packages.

### Backend (`examples/backend/producers.py`)

```python
import asyncio, math, time
from framework_core.bus import EventBus, BaseEvent

class SineReading(BaseEvent):
    value: float

class LogEntry(BaseEvent):
    level: str
    message: str

async def start_sine_wave_producer(bus: EventBus) -> None:
    """Publish a sine wave reading to 'data/sine' every 100 ms."""
    t = 0.0
    while True:
        await bus.publish("data/sine", SineReading(value=math.sin(t)))
        t += 0.1
        await asyncio.sleep(0.1)

async def start_log_producer(bus: EventBus) -> None:
    """Publish a heartbeat log entry to 'logs/app' every second."""
    while True:
        await bus.publish("logs/app", LogEntry(level="info", message="heartbeat"))
        await asyncio.sleep(1.0)
```

### Frontend (`examples/frontend/src/useSimulation.ts`)

```ts
// Example-app specific — lives in examples/, not framework-core-ui
import { useChannel } from "@app-framework/core-ui";

interface SineReading { message_id: string; timestamp: number; value: number; }
interface LogEntry    { message_id: string; timestamp: number; level: string; message: string; }

export function useSimulation() {
  const sine = useChannel<SineReading>("data/sine");
  const log  = useChannel<LogEntry>("logs/app");
  return { sine, log };
}
```

---

## 6. Decisions Made

| Topic | Decision |
|---|---|
| EventBus library | Custom implementation; facade pattern so internals can be swapped later (e.g. Zenoh) |
| Wildcard subscriptions | Supported via `fnmatch` glob matching from the start |
| Last message replay | New subscriber immediately receives the last message on matching channels |
| Backend-initiated unsubscribe | Out of scope |
| EventBusProvider config | Path only (`/ws`), not full URL |
| `app.on_event` | Replaced with FastAPI `lifespan` context manager; task references kept |
| Binary payloads | Future consideration (relevant for heavy simulation data) |
| Authentication | Out of scope (local single-device deployment) |
| Third-party library exposure | Internal libs (e.g. Zenoh) must never be visible to framework consumers |

---

## 7. Out of Scope for This PR

- Authentication / authorization on channels
- Backend-initiated subscription revocation
- Multi-server / distributed EventBus
- Binary message payloads (future, for large simulation datasets)
- Persistent message queues / full replay history (only last message is stored)