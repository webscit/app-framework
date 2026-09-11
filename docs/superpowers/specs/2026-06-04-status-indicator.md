# Status Indicator Widget — Implementation Plan

**Goal:** Provide a built-in widget that shows the live run state of a simulation — one of four states (`running`, `paused`, `converged`, `failed`) — driven by events arriving on a `control/*` EventBus channel, defaulting to the `status-bar` shell region.

**Architecture:** Follows the same pattern as `LogViewer`. The widget is a `WidgetDefinition` in `defaultWidgets.ts` whose `factory` returns `StatusIndicatorComponent`. The component subscribes to a configurable EventBus channel via `useEventBusClient`, extracts the `status` field from incoming `application/x-control+json` payloads, and renders a coloured pill badge alongside an optional human-readable label and a "last seen" timestamp. A single `setInterval` (1000 ms) handles both staleness detection and last-seen string refresh. A `StatusIndicatorPlaceholder` already occupies the `STATUS_INDICATOR` slot in `defaultWidgets.ts` — the real component replaces it.

**Tech Stack:** TypeScript — React, CSS class names prefixed with `sct-StatusIndicator-`. No new npm dependencies. shadcn UI primitives are not required — the badge is a plain styled `<span>`.

---

## 1. Problem Statement

Simulation engineers running long jobs need to know at a glance whether the simulation is still running, has paused waiting for input, has converged successfully, or has hit an error. Today there is no built-in widget that reads this state from the EventBus and displays it visually.

The Status Indicator widget solves this by subscribing to a `control/*` channel and rendering a colour-coded badge that updates in real time.

**Best example:** The backend publishes `{ "status": "running" }` on `control/sim` every second as a heartbeat. The Status Indicator subscribes to `control/sim`, shows a green "Running" pill in the status bar, and updates the "Last seen" time on every heartbeat. When the backend publishes `{ "status": "converged" }`, the pill turns blue. If the channel goes silent (no event in > `staleAfterMs` ms), the widget greys out, indicating a lost connection.

**What this solves:**

- Instant visual feedback on simulation run state without custom code
- Staleness detection — greys out when heartbeats stop arriving
- Optional label customisation per placement
- Compact design suited to the `status-bar` region

**What this does not solve (out of scope):**

- Multiple simultaneous statuses in one widget (one channel per instance)
- Sound or browser-notification alerts
- Historical status timeline or state-change log
- Percentage progress or ETA

---

## 2. Scope

**In scope:**

- `StatusIndicatorComponent` — React component subscribing to an EventBus channel and rendering a coloured status badge
- `StatusIndicatorProps` interface and `SimulationStatus` union type
- Four named statuses: `running`, `paused`, `converged`, `failed`
- Staleness detection with configurable `staleAfterMs` threshold (default 5000 ms)
- Optional human-readable label above/beside the badge (configurable via `label` prop)
- Optional "last seen" timestamp (configurable via `showLastSeen` prop)
- `StatusIndicator.css` with `sct-StatusIndicator-` prefixed class names
- `index.ts` re-export barrel
- Replace `StatusIndicatorPlaceholder` in `defaultWidgets.ts` with real component
- Export `StatusIndicatorComponent` and `StatusIndicatorProps` from package `index.ts`
- Full Vitest unit tests
- Backend example: add a heartbeat producer publishing to `control/sim`

**Out of scope:**

- Custom colour overrides per status
- Click-to-expand detail panel
- Progress percentage field
- Multiple channels in one instance

---

## 3. Status States

| Status      | CSS modifier class                     | Colour            | Description                                      |
| ----------- | -------------------------------------- | ----------------- | ------------------------------------------------ |
| `running`   | `sct-StatusIndicator-badge--running`   | `#22c55e` (green) | Simulation is actively computing                 |
| `paused`    | `sct-StatusIndicator-badge--paused`    | `#f59e0b` (amber) | Simulation is paused, waiting for resume         |
| `converged` | `sct-StatusIndicator-badge--converged` | `#3b82f6` (blue)  | Simulation completed successfully                |
| `failed`    | `sct-StatusIndicator-badge--failed`    | `#ef4444` (red)   | Simulation encountered an error and stopped      |
| `unknown`   | `sct-StatusIndicator-badge--unknown`   | `#6b7280` (grey)  | No event received yet, or channel has gone stale |

The `unknown` state is internal — it is not a valid value in the incoming payload. It is the initial state before any event arrives and the stale state after the staleness threshold is exceeded.

---

## 4. Data Model

### 4.1 `SimulationStatus` union type

```typescript
/** The four valid statuses the backend can publish. */
export type SimulationStatus = "running" | "paused" | "converged" | "failed";
```

### 4.2 Internal display state

```typescript
/** Internal state including staleness tracking. */
type DisplayStatus = SimulationStatus | "unknown";
```

### 4.3 Expected payload shape

The component expects the EventBus channel to carry JSON payloads with at least a `status` field:

```typescript
interface ControlPayload {
  /** One of the four SimulationStatus values. */
  status: SimulationStatus;
  /** Optional free-form message shown beside the badge (e.g. "Iteration 42"). */
  message?: string;
}
```

The `status` field is extracted from the raw `event.payload` object after JSON deserialization. If the field is missing or not one of the four valid values, the component logs a `console.warn` and ignores the event — it does not change the current display state.

### 4.4 `StatusIndicatorProps` interface

```typescript
export interface StatusIndicatorProps {
  /**
   * EventBus channel to subscribe to.
   * Supports glob patterns e.g. "control/*".
   * Default: "control/*"
   */
  channel?: string;
  /**
   * Human-readable label rendered beside the status badge.
   * Default: "Simulation Status"
   */
  label?: string;
  /**
   * Show the "Last seen: <relative time>" line below the badge.
   * Default: true
   */
  showLastSeen?: boolean;
  /**
   * Milliseconds of silence after which the widget enters the stale
   * (unknown) state. Set to 0 to disable staleness detection.
   * Default: 5000
   */
  staleAfterMs?: number;
}
```

---

## 5. Component Behaviour

### 5.1 Mount

On mount the component:

1. Initialises `displayStatus = "unknown"`, `lastSeenMs = null`, and `message = null`.
2. Subscribes to the configured `channel` via `useEventBusClient`. The client performs client-side replay — if a previous event for the channel is cached, the subscription callback fires immediately with it. This means the badge may show a known last state from before a page reload rather than starting as `unknown`.
3. If `staleAfterMs > 0`, starts a single `setInterval` (1000 ms) that handles both staleness detection and last-seen string refresh (see §5.3).

### 5.2 Incoming event

On each event received from the channel:

1. Cast `event.payload` to `ControlPayload`.
2. Validate `payload.status` is one of `["running", "paused", "converged", "failed"]`. If not, emit `console.warn` and return early.
3. Set `displayStatus = payload.status`.
4. Set `lastSeenMs = event.headers.timestamp` (server-assigned Unix ms — used rather than `Date.now()` so that client-side replayed old events are not treated as fresh heartbeats).
5. Store `payload.message` (optional) in component state.

### 5.3 Single interval — staleness + last-seen refresh

One `setInterval` at 1000 ms (only started when `staleAfterMs > 0`) does both jobs:

```typescript
setInterval(() => {
  if (lastSeenMs !== null && Date.now() - lastSeenMs > staleAfterMs) {
    setDisplayStatus("unknown");
  }
  setNow(Date.now()); // triggers re-render to update relative time string
}, 1000);
```

`now` is a `useState<number>` initialised to `Date.now()` whose only purpose is to trigger a re-render so the "Xs ago" string stays current. The interval is cleared on unmount.

### 5.4 Channel prop change

When `channel` changes the component resubscribes and resets to `displayStatus = "unknown"`, `lastSeenMs = null`, `message = null` — identical to the behaviour of `LogViewer` when its `channel` prop changes.

### 5.5 Rendering

```
┌─────────────────────────────────────────────────┐
│  Simulation Status   ● Running                  │
│                      Last seen: 2s ago          │
└─────────────────────────────────────────────────┘
```

- **Label** (`label` prop) — rendered as plain text to the left of the badge row.
- **Badge** — a `<span>` with a filled circle `●` and the capitalised status name. Background colour matches the status modifier class.
- **Message** (optional) — `payload.message` rendered in smaller text below the badge when present.
- **Last seen** — relative time string `"Xs ago"` derived from `lastSeenMs` and the `now` state updated by the interval.

### 5.6 Unknown state

When `displayStatus === "unknown"`:

- Badge renders `● Unknown` using the `sct-StatusIndicator-badge--unknown` modifier.
- "Last seen" line renders `"Never"` if no event has ever arrived, or `"Xs ago"` if the channel went stale.

### 5.7 Unsubscribe on unmount

The subscription (returned by `client.subscribe`) and the `setInterval` are both cleared in the `useEffect` cleanup, mirroring the `LogViewer` pattern.

---

## 6. Widget Definition

The `STATUS_INDICATOR` export already exists in `defaultWidgets.ts` with a placeholder factory. The task is to replace `StatusIndicatorPlaceholder` with `StatusIndicatorComponent` and update the `parameters` to match the real props:

```typescript
export const STATUS_INDICATOR: WidgetDefinition = {
  name: "StatusIndicator",
  description:
    "Displays heartbeat and run status from the control channel. " +
    "Shows connection status, last heartbeat time, and simulation run state.",
  channelPattern: "control/*",
  consumes: ["application/x-control+json"],
  priority: 10,
  defaultRegion: "status-bar",
  parameters: {
    channel: { type: "string", default: "control/*" },
    label: { type: "string", default: "Simulation Status" },
    showLastSeen: { type: "boolean", default: true },
    staleAfterMs: { type: "integer", default: 5000, minimum: 0, maximum: 60000 },
  },
  factory: () => StatusIndicatorComponent,
};
```

---

## 7. Example Usage (Frontend)

```tsx
import { STATUS_INDICATOR } from "@app-framework/core-ui";

registry.register(STATUS_INDICATOR);

const layout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    "status-bar": {
      visible: true,
      items: [
        {
          id: "sim-status",
          type: "StatusIndicator",
          props: {
            channel: "control/sim",
            label: "Simulation Status",
            showLastSeen: true,
            staleAfterMs: 5000,
          },
          order: 0,
        },
      ],
    },
  },
};
```

---

## 8. Backend Contract (Example)

A new `start_heartbeat_producer` in the backend example publishes to `control/sim` every second:

```python
# examples/backend/producers.py

from typing import Literal

class ControlEvent(BaseEvent):  # type: ignore[misc]
    """Heartbeat event published to the control channel."""

    status: Literal["running", "paused", "converged", "failed"]
    message: str | None = None

async def start_heartbeat_producer(bus: EventBus) -> None:
    """Publishes a running heartbeat on control/sim every second."""
    iteration = 0
    while True:
        await bus.publish(
            "control/sim",
            ControlEvent(status="running", message=f"Iteration {iteration}"),
        )
        iteration += 1
        await asyncio.sleep(1.0)
```

Wired via `lifespan` in `examples/backend/main.py`:

```python
asyncio.create_task(start_heartbeat_producer(bus))
```

---

## 9. File Structure

```
packages/framework-core-ui/src/
  widgets/
    StatusIndicator/
      StatusIndicator.tsx        # Component + StatusIndicatorProps + SimulationStatus type
      StatusIndicator.css        # Styles (sct-StatusIndicator- prefix)
      StatusIndicator.test.tsx   # Vitest unit tests
      index.ts                   # Re-export StatusIndicatorComponent, StatusIndicatorProps, SimulationStatus
  widgets/defaultWidgets.ts      # Replace StatusIndicatorPlaceholder with StatusIndicatorComponent
  index.ts                       # Export StatusIndicatorComponent, StatusIndicatorProps, SimulationStatus

examples/backend/
  producers.py                   # Add start_heartbeat_producer
  main.py                        # Wire start_heartbeat_producer into lifespan
```

---

## 10. Implementation Checklist

```
- [ ] Task 1: Types — SimulationStatus, StatusIndicatorProps, ControlPayload
      - [ ] Define SimulationStatus union type
      - [ ] Define ControlPayload internal interface (status + optional message)
      - [ ] Define StatusIndicatorProps interface with JSDoc on every field

- [ ] Task 2: StatusIndicatorComponent
      - [ ] Subscribe to channel via useEventBusClient on mount
      - [ ] Initialise displayStatus = "unknown", lastSeenMs = null, message = null
      - [ ] On each event: validate status field, update displayStatus + lastSeenMs + message
      - [ ] Warn and ignore events with invalid status values
      - [ ] Single setInterval (1000 ms) — checks staleness AND calls setNow(Date.now()) to refresh relative time
      - [ ] Clear interval and subscription in useEffect cleanup on unmount
      - [ ] Reset to unknown + null on channel prop change (channel is a useEffect dependency)
      - [ ] Render label beside coloured badge
      - [ ] Badge colour via CSS modifier class matching displayStatus
      - [ ] Render optional message text when present
      - [ ] Render "Last seen: Xs ago" when showLastSeen is true and at least one event arrived
      - [ ] Render "Last seen: Never" when showLastSeen is true and no event yet
      - [ ] Hide last-seen line when showLastSeen is false

- [ ] Task 3: StatusIndicator.css
      - [ ] sct-StatusIndicator-container
      - [ ] sct-StatusIndicator-row (flex, align-items: center, gap)
      - [ ] sct-StatusIndicator-label (small, muted colour)
      - [ ] sct-StatusIndicator-badge (pill shape: border-radius, padding, font-size)
      - [ ] sct-StatusIndicator-badge--running (green background #22c55e)
      - [ ] sct-StatusIndicator-badge--paused (amber background #f59e0b)
      - [ ] sct-StatusIndicator-badge--converged (blue background #3b82f6)
      - [ ] sct-StatusIndicator-badge--failed (red background #ef4444)
      - [ ] sct-StatusIndicator-badge--unknown (grey background #6b7280)
      - [ ] sct-StatusIndicator-message (smaller font, muted)
      - [ ] sct-StatusIndicator-last-seen (smaller font, muted)

- [ ] Task 4: Replace placeholder in defaultWidgets.ts
      - [ ] Import StatusIndicatorComponent from ./StatusIndicator
      - [ ] Remove StatusIndicatorPlaceholder declaration
      - [ ] Update STATUS_INDICATOR.parameters to match real props
      - [ ] Update STATUS_INDICATOR.factory to return StatusIndicatorComponent

- [ ] Task 5: Export from package index.ts
      - [ ] Export StatusIndicatorComponent
      - [ ] Export StatusIndicatorProps type
      - [ ] Export SimulationStatus type

- [ ] Task 6: Backend example update
      - [ ] Add ControlEvent Pydantic model to producers.py
      - [ ] Add start_heartbeat_producer coroutine to producers.py
      - [ ] Wire start_heartbeat_producer into lifespan in main.py

- [ ] Task 7: Tests (StatusIndicator.test.tsx)
      Note: staleness tests require vi.useFakeTimers() + vi.advanceTimersByTime() in beforeEach/afterEach.
      The FakeWebSocket + EventBusProvider pattern is the same as in LogViewer.test.tsx.
      - [ ] renders "Unknown" badge when no event has arrived
      - [ ] renders "Running" badge with green modifier when status is "running"
      - [ ] renders "Paused" badge with amber modifier when status is "paused"
      - [ ] renders "Converged" badge with blue modifier when status is "converged"
      - [ ] renders "Failed" badge with red modifier when status is "failed"
      - [ ] updates badge when a second event arrives with a different status
      - [ ] ignores event with invalid status value and logs a console warning
      - [ ] renders label text when label prop is provided
      - [ ] shows "Last seen: Never" when showLastSeen is true and no event arrived
      - [ ] shows last-seen timestamp after first event when showLastSeen is true
      - [ ] hides last-seen line when showLastSeen is false
      - [ ] renders optional message text from event payload
      - [ ] transitions to "Unknown" badge after staleAfterMs elapses with no new event (use vi.advanceTimersByTime)
      - [ ] does not transition to "Unknown" when staleAfterMs is 0 (use vi.advanceTimersByTime to confirm)
      - [ ] resets to "Unknown" when channel prop changes
      - [ ] unsubscribes and clears interval on unmount

- [ ] Task 8: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test:ui
      - [ ] npm run format:check
      - [ ] uv run pytest -q
      - [ ] ruff check .
```
