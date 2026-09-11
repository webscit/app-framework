# Shared SimulationControls Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `LifecycleConsumer`/`SimulationStateEvent` base class to `sci_framework_core` and a `SimulationControls` widget to `@sci-framework/core-ui`, registered as a sixth opt-in default widget, so future example apps can drive simulation start/stop without re-implementing task-lifecycle bookkeeping.

**Architecture:** Backend: one new module `sci_framework_core/lifecycle.py` with a `SimulationStateEvent(BaseEvent)` payload model and an abstract `LifecycleConsumer` class that owns cancel/launch bookkeeping around two abstract hooks (`apply_params`, `run`). Frontend: one new widget folder `widgets/SimulationControls/` with a component built on the existing `useChannel`/`usePublish` hooks, plus a `SIMULATION_CONTROLS` entry in `defaultWidgets.ts`. No changes to `examples/drone` or `examples/reachy_mini` — this issue only adds the shared building blocks.

**Tech Stack:** Python: `pydantic`, `asyncio`, `pytest` + `pytest-anyio`. TypeScript: React 19, `vitest` + `@vitest/browser` (`vitest-browser-react`), existing `EventBusProvider`/`useChannel`/`usePublish` hooks.

## Global Constraints

- Package names in code are `sci_framework_core` (Python) and `@sci-framework/core-ui` (TypeScript) — the spec's `framework_core`/`framework-core-ui` names refer to the directories, not the import paths. Use the real import names throughout.
- Public APIs must be documented: Python docstrings with summary + `Args`/`Returns`; TypeScript JSDoc with description, `@param`/`@returns` (where applicable), `@example`. Every exported interface/type field needs an inline `/** ... */` comment.
- Every feature must be tested: Python behavior in pytest, TypeScript behavior in Vitest (`@vitest/browser` + `vitest-browser-react`, matching `StatusIndicator.test.tsx`).
- Testing selectors: prefer `page.getByRole(role, { name: "..." })`; no `data-testid` unless no accessible role exists.
- `SIMULATION_CONTROLS` is opt-in (not auto-registered), matching how `PARAMETER_CONTROLLER`/`LOG_VIEWER` etc. are opted into by consumers via `registry.register(...)`.
- The widget must NOT render the `phase` string itself — only Start/Stop buttons plus optional `title` — pairing with `STATUS_INDICATOR` is left to the consuming app.
- Run the full local quality bar before finishing: `ruff check .`, `pytest -q`, `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`.

---

## File Structure

- `pypackages/framework-core/src/sci_framework_core/lifecycle.py` — new: `SimulationStateEvent`, `LifecycleConsumer`.
- `pypackages/framework-core/tests/test_lifecycle.py` — new: unit tests for `LifecycleConsumer` via a minimal concrete subclass.
- `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.tsx` — new: component + props type.
- `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.css` — new: minimal styling, following `StatusIndicator.css` conventions.
- `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.test.tsx` — new: Vitest component tests.
- `packages/framework-core-ui/src/widgets/SimulationControls/index.ts` — new: barrel export, matching `StatusIndicator/index.ts` pattern.
- `packages/framework-core-ui/src/widgets/defaultWidgets.ts` — modify: add `SIMULATION_CONTROLS` export.
- `packages/framework-core-ui/src/widgets/defaultWidgets.test.ts` — modify: add a `describe("SIMULATION_CONTROLS", ...)` block.
- `packages/framework-core-ui/src/widgets/index.ts` — modify: re-export the new component/types/widget definition.
- `packages/framework-core-ui/src/index.ts` — modify: re-export the new component/types/widget definition from the package root.

---

### Task 1: Backend — `SimulationStateEvent` and `LifecycleConsumer`

**Files:**

- Create: `pypackages/framework-core/src/sci_framework_core/lifecycle.py`
- Test: `pypackages/framework-core/tests/test_lifecycle.py`

**Interfaces:**

- Consumes: `sci_framework_core.bus.BaseEvent`, `sci_framework_core.bus.EventBus` (existing — see `pypackages/framework-core/src/sci_framework_core/bus.py`).
- Produces:
  - `class SimulationStateEvent(BaseEvent)` with fields `phase: str` and `message: str = ""`.
  - `class LifecycleConsumer(ABC)` with constructor `__init__(self, bus: EventBus, state_channel: str) -> None`, public attribute `state_channel: str`, async `__call__(self, channel: str, message: BaseEvent) -> None` (the `EventHandler` signature the bus expects), and two abstract methods subclasses must implement: `apply_params(self, payload: dict[str, Any]) -> None` and `async def run(self) -> None`.

First, look at the existing duplicated logic this replaces, for context (read-only, do not modify): `examples/drone/backend/drone_example/consumers.py` — `ControlConsumer.__call__`, `_handle_command`, `_cancel_running`. `LifecycleConsumer` extracts exactly that cancel/launch bookkeeping.

- [ ] **Step 1: Write the failing tests**

Create `pypackages/framework-core/tests/test_lifecycle.py`:

```python
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from sci_framework_core.bus import BaseEvent, EventBus
from sci_framework_core.lifecycle import LifecycleConsumer, SimulationStateEvent


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _ClientPublishEvent(BaseEvent):
    """Mirrors the wire-format wrapper the ws_bridge uses for client publishes."""

    payload: Any


class _CountingConsumer(LifecycleConsumer):
    """Minimal concrete subclass for exercising LifecycleConsumer bookkeeping."""

    def __init__(self, bus: EventBus, state_channel: str) -> None:
        super().__init__(bus, state_channel)
        self.apply_params_calls: list[dict[str, Any]] = []
        self.run_calls = 0
        self.cancelled = 0
        self.started_event = asyncio.Event()
        self.release_event = asyncio.Event()

    def apply_params(self, payload: dict[str, Any]) -> None:
        self.apply_params_calls.append(payload)

    async def run(self) -> None:
        self.run_calls += 1
        self.started_event.set()
        try:
            await self.release_event.wait()
        except asyncio.CancelledError:
            self.cancelled += 1
            raise


@pytest.mark.anyio
async def test_start_command_launches_run() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    assert consumer.run_calls == 1

    consumer.release_event.set()
    await consumer._cancel_running()


@pytest.mark.anyio
async def test_stop_command_cancels_running_task() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "stop"}))

    assert consumer.cancelled == 1
    assert consumer._task is None


@pytest.mark.anyio
async def test_second_start_cancels_first_run_before_starting_second() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)
    consumer.started_event.clear()

    await consumer("sim/control", _ClientPublishEvent(payload={"command": "start"}))
    await asyncio.wait_for(consumer.started_event.wait(), timeout=1)

    assert consumer.run_calls == 2
    assert consumer.cancelled == 1

    consumer.release_event.set()
    await consumer._cancel_running()


@pytest.mark.anyio
async def test_apply_params_called_on_every_message_run_not_called_for_other_commands() -> (
    None
):
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer(
        "sim/control", _ClientPublishEvent(payload={"command": "noop", "x": 1})
    )
    await consumer(
        "sim/control", _ClientPublishEvent(payload={"command": "noop", "x": 2})
    )

    assert consumer.apply_params_calls == [
        {"command": "noop", "x": 1},
        {"command": "noop", "x": 2},
    ]
    assert consumer.run_calls == 0


@pytest.mark.anyio
async def test_malformed_non_dict_payload_is_ignored_not_raised() -> None:
    bus = EventBus()
    consumer = _CountingConsumer(bus, "sim/state")

    await consumer("sim/control", _ClientPublishEvent(payload="not-a-dict"))

    assert consumer.apply_params_calls == []
    assert consumer.run_calls == 0


def test_simulation_state_event_defaults() -> None:
    event = SimulationStateEvent(phase="idle")

    assert event.phase == "idle"
    assert event.message == ""
    assert event.message_id
    assert isinstance(event.timestamp, int)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pypackages/framework-core && uv run pytest tests/test_lifecycle.py -v`
Expected: FAIL / collection error with `ModuleNotFoundError: No module named 'sci_framework_core.lifecycle'`

- [ ] **Step 3: Write the implementation**

Create `pypackages/framework-core/src/sci_framework_core/lifecycle.py`:

```python
"""Shared simulation start/stop task-lifecycle bookkeeping.

``LifecycleConsumer`` extracts the cancel-then-launch task bookkeeping that
domain consumers (e.g. drone, reachy_mini) currently duplicate around their
own FMU/choreography-specific ``run()`` logic. Domain apps subclass it and
implement ``apply_params`` and ``run``; everything else (task tracking,
cancellation, payload unwrapping) is handled here.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any

from .bus import BaseEvent, EventBus

logger = logging.getLogger(__name__)


class SimulationStateEvent(BaseEvent):
    """Generic state payload published on a simulation's state channel.

    Domain apps may subclass this to add fields (e.g. a ``verdict`` field),
    the same way ``DroneStateEvent``/``ReachyStateEvent`` do today — this
    class only needs to satisfy ``LifecycleConsumer``'s bookkeeping, not
    replace domain-specific event types.
    """

    phase: str
    """Current lifecycle phase, e.g. ``"idle"``, ``"running"``, ``"done"``."""

    message: str = ""
    """Optional human-readable detail about the current phase."""


class LifecycleConsumer(ABC):
    """Owns the running-task lifecycle for a start/stop-shaped simulation.

    Subclasses implement ``apply_params`` (synchronous parameter overrides
    from a control payload) and ``run`` (one simulation run to completion,
    publishing ``SimulationStateEvent``s as it goes). This base class handles
    cancel-then-launch bookkeeping on ``"start"``/``"stop"`` commands and
    cancellation on a second ``"start"`` while one run is already active.

    Args:
        bus: Shared EventBus used to publish state events and run the task.
        state_channel: Channel this consumer's ``run()`` implementation
            should publish ``SimulationStateEvent``s to.
    """

    def __init__(self, bus: EventBus, state_channel: str) -> None:
        self._bus = bus
        self.state_channel = state_channel
        self._task: asyncio.Task[None] | None = None

    async def __call__(self, channel: str, message: BaseEvent) -> None:
        """Handle an incoming control-channel event.

        Args:
            channel: The channel the event arrived on.
            message: The raw event from the EventBus. Frontend publishes
                arrive wrapped in a ``payload`` field — unwrapped here to
                match the existing ``_ClientPublishEvent`` convention.

        Returns:
            None. Non-dict payloads are silently ignored.
        """
        data = message.model_dump()
        payload = data.get("payload", data)
        if not isinstance(payload, dict):
            return
        self.apply_params(payload)
        await self._handle_command(payload.get("command"))

    async def _handle_command(self, command: str | None) -> None:
        """Execute a lifecycle command.

        Args:
            command: ``"start"`` cancels any running task then launches a new
                one via ``run()``. ``"stop"`` cancels the running task. Any
                other value (including ``None``) is a no-op, leaving room for
                subclasses to handle their own commands (e.g. ``"reset"``) in
                ``apply_params`` without conflicting with this base class.

        Returns:
            None.
        """
        if command == "start":
            await self._cancel_running()
            self._task = asyncio.create_task(self.run())
        elif command == "stop":
            await self._cancel_running()

    async def _cancel_running(self) -> None:
        """Cancel the active run task, if any, and clear it.

        Returns:
            None.
        """
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Simulation task raised during cancellation")
        self._task = None

    @abstractmethod
    def apply_params(self, payload: dict[str, Any]) -> None:
        """Apply domain-specific parameter overrides from a control payload.

        Args:
            payload: Unwrapped control-event payload dict.

        Returns:
            None.
        """

    @abstractmethod
    async def run(self) -> None:
        """Run one simulation to completion, publishing SimulationStateEvents.

        Returns:
            None. Implementations should be cancellation-safe: on
            ``asyncio.CancelledError`` they should stop cleanly (the base
            class re-raises after catching it in ``_cancel_running``).
        """
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pypackages/framework-core && uv run pytest tests/test_lifecycle.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run ruff and mypy**

Run: `ruff check pypackages/framework-core/src/sci_framework_core/lifecycle.py pypackages/framework-core/tests/test_lifecycle.py`
Expected: no issues found

Run: `mypy pypackages/framework-core/src`
Expected: Success, no issues found

- [ ] **Step 6: Commit**

```bash
git add pypackages/framework-core/src/sci_framework_core/lifecycle.py pypackages/framework-core/tests/test_lifecycle.py
git commit -m "$(cat <<'EOF'
feat: add LifecycleConsumer and SimulationStateEvent to sci_framework_core

Extracts the cancel-then-launch task bookkeeping duplicated across
example ControlConsumers into a reusable base class (issue #33).

Claude-Session: https://claude.ai/code/session_011xVqwqfJNLnHvHctFwaAGu
EOF
)"
```

---

### Task 2: Frontend — `SimulationControls` component

**Files:**

- Create: `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.tsx`
- Create: `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.css`
- Create: `packages/framework-core-ui/src/widgets/SimulationControls/index.ts`
- Test: `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.test.tsx`

**Interfaces:**

- Consumes: `useChannel<T>(channel: string): T | null` from `packages/framework-core-ui/src/useChannel.ts`; `usePublish(): (channel: string, payload: unknown) => void` from `packages/framework-core-ui/src/usePublish.ts`; `EventBusProvider`, `WebSocketLike` from `packages/framework-core-ui/src/EventBusContext.tsx` / `client.ts` (test-only).
- Produces: `export interface SimulationControlsProps { stateChannel: string; controlChannel: string; runningPhase: string; title?: string }`; `export const SimulationControlsComponent: ComponentType<SimulationControlsProps>`; `export interface SimulationStatePayload { phase: string; message?: string }` (the shape read via `useChannel`; deliberately does NOT extend `BaseEvent` — that type lives in `src/index.ts` itself, and importing it from a widget file would create a circular import through `widgets/index.ts` → `index.ts`; this matches how `StatusIndicator.tsx`'s `ControlPayload` is defined).

- [ ] **Step 1: Write the failing tests**

Create `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.test.tsx`:

```tsx
import { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { SimulationControlsComponent } from "./SimulationControls";
import type { WebSocketLike } from "../../client";

class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState = FakeWebSocket.OPEN;
  public readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({} as CloseEvent);
  }
  open(): void {
    this.onopen?.({} as Event);
  }
  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function sendStateEvent(
  socket: FakeWebSocket,
  channel: string,
  phase: string,
  id = "msg-1",
): void {
  socket.receive(
    JSON.stringify({
      channel,
      headers: { message_id: id, timestamp: 1_000_000 },
      payload: { phase },
    }),
  );
}

describe("SimulationControlsComponent", () => {
  it("Start enabled and Stop disabled when no state event has arrived", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeDisabled();
  });

  it("Start disabled and Stop enabled when phase equals runningPhase", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "running");
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeEnabled();
  });

  it("Start stays enabled when phase differs from runningPhase", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "idle");
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeDisabled();
  });

  it('clicking Start publishes { command: "start" } to controlChannel', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await screen.getByRole("button", { name: "Start simulation" }).click();

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent).toEqual({
      channel: "sim/control",
      payload: { command: "start" },
    });
  });

  it('clicking Stop publishes { command: "stop" } to controlChannel', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "running");
    });

    await screen.getByRole("button", { name: "Stop simulation" }).click();

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent).toEqual({
      channel: "sim/control",
      payload: { command: "stop" },
    });
  });

  it("renders title when provided", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
          title="Drone Run"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText("Drone Run")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/framework-core-ui && npx vitest run src/widgets/SimulationControls/SimulationControls.test.tsx`
Expected: FAIL — cannot resolve `./SimulationControls` (module does not exist yet)

- [ ] **Step 3: Write the CSS**

Create `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.css`:

```css
.sct-SimulationControls-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px;
}

.sct-SimulationControls-title {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted-foreground, #6b7280);
}

.sct-SimulationControls-row {
  display: flex;
  gap: 8px;
}

.sct-SimulationControls-button {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #d1d5db);
  background: var(--background, #fff);
  font-size: 0.75rem;
  cursor: pointer;
}

.sct-SimulationControls-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Write the component**

Create `packages/framework-core-ui/src/widgets/SimulationControls/SimulationControls.tsx`:

```tsx
import type { ComponentType } from "react";

import { useChannel } from "../../useChannel";
import { usePublish } from "../../usePublish";
import "./SimulationControls.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the event payload read from `stateChannel` via {@link useChannel}.
 *
 * Deliberately does not extend `BaseEvent` (defined in `src/index.ts`) to
 * avoid a circular import between this widget and the package root.
 */
export interface SimulationStatePayload {
  /** Current lifecycle phase reported by the backend, e.g. `"idle"`, `"running"`. */
  phase: string;
  /** Optional human-readable detail about the current phase. */
  message?: string;
}

/**
 * Props for the {@link SimulationControlsComponent}.
 *
 * All props correspond to the `parameters` schema declared in `SIMULATION_CONTROLS`.
 */
export interface SimulationControlsProps {
  /** Channel to read simulation state (`{ phase, message }`) from. */
  stateChannel: string;
  /** Channel to publish `{ command: "start" | "stop" }` to. */
  controlChannel: string;
  /** Value of `phase` that means "a run is in flight". */
  runningPhase: string;
  /** Title shown above the controls. Omit to render no title. */
  title?: string;
}

const PREFIX = "sct-SimulationControls";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Generic start/stop controls for a start/stop-shaped simulation run.
 *
 * Subscribes to `stateChannel` via {@link useChannel} for `{ phase, message }`
 * and publishes `{ command: "start" }` / `{ command: "stop" }` to
 * `controlChannel` via {@link usePublish}. The Start button is disabled while
 * `phase === runningPhase`; the Stop button is disabled otherwise. Does not
 * render `phase`/`message` itself — pair with `StatusIndicator` for status
 * display.
 *
 * @param props Component props — see {@link SimulationControlsProps}.
 * @returns A Start/Stop control pair, with an optional title.
 * @example
 * ```tsx
 * <SimulationControlsComponent
 *   stateChannel="sim/state"
 *   controlChannel="sim/control"
 *   runningPhase="running"
 *   title="Simulation Controls"
 * />
 * ```
 */
export const SimulationControlsComponent: ComponentType<SimulationControlsProps> = ({
  stateChannel,
  controlChannel,
  runningPhase,
  title,
}) => {
  const state = useChannel<SimulationStatePayload>(stateChannel);
  const publish = usePublish();

  const isRunning = state?.phase === runningPhase;

  return (
    <div className={`${PREFIX}-container`}>
      {title && <div className={`${PREFIX}-title`}>{title}</div>}
      <div className={`${PREFIX}-row`}>
        <button
          type="button"
          aria-label="Start simulation"
          className={`${PREFIX}-button`}
          disabled={isRunning}
          onClick={() => publish(controlChannel, { command: "start" })}
        >
          Start
        </button>
        <button
          type="button"
          aria-label="Stop simulation"
          className={`${PREFIX}-button`}
          disabled={!isRunning}
          onClick={() => publish(controlChannel, { command: "stop" })}
        >
          Stop
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Write the barrel export**

Create `packages/framework-core-ui/src/widgets/SimulationControls/index.ts`:

```ts
export { SimulationControlsComponent } from "./SimulationControls";
export type {
  SimulationControlsProps,
  SimulationStatePayload,
} from "./SimulationControls";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/framework-core-ui && npx vitest run src/widgets/SimulationControls/SimulationControls.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add packages/framework-core-ui/src/widgets/SimulationControls
git commit -m "$(cat <<'EOF'
feat: add SimulationControls widget component

Generic start/stop controls reading phase from a state channel and
publishing start/stop commands to a control channel (issue #33).

Claude-Session: https://claude.ai/code/session_011xVqwqfJNLnHvHctFwaAGu
EOF
)"
```

---

### Task 3: Frontend — register `SIMULATION_CONTROLS` widget and export it

**Files:**

- Modify: `packages/framework-core-ui/src/widgets/defaultWidgets.ts`
- Modify: `packages/framework-core-ui/src/widgets/defaultWidgets.test.ts`
- Modify: `packages/framework-core-ui/src/widgets/index.ts`
- Modify: `packages/framework-core-ui/src/index.ts`

**Interfaces:**

- Consumes: `SimulationControlsComponent`, `SimulationControlsProps`, `SimulationStatePayload` from Task 2 (`./SimulationControls/SimulationControls`); `WidgetDefinition` from `../widgetRegistry`.
- Produces: `export const SIMULATION_CONTROLS: WidgetDefinition` with `name: "SimulationControls"`, `defaultRegion: "header"`.

- [ ] **Step 1: Write the failing test**

Edit `packages/framework-core-ui/src/widgets/defaultWidgets.test.ts` — add after the existing `STATUS_INDICATOR` describe block:

```ts
import { LOG_VIEWER, STATUS_INDICATOR, SIMULATION_CONTROLS } from "./defaultWidgets";
```

(replace the existing `import { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";` line with the line above), then append:

```ts
describe("SIMULATION_CONTROLS", () => {
  it("has defaultRegion set to header", () => {
    expect(SIMULATION_CONTROLS.defaultRegion).toBe("header");
  });

  it("factory returns a React component (not null, not a Promise)", () => {
    const result = SIMULATION_CONTROLS.factory({ parameters: {} });
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("declares stateChannel, controlChannel, runningPhase, and title parameters", () => {
    expect(SIMULATION_CONTROLS.parameters.stateChannel.default).toBe("sim/state");
    expect(SIMULATION_CONTROLS.parameters.controlChannel.default).toBe("sim/control");
    expect(SIMULATION_CONTROLS.parameters.runningPhase.default).toBe("running");
    expect(SIMULATION_CONTROLS.parameters.title.default).toBe("Simulation Controls");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/framework-core-ui && npx vitest run src/widgets/defaultWidgets.test.ts`
Expected: FAIL — `SIMULATION_CONTROLS` is not exported from `./defaultWidgets`

- [ ] **Step 3: Add the widget definition**

Edit `packages/framework-core-ui/src/widgets/defaultWidgets.ts` — add the import alongside the other component imports at the top:

```ts
import { StatusIndicatorComponent } from "./StatusIndicator/StatusIndicator";
import { SimulationControlsComponent } from "./SimulationControls/SimulationControls";
```

Then append after the `DATA_TABLE` definition at the end of the file:

```ts
/**
 * Built-in widget that renders generic start/stop controls for a
 * start/stop-shaped simulation run.
 *
 * Reads `phase`/`message` from a configurable state channel and publishes
 * `{ command: "start" | "stop" }` to a configurable control channel. Does
 * not render `phase` itself — pair with `STATUS_INDICATOR` for status
 * display. Not auto-registered by default, since not every app has a
 * start/stop-shaped simulation. Defaults to the `"header"` layout region.
 */
export const SIMULATION_CONTROLS: WidgetDefinition = {
  name: "SimulationControls",
  description:
    "Generic start/stop controls for a simulation run. Reads phase/message " +
    "from a state channel and publishes start/stop commands to a control " +
    "channel.",
  channelPattern: "*/state",
  consumes: [],
  priority: 10,
  defaultRegion: "header",
  parameters: {
    stateChannel: { type: "string", default: "sim/state" },
    controlChannel: { type: "string", default: "sim/control" },
    runningPhase: { type: "string", default: "running" },
    title: { type: "string", default: "Simulation Controls" },
  },
  factory: () => SimulationControlsComponent as ComponentType,
};
```

- [ ] **Step 4: Update the widgets barrel export**

Edit `packages/framework-core-ui/src/widgets/index.ts`:

```ts
export { StatusIndicatorComponent } from "./StatusIndicator";
export type { StatusIndicatorProps, SimulationStatus } from "./StatusIndicator";

export { SimulationControlsComponent } from "./SimulationControls";
export type {
  SimulationControlsProps,
  SimulationStatePayload,
} from "./SimulationControls";

export {
  LOG_VIEWER,
  STATUS_INDICATOR,
  PARAMETER_CONTROLLER,
  CHART,
  DATA_TABLE,
  SIMULATION_CONTROLS,
} from "./defaultWidgets";
```

(the `LOG_VIEWER, STATUS_INDICATOR, ...` export list replaces the existing one — add `SimulationControlsComponent`/type exports as new lines, and add `SIMULATION_CONTROLS` to the existing re-export list.)

- [ ] **Step 5: Update the package root export**

Edit `packages/framework-core-ui/src/index.ts` — replace the existing:

```ts
export {
  LOG_VIEWER,
  STATUS_INDICATOR,
  PARAMETER_CONTROLLER,
  CHART,
  DATA_TABLE,
} from "./widgets/defaultWidgets";
```

with:

```ts
export {
  LOG_VIEWER,
  STATUS_INDICATOR,
  PARAMETER_CONTROLLER,
  CHART,
  DATA_TABLE,
  SIMULATION_CONTROLS,
} from "./widgets/defaultWidgets";
```

and add, after the existing `StatusIndicatorComponent`/`StatusIndicatorProps` export block:

```ts
export { SimulationControlsComponent } from "./widgets/SimulationControls";
export type {
  SimulationControlsProps,
  SimulationStatePayload,
} from "./widgets/SimulationControls";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/framework-core-ui && npx vitest run src/widgets/defaultWidgets.test.ts src/widgets/SimulationControls/SimulationControls.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 7: Full frontend quality bar**

Run: `npm run typecheck`
Expected: no errors

Run: `npm run lint`
Expected: no errors

Run: `npm run format:check`
Expected: no issues (if formatting issues are reported, run `npm run format` then re-check)

Run: `npm run test`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/framework-core-ui/src/widgets/defaultWidgets.ts packages/framework-core-ui/src/widgets/defaultWidgets.test.ts packages/framework-core-ui/src/widgets/index.ts packages/framework-core-ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat: register SIMULATION_CONTROLS as a sixth opt-in default widget

Adds SIMULATION_CONTROLS to defaultWidgets.ts and exports it from the
widgets barrel and package root, alongside LOG_VIEWER, STATUS_INDICATOR,
PARAMETER_CONTROLLER, CHART, and DATA_TABLE (issue #33).

Claude-Session: https://claude.ai/code/session_011xVqwqfJNLnHvHctFwaAGu
EOF
)"
```

---

### Task 4: Full-repo verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run Python quality bar**

Run: `ruff check .`
Expected: All checks passed!

Run: `pytest -q`
Expected: all tests pass, including the new `tests/test_lifecycle.py`

Run: `mypy pypackages/framework-core/src`
Expected: Success, no issues found

- [ ] **Step 2: Run TypeScript quality bar**

Run: `npm run format`
Expected: no changes needed (or auto-fixed and re-run `git status` to confirm only intended files changed)

Run: `npm run lint`
Expected: no errors

Run: `npm run typecheck`
Expected: no errors

Run: `npm run test`
Expected: all tests pass

- [ ] **Step 3: Confirm no changes to examples/**

Run: `git diff --stat main -- examples/`
Expected: empty output (no example retrofits in this issue — out of scope per the spec)

- [ ] **Step 4: Final commit check**

Run: `git status`
Expected: clean (all changes already committed in Tasks 1–3)
