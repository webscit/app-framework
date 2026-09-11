# DataTable Widget — Implementation Plan

**Goal:** Provide a built-in widget that displays live tabular data streamed row-by-row from the EventBus, with client-side sorting, pagination, column visibility toggle, and search — without requiring any custom widget code from the engineer.

**Architecture:** Follows the same pattern as `LogViewer` and `Chart`. The widget is a `WidgetDefinition` in `defaultWidgets.ts` whose `factory` returns `DataTableComponent`. The component subscribes to a configurable EventBus channel via `client.subscribe()` — accumulating all rows exactly as `LogViewer` accumulates log lines — then applies client-side sort, filter, and pagination before rendering. Column definitions can be declared explicitly via props or auto-derived from the first received row.

**Tech Stack:** TypeScript — React, shadcn `Table` component (to be added), shadcn `Input` and `Button` (already installed). CSS class names prefixed with `sct-DataTable-`.

---

## 1. Problem Statement

Simulation engineers need to inspect tabular output — solver iteration records, convergence tables, parameter sweeps — as rows arrive live from the backend. The `Chart` widget handles scalar streams and `LogViewer` handles text, but there is no built-in way to display structured, row-based data in a navigable table.

**Best example:** A solver running in the backend publishes one row per iteration to `table/results` — step number, elapsed time, residual, status. The engineer opens the DataTable panel, watches rows appear in real time, clicks the "Residual" column header to sort ascending, and types "converging" in the search box to filter the view.

**What this solves:**

- Live display of row-based EventBus streams without custom widget code
- Column sorting so engineers can find extrema or rank results instantly
- Pagination keeps large result sets from overwhelming the browser
- Search filters rows without needing a query language
- Column visibility toggle removes noise from wide payloads

---

## 2. Scope

**In scope:**

- `DataTableComponent` — React component rendering a live row-appending table
- `ColumnDef` interface for user-defined column schema
- `DataTableProps` interface
- `DATA_TABLE` widget definition in `defaultWidgets.ts`
- Rolling row buffer with configurable `maxRows` (default 1000)
- Client-side sort by column (click header to cycle asc/desc)
- Client-side full-text search across all cell values
- Client-side pagination with configurable `pageSize`
- Column visibility toggle via button strip
- Empty state: "Waiting for data on `<channel>`…"
- `DataTable.css` for layout styles consistent with `LogViewer.css`
- `TableRowEvent` Python type in `examples/backend/producers.py`
- `start_table_producer` async producer publishing to `table/results`
- Wire-up in `examples/backend/main.py`
- Full unit tests

---

## 3. Table Features

| Feature             | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Sort                | Click any column header to sort ascending; click again to sort descending. Resets page on change.   |
| Search              | Text input above the table filters rows whose any cell value contains the query (case-insensitive). |
| Pagination          | Rows split into pages of `pageSize`. Previous/next buttons. Hidden when total rows ≤ `pageSize`.    |
| Column visibility   | One toggle button per column. Hidden columns are excluded from rendered cells and search.           |
| Auto column headers | When no `columns` prop is provided, headers are derived from the keys of the first received row.    |
| Rolling buffer      | Oldest rows trimmed when buffer exceeds `maxRows`. Does not reset on prop changes.                  |

---

## 4. Data Model

### 4.1 Column definition

```typescript
export interface ColumnDef {
  /** Key matching a field in the row payload (e.g. `"residual"`). */
  key: string;
  /** Display name shown in the table header. */
  header: string;
  /**
   * Hint used for sort order. "number" sorts numerically; "string" sorts
   * lexicographically. Defaults to "string".
   */
  type?: "string" | "number";
}
```

### 4.2 Props interface

```typescript
export interface DataTableProps {
  /**
   * EventBus channel pattern to subscribe to. Supports fnmatch glob patterns.
   * Default: "table/*"
   */
  channel?: string;
  /** Title displayed above the toolbar. */
  title?: string;
  /**
   * Column definitions. When omitted, columns are auto-derived from the keys
   * of the first received row. Auto-derived columns use the key as both `key`
   * and `header` with `type` defaulting to "string".
   */
  columns?: ColumnDef[];
  /**
   * Number of rows shown per page.
   * Default: 20
   */
  pageSize?: number;
  /**
   * Maximum number of rows retained in the rolling buffer. When exceeded, the
   * oldest rows are trimmed. Changes take effect on the next incoming row —
   * they do not reset existing history.
   * Default: 1000
   */
  maxRows?: number;
}
```

### 4.3 Row type

Each received event contributes one row. The row is the event `payload` cast as a flat-or-nested object:

```typescript
type TableRow = Record<string, unknown>;
```

---

## 5. Component Behaviour

### 5.1 Mount

On mount the component initialises an empty `TableRow[]` buffer and subscribes to `channel` via `useEventBusClient().subscribe()`. The subscription is created once and torn down on unmount or when `channel` / client changes — the same lifecycle as `LogViewerComponent`.

### 5.2 Incoming event

On each `WireEvent`:

1. If `event.payload` is not a plain object — is `null`, an array, or a primitive — drop silently, no error.
2. Cast payload to `TableRow` and append to the buffer.
3. If `buffer.length > maxRowsRef.current`, trim the oldest row.

`maxRowsRef` mirrors the `maxRows` prop so the subscription callback always reads the latest limit without `maxRows` being a subscription dependency (same pattern as `LogViewer`'s `maxLinesRef`).

### 5.3 Column resolution

When a `columns` prop is provided, it is used directly. When omitted, the component derives columns from `Object.keys(rows[0])` after the first row arrives, using each key as both `key` and `header`.

### 5.4 Processing pipeline

Applied in order on every render: **filter → sort → paginate**.

- **Filter:** rows whose any **visible** cell value contains the search query (case-insensitive string match). Hidden columns are excluded from filtering.
- **Sort:** `[...filtered].sort(...)` comparing numerically for `type: "number"` columns, lexicographically otherwise.
- **Paginate:** `slice(page * pageSize, (page + 1) * pageSize)`.

Page resets to 0 on every sort or search change.

### 5.5 Empty state

When the buffer is empty, renders:

```
Waiting for data on <channel>…
```

---

## 6. Widget Definition

```typescript
export const DATA_TABLE: WidgetDefinition = {
  name: "DataTable",
  description:
    "Live tabular data viewer. Subscribes to an EventBus channel and appends " +
    "incoming row objects into a paginated, sortable, searchable table. " +
    "Suitable for solver iteration logs, parameter sweeps, and results grids.",
  channelPattern: "table/*",
  consumes: ["application/x-tabular+json"],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    title: {
      type: "string",
      default: "",
      description: "Title displayed above the toolbar.",
    },
    pageSize: {
      type: "integer",
      default: 20,
      minimum: 5,
      maximum: 100,
      description: "Number of rows shown per page.",
    },
    maxRows: {
      type: "integer",
      default: 1000,
      minimum: 100,
      maximum: 10000,
      description: "Maximum rows retained in the rolling buffer.",
    },
    // `columns` is intentionally absent from the parameters schema. Like `series`
    // on the Chart widget, it is a structured array of objects — too complex for
    // the flat JSON Schema scalar format used here. It is passed directly as a
    // prop in the layout JSON (see Section 7) and auto-derived from the first
    // received row when omitted.
  },
  factory: () => DataTableComponent as ComponentType,
};
```

---

## 7. Example Usage (Frontend)

```typescript
import { DATA_TABLE } from "@app-framework/core-ui";

registry.register(DATA_TABLE);

const layout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    main: {
      visible: true,
      items: [
        {
          id: "results-table",
          type: "DataTable",
          props: {
            channel: "table/results",
            title: "Solver Results",
            pageSize: 20,
            maxRows: 500,
            columns: [
              { key: "step", header: "Step", type: "number" },
              { key: "time_s", header: "Time (s)", type: "number" },
              { key: "residual", header: "Residual", type: "number" },
              { key: "status", header: "Status", type: "string" },
            ],
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

A new producer in `examples/backend/producers.py` publishes one row per iteration to `table/results`:

```python
import asyncio
from typing import Any

from framework_core.bus import BaseEvent, EventBus


class TableRowEvent(BaseEvent):
    """Single row of tabular simulation results published to a ``table/*`` channel."""

    row: dict[str, Any]


async def start_table_producer(bus: EventBus) -> None:
    """Publish mock solver iteration rows to ``table/results`` every 500 ms."""
    step = 0
    while True:
        residual = round(1.0 / (step + 1), 6)
        await bus.publish(
            "table/results",
            TableRowEvent(
                row={
                    "step": step,
                    "time_s": round(step * 0.5, 1),
                    "residual": residual,
                    "status": "converged" if residual < 0.01 else "converging",
                }
            ),
        )
        step += 1
        await asyncio.sleep(0.5)
```

`start_table_producer` is added to the `tasks` list in `examples/backend/main.py` alongside the existing sine wave and log producers.

---

## 9. File Structure

```
packages/framework-core-ui/src/
  widgets/
    DataTable/
      DataTable.tsx          # Component + ColumnDef + DataTableProps
      DataTable.css          # Layout styles (sct-DataTable- prefix)
      DataTable.test.tsx     # Unit tests
      index.ts               # Re-export DataTableComponent, DataTableProps, ColumnDef
  components/ui/table.tsx    # Added by: npx shadcn@latest add table
  widgets/defaultWidgets.ts  # Add DATA_TABLE
  widgets/index.ts           # Export DataTableComponent, DataTableProps, ColumnDef
  index.ts                   # Export DATA_TABLE, DataTableComponent, DataTableProps, ColumnDef

examples/backend/
  producers.py               # Add TableRowEvent, start_table_producer
  main.py                    # Add start_table_producer to tasks list

examples/frontend/src/
  main.tsx                   # Register DATA_TABLE; add DataTable item to initialLayout
```

---

## 10. Dependencies

Add the shadcn table component — no new npm packages, shadcn table uses only HTML table elements and Tailwind:

```bash
cd packages/framework-core-ui
npx shadcn@latest add table
```

This generates `src/components/ui/table.tsx` and exports `Table`, `TableHeader`, `TableHead`, `TableBody`, `TableRow`, `TableCell`. `Input` and `Button` are already installed and used for the search field and pagination controls.

---

## 11. Implementation Checklist

```
- [ ] Task 0: Add shadcn table component
      - [ ] Run: npx shadcn@latest add table in packages/framework-core-ui
      - [ ] Verify src/components/ui/table.tsx generated with expected exports

- [ ] Task 1: Python TableRowEvent + start_table_producer
      - [ ] Add TableRowEvent(BaseEvent) with row: dict[str, Any] to producers.py
      - [ ] Add start_table_producer(bus) publishing to "table/results" every 500 ms
      - [ ] Add start_table_producer to tasks list in main.py

- [ ] Task 2: DataTableComponent
      - [ ] Subscribe to channel via useEventBusClient().subscribe() on mount
      - [ ] Drop non-object payloads silently (null, arrays, primitives)
      - [ ] Append object payloads as rows; trim oldest when maxRows exceeded
      - [ ] Auto-derive column headers from first row when columns prop is omitted
      - [ ] Filter rows by search query (case-insensitive, all cell values)
      - [ ] Sort rows by clicked column (asc on first click, desc on second)
      - [ ] Reset page to 0 on sort or search change
      - [ ] Paginate with Previous / Next buttons; hide pagination when ≤ pageSize rows
      - [ ] Column visibility toggle buttons (one per column, toggle hidden/visible)
      - [ ] Render title when provided
      - [ ] Render empty state when buffer is empty

- [ ] Task 3: DataTable.css
      - [ ] sct-DataTable-container
      - [ ] sct-DataTable-title
      - [ ] sct-DataTable-empty
      - [ ] sct-DataTable-toolbar
      - [ ] sct-DataTable-table-wrapper
      - [ ] sct-DataTable-th (clickable cursor)
      - [ ] sct-DataTable-pagination

- [ ] Task 4: DATA_TABLE widget definition
      - [ ] Add to defaultWidgets.ts
      - [ ] Export from widgets/index.ts and src/index.ts

- [ ] Task 5: Example app integration
      - [ ] Register DATA_TABLE in examples/frontend/src/main.tsx
      - [ ] Add DataTable item to main region of initialLayout

- [ ] Task 6: Tests
      - [ ] renders empty state when no events have arrived
      - [ ] renders a row when an object payload arrives
      - [ ] drops non-object payloads (null, array, string) silently
      - [ ] trims oldest rows when maxRows is exceeded
      - [ ] renders title when provided
      - [ ] renders user-provided column headers
      - [ ] auto-derives column headers from first row
      - [ ] filters rows when search input is typed
      - [ ] unmounts without throwing

- [ ] Task 7: Quality gate
      - [ ] ruff check .
      - [ ] uv run pytest -q
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test:ui
      - [ ] npm run format:check
```
