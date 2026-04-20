# Application Shell — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the top-level container that defines named slot regions, renders widgets placed in those regions, and provides a layout surface whose state is serializable to JSON from day one.

**Architecture:** `ApplicationShell` is a renderer. It takes a `ShellLayout` spec (plain JSON describing which widgets are placed in which regions) and reads `WidgetRegistry` from the existing `EventBusProvider` context — the same registry the rest of the app uses. This follows the json-render pattern: spec + registry = rendered UI. No second registry is needed. Widget placement is declared on `WidgetDefinition` via a `defaultRegion` field — the shell reads this at startup to auto-populate regions without requiring a hand-authored layout. Phase 2 will wire `ShellLayout` save/load to a storage backend and add AI layout generation on top of this same spec format.

**Tech Stack:** TypeScript — React, Vitest, react-test-renderer.

---

## 1. Problem Statement

Without a shell, every application that uses the framework must hand-roll its own layout. Each one invents its own slot names, visibility rules, and region structure. When the layout editor and JSON persistence land in Phase 2, there will be nothing to target — no stable named regions, no serializable layout state.

The shell solves this now, while there is still only one place to put it. It gives:

- A single, named surface that the layout editor can inspect and modify.
- A stable API that built-in framework components (log viewer, status indicator) can use to place themselves without knowing how the host application is structured.
- A data model that is ready for `JSON.stringify` / `JSON.parse` round-trips the moment persistence is wired up.

Without it, Phase 2 work must first reverse-engineer whatever ad-hoc layout each application invented — which is the kind of rework YAGNI is meant to prevent.

---

## 2. Phase 1 Scope

Phase 1 delivers the shell core:

- Six named regions: `header`, `sidebar-left`, `main`, `sidebar-right`, `bottom`, `status-bar`
- `ShellLayout` serializable spec — JSON-safe, describes widget placements per region
- `RegionItem` type — `{ id, type, props, order? }` — fully serializable widget placement descriptor
- `createDefaultShellLayout()` helper — single source of truth for default region visibility
- `defaultRegion?: RegionId` field on `WidgetDefinition` — widget declares its preferred shell region at registration time
- Note: `RegionId` is defined in this package (`shellTypes.ts`) and must be imported by the widget registry package to type `WidgetDefinition.defaultRegion` — this is an intentional cross-package dependency
- `ApplicationShell` React component — renderer that reads `WidgetRegistry` from context, auto-places widgets by `defaultRegion` when no `initialLayout` is provided, accepts `initialLayout?` to override
- Sidebar and bottom panel visibility toggle (updates `ShellLayout` in memory)
- `useShellLayout()` hook — live snapshot from context, re-renders on layout change
- Unknown widget type handling — placeholder render, no crash
- Full test coverage: TypeScript component and hook behaviour in Vitest

---

## 3. Phase 2 Preview (Out of Scope)

Phase 2 will add:

- **JSON persistence** — `ShellLayout` is already serializable; Phase 2 wires `save()` / `load(layout: ShellLayout)` to a storage backend (localStorage or server API).
- **Drag-and-drop layout editor** — the layout editor reads region state from `ShellLayout` and writes changes back through `ShellLayout` updates. The shell does not change; only the editor is new.
- **AI layout generation** — `ShellLayout` is pure JSON, making it a natural target for LLM-driven layout suggestions. The spec format is designed to accommodate this from day one.
- **Plugin manifest system** — a `shell.json` manifest file per package declares initial widget placements declaratively. The shell merges these into `ShellLayout` at startup without hand-authoring the layout in application code. Same pattern as the widget registry Phase 2 manifest work.

None of these require changes to the Phase 1 `ShellLayout` data model — the interfaces are designed to accommodate them.

---

## 4. Shell Regions

Each region has a fixed name, a fixed position in the layout, and a purpose. The shell renders all six regions in the DOM at all times; visibility is controlled by CSS (hidden regions take no space).

| Region          | Position             | Purpose                                       | Default visible | Hideable |
| --------------- | -------------------- | --------------------------------------------- | --------------- | -------- |
| `header`        | Top bar              | Application toolbar, title, global actions    | Yes             | No       |
| `sidebar-left`  | Left panel           | Navigation, file tree, tool launchers         | Yes             | Yes      |
| `main`          | Central canvas       | Primary widget area — always occupied         | Yes             | No       |
| `sidebar-right` | Right panel          | Property inspector, context panels            | No              | Yes      |
| `bottom`        | Bottom panel         | Terminal output, log viewer, build output     | No              | Yes      |
| `status-bar`    | Bottom-most thin bar | Status indicators, connection state, run info | Yes             | No       |

**Why these six and not more:** This matches the canonical IDE layout used by VS Code, Theia, and JupyterLab. Every tool the framework needs to place — log viewer (`bottom`), status indicator (`status-bar`), widget canvas (`main`) — has an obvious home. Adding more regions now would be YAGNI.

---

## 5. Shell Data Model

The `ShellLayout` interface is the single source of truth for shell state that must survive a browser refresh. It is designed to be `JSON.stringify`-safe from day one: no functions, no class instances, no circular references, no `undefined` values.

```typescript
/** Serializable identifier for a shell region. */
type RegionId =
  | "header"
  | "sidebar-left"
  | "main"
  | "sidebar-right"
  | "bottom"
  | "status-bar";

/** A single widget placement in a shell region — fully serializable, no function references. */
interface RegionItem {
  /**
   * Stable unique identifier for this placement.
   * Preserves identity across layout saves and reloads.
   */
  id: string;
  /**
   * Widget type name — must match a name registered in WidgetRegistry.
   * Resolved to a React component at render time via WidgetRegistry.factory.
   */
  type: string;
  /**
   * User-configurable props passed to the widget factory as ComponentOptions.parameters.
   * Must be JSON-serializable — no functions, no class instances.
   */
  props: Record<string, unknown>;
  /**
   * Render order within the region. Lower numbers render first.
   * Defaults to 0. Items with equal order render in original array order.
   */
  order?: number;
}

/** Serializable state for a single region. */
interface RegionState {
  /** Whether the region is currently visible. */
  visible: boolean;
  /** Ordered list of widget placements in this region. */
  items: RegionItem[];
}

/** Serializable snapshot of the full shell layout. */
interface ShellLayout {
  regions: Record<RegionId, RegionState>;
}
```

**Why this shape:** `ShellLayout` contains only primitives and plain objects — `JSON.parse(JSON.stringify(layout))` produces an identical value. `RegionItem` stores the widget type as a string name, not a component reference. Component resolution happens at render time through `WidgetRegistry`, not through the persisted state. This is the json-render spec pattern: the spec is pure data, the registry is the component resolver.

**Render-time resolution:** At render time, `ApplicationShell` iterates `ShellLayout.regions[id].items`, looks up each `item.type` in `WidgetRegistry`, and calls `factory({ parameters: item.props })` to obtain the React component. If `item.type` is not found in the registry, the shell renders a clearly labelled placeholder ("Widget not found: {type}") and continues — it never throws. A saved layout with a stale or mistyped widget name degrades gracefully.

**`createDefaultShellLayout():`** A pure helper function that returns a `ShellLayout` with all six regions at their spec-defined default visibility (see Section 4 table). `ApplicationShell` calls this internally when `initialLayout` is omitted. Callers who want to supply a partial override merge their values on top of the default.

```typescript
function createDefaultShellLayout(): ShellLayout {
  return {
    regions: {
      header: { visible: true, items: [] },
      "sidebar-left": { visible: true, items: [] },
      main: { visible: true, items: [] },
      "sidebar-right": { visible: false, items: [] },
      bottom: { visible: false, items: [] },
      "status-bar": { visible: true, items: [] },
    },
  };
}
```

**Auto-placement example:** When no `initialLayout` is provided, `ApplicationShell` builds the initial layout automatically from the registry:

```typescript
// Widget declares where it wants to live at registration time
const LOG_VIEWER: WidgetDefinition = {
  name: "LogViewer",
  defaultRegion: "bottom", // ← new field
  channelPattern: "log/*",
  consumes: ["text/plain"],
  // ...rest of definition
};

// Shell reads defaultRegion from every registered widget and auto-places them
// No hand-authored ShellLayout needed
<ApplicationShell />;
```

**Manual override:** If `initialLayout` is provided, it takes full precedence — auto-placement is skipped entirely. This is used when loading a saved layout or when the application needs precise control over placement order and props.

**Why `visible` is in `ShellLayout`:** Sidebar open/closed state is part of the user's workspace. When a user saves their layout and reloads, they expect the same panels to be open. It belongs in the serializable model, not in ephemeral React state. See Design Decision (e) for the sidebar vs. status-bar distinction.

---

## 6. Shell Component API

The `ApplicationShell` component is the root of the UI. It is composed as follows:

```typescript
interface ApplicationShellProps {
  /**
   * Explicit layout spec. If provided, used as-is — auto-placement is skipped.
   * If omitted, ApplicationShell builds the initial layout from WidgetRegistry
   * by grouping widgets by their defaultRegion field.
   * Widgets with no defaultRegion are not auto-placed.
   */
  initialLayout?: ShellLayout;
}
```

`WidgetRegistry` is **not** a prop — the shell calls `useWidgetRegistryInstance()` to read it from the `EventBusProvider` context already in the tree. This is the established framework pattern: the application creates one `WidgetRegistry`, passes it to `EventBusProvider`, and all downstream components — including `ApplicationShell` — consume it from context. Passing it again as a prop would require every app to supply the same instance twice.

The component provides ONE React context:

```typescript
interface ShellLayoutContextValue {
  layout: ShellLayout;
  setLayout: (updater: (prev: ShellLayout) => ShellLayout) => void;
}
```

- `ShellLayoutContext` — exposes `layout` (current snapshot) and `setLayout` (functional updater). Read by `useShellLayout()`.

**Auto-placement on mount:** When `initialLayout` is omitted, `ApplicationShell` calls `widgetRegistry.list()`, filters widgets that have a `defaultRegion` set, and constructs a `ShellLayout` where each region's `items` array contains one `RegionItem` per matching widget. The `RegionItem` is built as:

```typescript
{
  id: widget.name,  // stable, unique — widget name is the ID
  type: widget.name, // resolved via WidgetRegistry at render time
  props: {},        // default props — no user configuration at auto-place time
  order: 0,         // default order
}
```

Widgets with no `defaultRegion` are not auto-placed. They are available in the registry but require an explicit `ShellLayout` entry to appear in the shell.

The rendered tree:

```
<ApplicationShell>
  <ShellHeader />          ← region: header
  <ShellBody>
    <ShellSidebar side="left" />    ← region: sidebar-left
    <ShellMain />                   ← region: main
    <ShellSidebar side="right" />   ← region: sidebar-right
  </ShellBody>
  <ShellBottom />          ← region: bottom
  <ShellStatusBar />       ← region: status-bar
</ApplicationShell>
```

Each sub-component is internal to the shell package. They read from `ShellLayoutContext` to render their placed items and call `setLayout` for toggle actions. They resolve each `item.type` against `WidgetRegistry` from context.

**Hooks:**

```typescript
/**
 * Returns the current ShellLayout and a functional updater.
 * Re-renders whenever the layout changes.
 * Follows the same [value, setter] tuple pattern as React.useState.
 */
function useShellLayout(): [
  ShellLayout,
  (updater: (prev: ShellLayout) => ShellLayout) => void,
];
```

The functional updater pattern (rather than a direct value setter) ensures atomic updates when multiple regions change at once — the updater always receives the latest state, preventing stale-closure bugs in concurrent renders. The sidebar toggle, for example:

```typescript
const [, setLayout] = useShellLayout();
setLayout((prev) => ({
  ...prev,
  regions: {
    ...prev.regions,
    "sidebar-left": {
      ...prev.regions["sidebar-left"],
      visible: !prev.regions["sidebar-left"].visible,
    },
  },
}));
```

---

## 7. Design Decisions

### a. Why slot-based regions over a free-form grid (at this stage)

A free-form grid requires the drag-and-drop layout editor to be useful — without it, placing items at arbitrary coordinates requires coordinates in code, which is worse than named slots. Slot-based regions give the layout a meaningful, stable address space that works before the editor exists. VS Code and JupyterLab both use named panels at their core, with free-form tabs layered on top. Phase 1 follows the same progression.

### b. Why status-bar is a separate region from bottom panel

The bottom panel is a content area (log viewer, terminal, build output). Its visibility is user-controlled and it can be collapsed without losing information. The status bar is an always-visible chrome element — similar to the VS Code status bar — that shows ambient state: connection status, last heartbeat, run state. Collapsing the bottom panel must not hide the status bar. Mixing them in one region would require special-casing the status bar at every toggle point.

### c. Why layout data model is serializable from day one

Retrofitting serializability is disproportionately expensive. It requires auditing every piece of state, removing function references, flattening component trees, and establishing stable ID schemes — all under time pressure just before a release. Designing for serializability upfront costs almost nothing: it constrains the data model in ways that improve it anyway (stable string type names, no function references in state, clear separation between layout state and render-time resolution).

### d. Why there is no second registry — WidgetRegistry is sufficient

A second registry would be a stateful object tracking what is currently placed in shell regions. But `ShellLayout` already IS that record — it is a plain JSON object describing every placement. There is no need for a separate stateful object to manage contributions on top of that.

This follows the json-render pattern: a **spec** (`ShellLayout`) describes structure, a **registry** (`WidgetRegistry`) resolves type names to components, and a **renderer** (`ApplicationShell`) combines the two. Adding a second registry between spec and renderer would duplicate the responsibility already split cleanly between spec and registry.

When you find yourself writing:

> "`RegionRegistry` is a catalog. `WidgetRegistry` is another catalog."

that is a signal to stop and ask whether both are needed. In this case, the answer is no — the spec replaces the need for the second catalog entirely.

The practical consequence: to declare where a widget should appear, extension authors add `defaultRegion: "bottom"` to their `WidgetDefinition`. The shell reads it. There is no separate registration step, no second API to learn, no question of "which registry do I use?" — there is only one registry.

### e. Why sidebar visibility is in ShellLayout but status-bar visibility is not

Sidebar state (`sidebar-left`, `sidebar-right`, and `bottom` visible/hidden) is user workspace state — it expresses which panels the user has chosen to see and is worth restoring across sessions. Status-bar and header visibility are not togglable (they are always visible), so they appear in `ShellLayout` as `visible: true` constants. This makes the data model self-consistent — every region appears in `ShellLayout`, but only the togglable ones will ever have `visible: false`.

The `bottom` panel follows the same rule — the user may want the terminal collapsed or open when they reload their layout, and this preference should be restored.

### f. Why `defaultRegion` lives on `WidgetDefinition` and not on `ShellLayout`

`defaultRegion` expresses the widget's own preference — "I am a log viewer, I belong in the bottom panel." This is a property of the widget type, not of any particular layout. Putting it on `WidgetDefinition` means the preference travels with the widget wherever it is registered, and every shell that uses the widget gets sensible auto-placement for free.

`ShellLayout` expresses the user's arrangement — "in this session, I want the log viewer in the bottom panel at position 0 with maxLines 500." When a user saves their layout, `ShellLayout` captures their specific choices. `defaultRegion` is only used when no saved layout exists.

---

## 8. Edge Cases

**Empty region:** A region that has no placed items renders its empty state — a region-specific placeholder (e.g., `main` shows a "No widgets placed" message; `sidebar-left` renders nothing). Empty regions that are hideable default to hidden if `initialLayout` is not supplied. The `main` region always renders something.

**Widget registered after mount with a defaultRegion:** If `initialLayout` was omitted and a widget with `defaultRegion` is registered after `ApplicationShell` mounts, the shell does NOT automatically add it to the layout. Auto-placement only runs once at mount time. Post-mount registrations are available for explicit `ShellLayout` updates but do not silently modify the user's current layout. This prevents unexpected layout shifts when plugins load asynchronously.

**Shell renders before WidgetRegistry is populated:** `ApplicationShell` reads `WidgetRegistry` from context and subscribes to its `onChange`. If the shell mounts before widgets are registered (e.g., because a plugin registers its widgets after mount), items whose `type` is not yet in the registry render as the "Widget not found" placeholder on first render and automatically re-render to the correct component once the type is registered. This is the same live-subscription model used by `useWidgets`.

**Unknown widget type in spec:** If `ShellLayout` contains a `RegionItem` whose `type` is not found in `WidgetRegistry`, the shell renders a clearly labelled placeholder ("Widget not found: {type}") in that item's position and continues rendering all other items normally. A stale or mistyped widget name in a saved layout never crashes the shell.

**Sidebar collapse/expand state:** Visible/hidden is serializable state in `ShellLayout` (see Section 5). Animated transition state (mid-collapse) is ephemeral React state and is not part of `ShellLayout`. The distinction is: if the user saves and reloads, the panel should be in the same open/closed position; the animation itself does not need to resume.

**Status-bar visibility:** Always visible. Not togglable. `status-bar` always has `visible: true` in `ShellLayout`. This matches the VS Code status bar contract: it is chrome, not content.

**Loading layout with invalid visibility:** If a persisted `ShellLayout` sets `visible: false` for a non-togglable region (`header`, `main`, or `status-bar`), `ApplicationShell` silently corrects the value to `visible: true` before applying the layout. The correction is applied at load time and written back into the in-memory state so that `useShellLayout()` always reflects the corrected value. No error is thrown — the correction is a safe normalization, not a user mistake that needs surfacing.

---

## 9. Built-in Shell Content

With zero application-level configuration and no widgets registered with a `defaultRegion`, `ApplicationShell` renders:

- `header` — empty bar (no items placed)
- `sidebar-left` — visible by default, empty (no items placed)
- `main` — "No widgets placed" placeholder
- `sidebar-right` — hidden by default (no items placed)
- `bottom` — hidden by default (no items placed)
- `status-bar` — empty bar (no items placed)

When widgets with `defaultRegion` are registered before mount, auto-placement populates the matching regions automatically — no hand-authored layout required. See Section 6 for auto-placement behaviour.

No widgets are pre-placed by the framework itself. The shell is a renderer; placement is the application's responsibility via `ShellLayout` or via `defaultRegion` on `WidgetDefinition`.

---

## 10. Implementation Checklist

```
- [ ] Task 1: Core types
      - [ ] Define RegionId, RegionItem, RegionState, ShellLayout in shellTypes.ts
      - [ ] Implement createDefaultShellLayout() in shellTypes.ts
      - [ ] Export all types from index.ts

- [ ] Task 2: ApplicationShell component
      - [ ] ShellLayoutContext with ShellLayoutContextValue { layout, setLayout }
      - [ ] ApplicationShell props: initialLayout? only — read WidgetRegistry via useWidgetRegistryInstance()
      - [ ] Merge initialLayout over createDefaultShellLayout() on mount
      - [ ] If initialLayout omitted: call widgetRegistry.list(), filter widgets with defaultRegion, build initial ShellLayout
      - [ ] Widgets with no defaultRegion are not auto-placed
      - [ ] Correct non-togglable regions (header, main, status-bar) to visible: true on load
      - [ ] Render header, sidebar-left, main, sidebar-right, bottom, status-bar regions
      - [ ] Subscribe to WidgetRegistry onChange — re-render when registry changes
      - [ ] Resolve item.type via WidgetRegistry, call factory({ parameters: item.props })
      - [ ] Render placeholder for unknown widget types — no crash
      - [ ] Wire sidebar and bottom toggle actions via setLayout

- [ ] Task 3: Region sub-components
      - [ ] ShellHeader — renders region: header items
      - [ ] ShellSidebar (side prop) — renders sidebar-left or sidebar-right items, collapsible
      - [ ] ShellMain — renders region: main items, fallback placeholder when empty
      - [ ] ShellBottom — renders region: bottom items, collapsible
      - [ ] ShellStatusBar — renders region: status-bar items, always visible

- [ ] Task 4: useShellLayout hook
      - [ ] useShellLayout(): [ShellLayout, setLayout] — subscribes to ShellLayoutContext, re-renders on change
      - [ ] Tests: initial layout, layout update re-render, toggle visibility via setLayout

- [ ] Task 5: Public exports
      - [ ] Export ApplicationShell, useShellLayout from index.ts
      - [ ] Export RegionId, RegionItem, RegionState, ShellLayout, ShellLayoutContextValue, createDefaultShellLayout from index.ts
      - [ ] Note: defaultRegion field is defined in widget registry spec — ApplicationShell consumes it but does not define it

- [ ] Task 6: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```
