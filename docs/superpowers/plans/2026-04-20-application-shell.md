# Application Shell — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the top-level container that defines named slot regions, renders widgets placed in those regions, and provides a layout surface whose state is serializable to JSON from day one.

**Architecture:** The `ApplicationShell` React component owns a set of named regions. An in-code `RegionRegistry` allows items to be contributed to regions programmatically. The shell accepts `RegionRegistry` as a prop — it does not instantiate it. `WidgetRegistry` and `EventBusProvider` are peer dependencies consumed via React context, not props. Phase 2 will wire JSON persistence and a plugin manifest system (out of scope here).

**Tech Stack:** TypeScript — React, Vitest, react-test-renderer.

---

## 1. Problem Statement

Without a shell, every application that uses the framework must hand-roll its own layout. Each one invents its own slot names, visibility rules, and region structure. When the layout editor and JSON persistence land in Phase 2, there will be nothing to target — no stable named regions, no serializable state, no consistent API for contributing items.

The shell solves this now, while there is still only one place to put it. It gives:

- A single, named surface that the layout editor can inspect and modify.
- A stable API that built-in framework components (log viewer, status indicator) can use to place themselves without knowing how the host application is structured.
- A data model that is ready for `JSON.stringify` / `JSON.parse` round-trips the moment persistence is wired up.

Without it, Phase 2 work must first reverse-engineer whatever ad-hoc layout each application invented — which is the kind of rework YAGNI is meant to prevent.

---

## 2. Phase 1 Scope

Phase 1 delivers the shell core with in-code contribution only:

- Six named regions: `header`, `sidebar-left`, `main`, `sidebar-right`, `bottom`, `status-bar`
- `ShellLayout` serializable data model (TypeScript interface, no save/load wiring yet)
- `RegionRegistry` class with `contribute`, `get`, `list`, and `onChange`
- `ApplicationShell` React component consuming a `RegionRegistry` via props
- Sidebar and bottom panel toggle (visibility state per region)
- `useShellLayout` hook — live snapshot of `ShellLayout` from context, re-renders on change
- Full test coverage: TypeScript component and hook behaviour in Vitest

---

## 3. Phase 2 Preview (Out of Scope)

Phase 2 will add:

- **JSON persistence** — `ShellLayout` is already serializable; Phase 2 wires `save()` / `load(layout: ShellLayout)` to a storage backend (localStorage or server API).
- **Drag-and-drop layout editor** — the layout editor reads region state from `ShellLayout` and writes changes back through `RegionRegistry`. The shell does not change; only the editor is new.
- **Plugin manifest system** — a `shell.json` manifest file per package that declares region contributions declaratively. The shell auto-populates at startup without in-code `contribute()` calls. Same pattern as the widget registry Phase 2 manifest work.

None of these require changes to the Phase 1 `ShellLayout` data model or `RegionRegistry` API — the interfaces are designed to accommodate them.

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

/** Serializable state for a single region. */
interface RegionState {
  /** Whether the region is currently visible. */
  visible: boolean;
  /**
   * Ordered list of item IDs contributed to this region.
   * IDs are stable strings supplied by the contributor at registration time.
   */
  items: string[];
}

/** Serializable snapshot of the full shell layout. */
interface ShellLayout {
  regions: Record<RegionId, RegionState>;
}
```

**Why this shape:** `ShellLayout` contains only primitives and plain objects. `JSON.parse(JSON.stringify(layout))` produces an identical value. The `items` array stores stable string IDs rather than component references — component resolution happens at render time through `RegionRegistry`, not through the persisted state. This means a saved layout can be loaded in a new session and resolved against whatever items the current code has contributed.

**Render-time resolution:** `ShellLayout.regions[id].items` is an ordered list of stable string IDs. At render time, the shell calls `regionRegistry.getRegionItems(regionId)` and cross-references the ID list to determine render order and visibility. The `ShellLayout` never stores component references — those live in `RegionRegistry` and are resolved fresh on every render. This means a saved layout can be restored in a new session and will render correctly against whatever items the current code has contributed, with unknown IDs silently skipped.

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

**Why `visible` is in `ShellLayout`:** Sidebar open/closed state is part of the user's workspace. When a user saves their layout and reloads, they expect the same panels to be open. It belongs in the serializable model, not in ephemeral React state. See Design Decision (f) for the sidebar vs. status-bar distinction.

---

## 6. Region API

`RegionRegistry` is the in-code API for contributing items to shell regions. It follows the same JupyterLab `DocumentRegistry` pattern as `WidgetRegistry`: `contribute()` returns an `IDisposable` the caller holds and later disposes to remove the contribution.

```typescript
/** A single item contributed to a shell region. */
interface RegionItem {
  /** Stable unique identifier. Used in ShellLayout.items. */
  id: string;
  /** Which region this item belongs to. */
  region: RegionId;
  /** React component to render for this item. */
  component: ComponentType;
  /**
   * Render order within the region. Lower numbers render first.
   * Defaults to 0. Items with equal order render in contribution order.
   */
  order?: number;
}

/** Payload delivered to RegionRegistry.onChange listeners. */
interface RegionChangeEvent {
  type: "added" | "removed";
  item: Omit<RegionItem, "component">;
}

class RegionRegistry {
  /**
   * Add item to the named region.
   * Returns an IDisposable — call dispose() to remove the item.
   * Throws if an item with the same id is already contributed.
   */
  contribute(item: RegionItem): IDisposable;

  /** Return all items contributed to a specific region, sorted by order. */
  getRegionItems(regionId: RegionId): RegionItem[];

  /** Return all contributed items across all regions. */
  list(): RegionItem[];

  /**
   * Subscribe to contribution changes (items added or removed).
   * Returns an IDisposable — call dispose() to unsubscribe.
   */
  onChange(listener: (change: RegionChangeEvent) => void): IDisposable;
}
```

**Why `RegionChangeEvent` excludes `component`:** Same reasoning as `WidgetChangeEvent` in the widget registry — event payloads must be serializable for logging, cross-context messaging, and eventual persistence. `component` is a function reference and cannot be serialized.

**Why `contribute()` returns `IDisposable` instead of a `remove(id)` method:** Follows the JupyterLab `DocumentRegistry.addWidgetFactory` pattern. The caller holds the handle and controls the lifetime of their contribution. There is no way for one module to accidentally remove another module's contribution.

---

## 7. Shell Component API

The `ApplicationShell` component is the root of the UI. It is composed as follows:

```typescript
interface ApplicationShellProps {
  /** Region registry supplying items to shell regions. */
  regionRegistry: RegionRegistry;
  /** Initial layout state. If omitted, all regions default to their spec-defined visibility. */
  initialLayout?: Partial<ShellLayout>;
}
```

The component provides two React contexts:

- `ShellLayoutContext` — exposes the current `ShellLayout` snapshot. Read by `useShellLayout()`.
- `RegionRegistryContext` — exposes the `RegionRegistry` instance. Read by `useRegionRegistry()`.

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

Each sub-component is internal to the shell package. They read from `RegionRegistryContext` to render their contributed items. They do not accept region items as props — contributions flow through `RegionRegistry`, not through the component tree.

**Hooks:**

```typescript
/**
 * Returns the current ShellLayout snapshot.
 * Re-renders whenever the layout changes.
 */
function useShellLayout(): ShellLayout;

/**
 * Returns the RegionRegistry from context.
 * Use this to contribute items programmatically from within a component tree.
 */
function useRegionRegistry(): RegionRegistry;
```

---

## 8. Design Decisions

### a. Why slot-based regions over a free-form grid (at this stage)

A free-form grid requires the drag-and-drop layout editor to be useful — without it, placing items at arbitrary coordinates requires coordinates in code, which is worse than named slots. Slot-based regions give the layout a meaningful, stable address space that works before the editor exists. VS Code and JupyterLab both use named panels at their core, with free-form tabs layered on top. Phase 1 follows the same progression.

### b. Why status-bar is a separate region from bottom panel

The bottom panel is a content area (log viewer, terminal, build output). Its visibility is user-controlled and it can be collapsed without losing information. The status bar is an always-visible chrome element — similar to the VS Code status bar — that shows ambient state: connection status, last heartbeat, run state. Collapsing the bottom panel must not hide the status bar. Mixing them in one region would require special-casing the status bar at every toggle point.

### c. Why layout data model is serializable from day one

Retrofitting serializability is disproportionately expensive. It requires auditing every piece of state, removing function references, flattening component trees, and establishing stable ID schemes — all under time pressure just before a release. Designing for serializability upfront costs almost nothing: it constrains the data model in ways that improve it anyway (stable string IDs, no function references in state, clear separation between layout state and render-time resolution).

### d. Why the region API follows the IDisposable pattern

Same reasoning as the widget registry. Returning a disposable from `contribute()` ties the lifetime of a contribution to the object that created it. When a module unloads or a component unmounts, it calls `dispose()` on its handle and the contribution is cleanly removed — no global registry cleanup, no dangling item IDs, no shared mutable state to coordinate. See also Design Decision (c) in the widget registry spec.

### e. Why ApplicationShell does NOT instantiate RegionRegistry or WidgetRegistry

`ApplicationShell` is a layout component. `RegionRegistry` is a catalog. `WidgetRegistry` is another catalog. These are different responsibilities. Instantiating catalogs inside the shell would couple the shell's lifecycle to the catalog's lifecycle, make it impossible to share catalog instances across components, and make tests harder (they would need to mock a shell to get a registry). The application creates the registries, pre-populates them, and passes them in. This is the same pattern as `EventBusProvider` receiving its `WidgetRegistry` as a prop.

### f. Why sidebar visibility is in ShellLayout but status-bar visibility is not

Sidebar state (`sidebar-left` and `sidebar-right` visible/hidden) is user workspace state — it expresses which panels the user has chosen to see and is worth restoring across sessions. Status-bar and header visibility are not togglable (they are always visible), so they appear in `ShellLayout` as `visible: true` constants. This makes the data model self-consistent — every region appears in `ShellLayout`, but only the togglable ones will ever have `visible: false`.

---

## 9. Edge Cases

**Empty region:** A region that has no contributed items renders its empty state — a region-specific placeholder (e.g., `main` shows a "No widgets placed" message; `sidebar-left` renders nothing). Empty regions that are hideable default to hidden if `initialLayout` is not supplied. The `main` region always renders something.

**Duplicate contribution ID:** `RegionRegistry.contribute()` throws synchronously if an item with the same `id` is already contributed. This is the same contract as `WidgetRegistry.register()`. Callers must use stable, unique IDs.

**Double-dispose:** Calling `dispose()` on a contribution handle a second time is a no-op (idempotent). No error is thrown. This follows the `IDisposable` contract established by the widget registry.

**Shell renders before registry is populated:** `ApplicationShell` renders immediately with whatever contributions are present in `RegionRegistry` at mount time. Items contributed after mount trigger a re-render via `onChange`. This is the same live-subscription model used by `useWidgets` and `useWidgetRegistry`.

**Sidebar collapse/expand state:** Visible/hidden is serializable state in `ShellLayout` (see Section 5). Animated transition state (mid-collapse) is ephemeral React state and is not part of `ShellLayout`. The distinction is: if the user saves and reloads, the panel should be in the same open/closed position; the animation itself does not need to resume.

**Status-bar visibility:** Always visible. Not togglable. `status-bar` always has `visible: true` in `ShellLayout`. This matches the VS Code status bar contract: it is chrome, not content.

**Loading layout with invalid visibility:** If a persisted `ShellLayout` sets `visible: false` for a non-togglable region (`header`, `main`, or `status-bar`), `ApplicationShell` silently corrects the value to `visible: true` before applying the layout. The correction is applied at load time and written back into the in-memory state so that `useShellLayout()` always reflects the corrected value. No error is thrown — the correction is a safe normalization, not a user mistake that needs surfacing.

---

## 10. Built-in Shell Content

With zero application-level configuration, `ApplicationShell` renders:

- `header` — empty bar (applications contribute toolbar items via `RegionRegistry`)
- `sidebar-left` — hidden by default (no built-in items)
- `main` — "No widgets placed" placeholder
- `sidebar-right` — hidden by default (no built-in items)
- `bottom` — hidden by default (no built-in items)
- `status-bar` — empty bar (the status indicator widget contributes here once wired)

No widgets are pre-placed. The shell is a container; placement is the application's responsibility.

---

## 11. Implementation Checklist

```
- [ ] Task 1: Core types
      - [ ] Define RegionId, RegionState, ShellLayout in shellTypes.ts
      - [ ] Implement createDefaultShellLayout() in shellTypes.ts
      - [ ] Define RegionItem, RegionChangeEvent in regionRegistry.ts
      - [ ] Export all types from index.ts

- [ ] Task 2: RegionRegistry class
      - [ ] contribute(item): IDisposable — throws on duplicate id
      - [ ] getRegionItems(regionId): RegionItem[] — sorted by order
      - [ ] list(): RegionItem[]
      - [ ] onChange(listener): IDisposable
      - [ ] Unit tests: contribute, dispose, duplicate id, double-dispose, onChange

- [ ] Task 3: ApplicationShell component
      - [ ] ShellLayoutContext and RegionRegistryContext
      - [ ] ApplicationShell props: regionRegistry, initialLayout?
      - [ ] Default ShellLayout from region spec (visibility defaults)
      - [ ] Render header, sidebar-left, main, sidebar-right, bottom, status-bar regions
      - [ ] Wire sidebar toggle actions to ShellLayout.regions visibility

- [ ] Task 4: Region sub-components
      - [ ] ShellHeader — renders region: header items
      - [ ] ShellSidebar (side prop) — renders sidebar-left or sidebar-right items, collapsible
      - [ ] ShellMain — renders region: main items, fallback placeholder
      - [ ] ShellBottom — renders region: bottom items, collapsible
      - [ ] ShellStatusBar — renders region: status-bar items, always visible

- [ ] Task 5: Hooks
      - [ ] useShellLayout(): ShellLayout — subscribes to ShellLayoutContext
      - [ ] useRegionRegistry(): RegionRegistry — reads RegionRegistryContext
      - [ ] Tests: initial render, post-mount contribution re-render, toggle visibility

- [ ] Task 6: Public exports
      - [ ] Export ApplicationShell, useShellLayout, useRegionRegistry from index.ts
      - [ ] Export RegionRegistry, RegionId, ShellLayout, RegionItem from index.ts

- [ ] Task 7: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```
