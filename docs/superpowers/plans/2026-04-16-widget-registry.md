# Widget Registry — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a catalog of available widget types that three consumers can read from: the AI layer, the drag-and-drop shell, and the application shell.

**Architecture:** `WidgetRegistry` is instantiated (not a singleton) inside `create_app()` and `EventBusProvider`, exposed on `app.state.widget_registry` and via React context respectively. Two built-in widgets are pre-registered. A `GET /api/widgets` endpoint lets the frontend hydrate its local registry on connect. Phase 2 will add manifest-based discovery and lazy component loading (out of scope here).

**Tech Stack:** Python — FastAPI, Pydantic v2, pytest; TypeScript — React, Vitest, react-test-renderer.

---

## 1. Problem Statement

As the framework grows to support multiple stream types (`log`, `control`, `data`, and future types like `geometry` or `metrics`), consumers need a way to answer questions like:

- "Which widgets can display a log stream?" (AI layer, tool routing)
- "What widget types belong in the palette?" (drag-and-drop shell)
- "Which widget should handle this incoming data shape?" (application shell)

Without a registry, each consumer must hard-code widget knowledge, which breaks every time a new widget type is added. A registry centralises this knowledge in one place and makes it queryable.

---

## 2. Phase 1 Scope

Phase 1 delivers the registry core with in-code registration only:

- `WidgetDefinition` schema (Pydantic model + TypeScript interface)
- `WidgetRegistry` class with `register`, `unregister`, `get`, `list`, and three `find_by_*` query methods
- Two built-in default widgets (`LogViewer`, `StatusIndicator`)
- `GET /api/widgets` HTTP endpoint for frontend hydration
- `useWidgetRegistry()` and `useWidgetsByStream()` React hooks
- Full test coverage: 15 Python tests + 12 TypeScript tests

---

## 3. Phase 2 Preview (Out of Scope)

Phase 2 will add:

- **Manifest-based discovery** — a `widgets.json` manifest file per package that the framework scans at startup. Apps won't need to call `register()` in code; the registry auto-populates from the manifest.
- **Lazy component loading** — the `component` field becomes a dynamic import key. The shell loads the component bundle on demand instead of up-front.
- **Registry versioning** — widgets expose a `version` field; the shell can detect when a running app uses a different widget version than the installed bundle.

None of these require changes to the Phase 1 `WidgetDefinition` schema or `WidgetRegistry` API — the schema is designed to accommodate them via the existing fields.

---

## 4. WidgetDefinition Schema

### Python (Pydantic v2 BaseModel)

| Field          | Type             | Description                          | Example                             |
| -------------- | ---------------- | ------------------------------------ | ----------------------------------- |
| `name`         | `str`            | Unique identifier                    | `"LogViewer"`                       |
| `description`  | `str`            | Human-readable purpose               | `"Displays live log stream"`        |
| `stream`       | `str`            | Open string — which WebSocket stream | `"log"`, `"control"`, `"geometry"`  |
| `consumes`     | `str`            | MIME type of the exact data shape    | `"text/plain"`, `"model/gltf+json"` |
| `capabilities` | `list[str]`      | Open tags for AI/human reasoning     | `["log-viewer", "scrollable"]`      |
| `parameters`   | `dict[str, Any]` | JSON schema of user config           | `{"maxLines": {"type": "integer"}}` |
| `component`    | `str`            | Relative path to React component     | `"./src/widgets/LogViewer.tsx"`     |

### TypeScript (interface)

```typescript
interface WidgetDefinition {
  name: string;
  description: string;
  stream: string; // open — not a closed union type
  consumes: string; // MIME type
  capabilities: string[]; // open tags
  parameters: Record<string, unknown>; // JSON schema
  component: string;
}
```

---

## 5. Registry API

### Python — `WidgetRegistry`

| Method               | Signature                                        | Behaviour                                      |
| -------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `register`           | `(widget: WidgetDefinition) -> None`             | Raises `ValueError` if name already registered |
| `unregister`         | `(name: str) -> None`                            | Raises `KeyError` if name not found            |
| `get`                | `(name: str) -> WidgetDefinition \| None`        | Returns `None` if not found                    |
| `list`               | `() -> list[WidgetDefinition]`                   | Returns all widgets, `[]` when empty           |
| `find_by_capability` | `(tag: str) -> Sequence[WidgetDefinition]`       | Match on `capabilities` list                   |
| `find_by_stream`     | `(stream: str) -> Sequence[WidgetDefinition]`    | Exact match on `stream`                        |
| `find_by_mime`       | `(mime_type: str) -> Sequence[WidgetDefinition]` | Exact match on `consumes`                      |

### TypeScript — `WidgetRegistry`

| Method             | Signature                                       | Behaviour                                         |
| ------------------ | ----------------------------------------------- | ------------------------------------------------- |
| `register`         | `(widget: WidgetDefinition): void`              | Throws `Error` if already registered              |
| `unregister`       | `(name: string): void`                          | Throws `Error` if not found                       |
| `get`              | `(name: string): WidgetDefinition \| undefined` | Returns `undefined` if not found                  |
| `list`             | `(): WidgetDefinition[]`                        | Returns all widgets, `[]` when empty              |
| `findByCapability` | `(tag: string): WidgetDefinition[]`             | Match on `capabilities`                           |
| `findByStream`     | `(stream: string): WidgetDefinition[]`          | Exact match on `stream`                           |
| `findByMime`       | `(mimeType: string): WidgetDefinition[]`        | Exact match on `consumes`                         |
| `onChange`         | `(listener: () => void): () => void`            | Subscribe to catalog changes, returns unsubscribe |

---

## 6. Built-in Widgets

Both are registered automatically in `create_app()` (Python) and `EventBusProvider` (TypeScript).

| Field          | LogViewer                                    | StatusIndicator                         |
| -------------- | -------------------------------------------- | --------------------------------------- |
| `name`         | `"LogViewer"`                                | `"StatusIndicator"`                     |
| `stream`       | `"log"`                                      | `"control"`                             |
| `consumes`     | `"text/plain"`                               | `"application/x-control+json"`          |
| `capabilities` | `["log-viewer", "scrollable", "searchable"]` | `["status", "heartbeat", "run-status"]` |
| `component`    | `"./src/widgets/LogViewer.tsx"`              | `"./src/widgets/StatusIndicator.tsx"`   |

---

## 7. GET /api/widgets Wire Format

**Request:** `GET /api/widgets`

**Response:** `200 OK`, `Content-Type: application/json`

```json
[
  {
    "name": "LogViewer",
    "description": "Displays live log stream from simulation stdout/stderr",
    "stream": "log",
    "consumes": "text/plain",
    "capabilities": ["log-viewer", "scrollable", "searchable"],
    "parameters": {
      "maxLines": {
        "type": "integer",
        "default": 1000,
        "minimum": 100,
        "maximum": 10000
      },
      "showTimestamps": { "type": "boolean", "default": true },
      "wrapLines": { "type": "boolean", "default": false }
    },
    "component": "./src/widgets/LogViewer.tsx"
  },
  {
    "name": "StatusIndicator",
    "description": "Displays heartbeat and run status from control stream",
    "stream": "control",
    "consumes": "application/x-control+json",
    "capabilities": ["status", "heartbeat", "run-status"],
    "parameters": {
      "label": { "type": "string", "default": "Simulation Status" },
      "showLastSeen": { "type": "boolean", "default": true }
    },
    "component": "./src/widgets/StatusIndicator.tsx"
  }
]
```

---

## 8. Design Decisions

### a. Why `stream` is an open string, not a closed enum

Feature 2 defines `StreamType` as a Python `StrEnum` with `data`, `log`, and `control`. The widget registry deliberately **does not import from `stream_types.py`** and uses a plain `str` instead.

**Reason:** Future stream types (`geometry`, `metrics`, `audio`) will be defined by application code, not by the framework. If the registry enum had to list every possible stream type, adding a new stream type would require a framework package update — coupling app-level concerns into the framework. Open string keeps the registry extensible at zero cost.

### b. Why MIME type for `consumes`

Multiple widgets may consume the same `stream` type but expect different data shapes. For example:

- A `TimeSeriesChart` and a `DataTable` both consume `stream: "data"` but expect `"application/x-timeseries+json"` vs. `"application/x-tabular+json"`.

`consumes` lets the application shell match incoming data to the right widget by exact shape, not just by stream family. MIME types are the established vocabulary for this kind of content-type negotiation.

### c. Why capability tags

The `capabilities` list is deliberately unvalidated. Tags serve two purposes:

1. **AI tool routing** — the AI layer can ask "which widgets support searching?" without knowing widget internals.
2. **Human search** — the widget palette can filter by tag.

Keeping it open means widget authors can add domain-specific tags (`"3d-viewer"`, `"exportable"`) without asking for schema changes.

### d. Why NOT a singleton

A singleton registry would make tests order-dependent (state leaks between tests), make it impossible to run two app instances in the same process, and couple the framework to global state. Instantiating the registry in `create_app()` and `EventBusProvider` means each app instance owns its catalog, tests construct their own, and teardown is trivial.

---

## 9. Future Extension: GeometryViewer

To prove the registry needs zero changes for new stream types, here is a future `GeometryViewer` widget that would work today:

```python
# examples/backend — app-specific registration
from framework_core.widget_registry import WidgetDefinition

GEOMETRY_VIEWER = WidgetDefinition(
    name="GeometryViewer",
    description="Renders 3D geometry from simulation output",
    stream="geometry",          # new stream type — no registry changes needed
    consumes="model/gltf+json", # standard MIME for 3D
    capabilities=["3d-viewer", "rotatable", "exportable"],
    parameters={
        "backgroundColor": {"type": "string", "default": "#1a1a2e"},
        "wireframe": {"type": "boolean", "default": False},
    },
    component="./src/widgets/GeometryViewer.tsx",
)

app.state.widget_registry.register(GEOMETRY_VIEWER)
```

The `stream: "geometry"` value is unknown to Feature 2's `StreamType` enum but the registry accepts it without modification. The WebSocket bridge would need a new stream handler (a Feature 2 concern), but the registry itself requires no changes.

---

## 10. Relationship to Feature 2

The widget registry uses Feature 2's stream type strings (`"log"`, `"control"`, `"data"`) as plain string values in `WidgetDefinition.stream`. There is **no import dependency** on `stream_types.py` — the Python `StreamType` enum is not referenced anywhere in `widget_registry.py` or `default_widgets.py`.

This is intentional: the registry is a catalog layer that sits above the WebSocket transport layer. Coupling it to a specific enum would make it dependent on Feature 2 internals and would break the open-string extensibility described in decision (a) above.
