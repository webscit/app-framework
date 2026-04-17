# Widget Registry — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a frontend-only catalog of available widget types that three consumers can read from: the AI layer, the layout editor, and the application shell.

**Architecture:** `WidgetRegistry` is instantiated per `EventBusProvider` and exposed via React context. Two built-in widgets are pre-registered. The backend has no awareness of widgets — it only publishes data on channels. Phase 2 will add manifest-based discovery and lazy component loading (out of scope here).

**Tech Stack:** TypeScript — React, Vitest, react-test-renderer.

---

## 1. Problem Statement

As the framework grows to support multiple channel types (`log/*`, `control/*`, `data/*`, and future types like `geometry/*` or `metrics/*`), consumers need a way to answer questions like:

- "Which widgets can display messages on the log channel?" (AI layer, tool routing)
- "What widget types belong in the palette?" (layout editor)
- "Which widget should handle this incoming data shape?" (application shell)

Without a registry, each consumer must hard-code widget knowledge, which breaks every time a new widget type is added. A registry centralises this knowledge in one place and makes it queryable.

---

## 2. Phase 1 Scope

Phase 1 delivers the registry core with in-code registration only:

- `WidgetDefinition` schema (TypeScript interface)
- `WidgetRegistry` class with `register`, `get`, `list`, `findByMime`, `findByChannel`, `resolveWidgets`, and `onChange`
- Two built-in default widgets (`LogViewer`, `StatusIndicator`)
- `useWidgetRegistry()`, `useWidgetsByChannel()`, and `useWidgetsByMime()` React hooks
- `mimeType?: string` field in `EventHeaders` for widget resolution
- Full test coverage: TypeScript hooks/client behaviour in Vitest

---

## 3. Phase 2 Preview (Out of Scope)

Phase 2 will add:

- **Manifest-based discovery** — a `widgets.json` manifest file per package that the framework scans at startup. Apps won't need to call `register()` in code; the registry auto-populates from the manifest.
- **Lazy component loading** — the `component` field becomes a dynamic import key. The shell loads the component bundle on demand instead of up-front.
- **Registry versioning** — widgets expose a `version` field; the shell can detect when a running app uses a different widget version than the installed bundle.

None of these require changes to the Phase 1 `WidgetDefinition` schema or `WidgetRegistry` API — the schema is designed to accommodate them via the existing fields.

---

## 4. WidgetDefinition Schema

### TypeScript (interface)

```typescript
interface WidgetDefinition {
  /** Unique identifier, e.g. "LogViewer". */
  name: string;

  /**
   * Verbose human-readable purpose.
   * Used for AI reasoning and layout-editor tooltips.
   * No structured capability tags — the description is the reasoning surface.
   */
  description: string;

  /**
   * Glob pattern matching the EventBus channels this widget handles.
   * e.g. "log/*", "data/temperature", "control/*".
   *
   * Used as a fallback when no mimeType match is found in the message headers.
   */
  channelPattern: string;

  /**
   * MIME types this widget can render, in preference order.
   * e.g. ["text/plain"], ["application/x-timeseries+json"].
   *
   * Widget resolution checks mimeType from message headers against this list
   * first, then falls back to channelPattern matching.
   */
  consumes: string[];

  /**
   * Sort weight when multiple widgets match the same MIME type or channel.
   * Higher wins. Widgets with equal priority are returned in registration order.
   */
  priority: number;

  /**
   * JSON schema of user-configurable parameters displayed in the layout editor.
   * e.g. { maxLines: { type: "integer", default: 1000 } }.
   */
  parameters: Record<string, unknown>;

  /**
   * React component responsible for rendering this widget.
   * Passed by reference so the layout editor can render a live preview
   * without a dynamic import step.
   */
  component: ComponentType;
}
```

---

## 5. Registry API

### TypeScript — `WidgetRegistry`

| Method           | Signature                                                      | Behaviour                                                    |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `register`       | `(definition: WidgetDefinition): IDisposable`                  | Throws `Error` if already registered. Dispose to unregister. |
| `get`            | `(name: string): WidgetDefinition \| undefined`                | Returns `undefined` if not found                             |
| `list`           | `(): WidgetDefinition[]`                                       | Returns all widgets, `[]` when empty                         |
| `findByMime`     | `(mimeType: string): WidgetDefinition[]`                       | Match on `consumes` list, sorted by `priority` descending    |
| `findByChannel`  | `(channel: string): WidgetDefinition[]`                        | Match `channelPattern` glob against concrete channel, sorted |
| `resolveWidgets` | `(channel: string, mimeType?: string): WidgetDefinition[]`     | MIME first → channel fallback → priority tie-break           |
| `onChange`       | `(listener: (change: WidgetChangeEvent) => void): IDisposable` | Subscribe to catalog changes, dispose to unsubscribe         |

#### IDisposable

```typescript
interface IDisposable {
  dispose(): void; // idempotent
}
```

Mirrors the JupyterLab `DocumentRegistry.addWidgetFactory` pattern: `register()` returns a handle the caller disposes to unregister the widget. There is **no separate `unregister(name)` method**.

#### WidgetChangeEvent

```typescript
interface WidgetChangeEvent {
  type: "added" | "removed";
  widget: WidgetDefinition;
}
```

---

## 6. Built-in Widgets

Both are registered automatically in `EventBusProvider`.

| Field            | LogViewer                                              | StatusIndicator                                            |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `name`           | `"LogViewer"`                                          | `"StatusIndicator"`                                        |
| `channelPattern` | `"log/*"`                                              | `"control/*"`                                              |
| `consumes`       | `["text/plain"]`                                       | `["application/x-control+json"]`                           |
| `priority`       | `10`                                                   | `10`                                                       |
| `description`    | Displays live log stream from simulation stdout/stderr | Displays heartbeat and run status from the control channel |

---

## 7. EventBus Wire Format — mimeType Header

**`EventHeaders`** includes an optional `mimeType` field:

```typescript
interface EventHeaders {
  message_id: string;
  timestamp: number; // milliseconds since Unix epoch
  mimeType?: string; // e.g. "text/plain", "application/x-timeseries+json"
}
```

When present, `mimeType` enables the frontend to auto-match widgets by exact data shape without requiring the widget to declare a matching `channelPattern`. This gives two clean layers of widget specification:

1. **Primary:** `mimeType` match against `consumes` list (most specific).
2. **Fallback:** `channelPattern` glob match against the incoming channel (broader).

Matched widgets are sorted by `priority` descending. `resolveWidgets(channel, mimeType?)` encodes this strategy.

There is no backend registry and no `GET /api/widgets` endpoint. The backend only publishes data on channels; widget resolution is a frontend concern.

---

## 8. Design Decisions

### a. Why `channelPattern` is an open glob string, not a closed enum

Future channel types (`geometry/*`, `metrics/*`, `audio/*`) will be defined by application code, not by the framework. If the registry used an enum, adding a new channel type would require a framework package update — coupling app-level concerns into the framework. Open glob string keeps the registry extensible at zero cost.

### b. Why MIME type for `consumes`

Multiple widgets may handle the same channel but expect different data shapes. For example:

- A `TimeSeriesChart` and a `DataTable` both match `"data/*"` but expect `"application/x-timeseries+json"` vs. `"application/x-tabular+json"`.

`consumes` lets the application shell match incoming data to the right widget by exact shape, not just by channel family. MIME types are the established vocabulary for this kind of content-type negotiation.

### c. Why `register()` returns `IDisposable` (no `unregister` method)

Following the JupyterLab `DocumentRegistry` pattern: returning a disposable handle ties resource lifetime to the caller, avoids name-collision races, and prevents accidental unregistration of widgets owned by another module.

### d. Why the registry is frontend-only

The backend publishes structured data on channels; it has no knowledge of how that data will be rendered. Keeping widget knowledge on the frontend:

- Eliminates a network round-trip for widget hydration.
- Avoids a Python↔TypeScript schema synchronisation problem.
- Lets the layout editor render live widget previews without any backend involvement.

### e. Why NOT a global singleton

A singleton registry would make tests order-dependent (state leaks between tests), make it impossible to run two app instances in the same process, and couple the framework to global state. Instantiating the registry in `EventBusProvider` means each app instance owns its catalog, tests construct their own, and teardown is trivial.

---

## 9. Future Extension: GeometryViewer

To prove the registry needs zero changes for new channel types, here is a future `GeometryViewer` widget that would work today:

```typescript
// examples/frontend — app-specific registration
const geometryViewer: WidgetDefinition = {
  name: "GeometryViewer",
  description: "Renders 3D geometry from simulation output",
  channelPattern: "geometry/*", // new channel family — no registry changes needed
  consumes: ["model/gltf+json"], // standard MIME for 3D
  priority: 10,
  parameters: {
    backgroundColor: { type: "string", default: "#1a1a2e" },
    wireframe: { type: "boolean", default: false },
  },
  component: GeometryViewerComponent,
};

const handle = registry.register(geometryViewer);
// handle.dispose() to unregister when the component unmounts
```

The `channelPattern: "geometry/*"` value is a new channel family unknown to the framework's built-in widgets, but the registry accepts it without modification.

---

## 10. Hooks

| Hook                           | Returns              | Description                                                   |
| ------------------------------ | -------------------- | ------------------------------------------------------------- |
| `useWidgetRegistry()`          | `WidgetDefinition[]` | All widgets in the registry; re-renders on any catalog change |
| `useWidgetsByChannel(channel)` | `WidgetDefinition[]` | Widgets whose `channelPattern` matches the concrete channel   |
| `useWidgetsByMime(mimeType)`   | `WidgetDefinition[]` | Widgets whose `consumes` list includes the MIME type          |

All three hooks subscribe to `registry.onChange(...)` and return an `IDisposable` that is cleaned up on unmount.
