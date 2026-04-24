# Widget Registry — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Widget Registry from a manual, imperative catalog into a manifest-driven system with real built-in widget components. Phase 2 delivers in a single PR: a real `LogViewer` component, updated `defaultRegion` assignments for default widgets, and a declarative `sct-manifest.json` plugin system with lazy component resolution.

**Architecture:** Phase 2 is purely additive. `WidgetDefinition` is unchanged — it already has `defaultRegion` from Phase 1. `defaultWidgets.ts` ships a real `LogViewer` backed by framework event bus primitives instead of a null placeholder. The manifest system introduces a `WidgetLoader` that reads an `sct-manifest.json` sidecar file and registers widgets into an existing `WidgetRegistry` — it does not replace the registry or the `register()` API. Manifest entries contain the full `WidgetDefinition` metadata inline (all fields except `factory`); the loader synthesises the definition and attaches a lazy-loading factory. The registry and loader are loosely coupled: the registry is unaware of manifests; the loader is unaware of how the registry stores or resolves widgets.

**Tech Stack:** TypeScript — React, Vitest, react-test-renderer.

---

## 1. Problem Statement

Phase 1 `WidgetDefinition` has two gaps that block the next wave of features:

**Gap 1 — Default widgets are placeholders.**
`LOG_VIEWER` and `STATUS_INDICATOR` both return `null` from their factories. They register successfully but render nothing. The framework claims to ship "built-in widgets" — it does not, yet. `LOG_VIEWER` is the most critical: every backend example produces `log/*` events and the current demo renders a blank panel where logs should appear.

**Gap 2 — Registration is purely imperative.**
Every consumer calls `registry.register(MY_WIDGET)` in application code. There is no declarative way to say "load all widgets from this package". Framework packages cannot auto-register their defaults without importing and running user-facing code at startup. A plugin package cannot declare its widgets without the host application knowing to call its registration function. This blocks plugin-style packaging where a package's widgets load automatically just by being installed.

---

## 2. Phase 2 Scope — Single PR

### 2.1 Real LogViewer Component

Replace the `LogViewerPlaceholder` in `defaultWidgets.ts` with a functional React component that uses framework event bus primitives. The component must:

- Accept `parameters: { maxLines?: number; showTimestamps?: boolean; wrapLines?: boolean }` via `ComponentOptions`.
- Subscribe to the channel it was placed on using `useEventBusClient` and `client.subscribe()` — the channel is passed as a prop. `useChannel` is not used because it only replays the last event; the LogViewer needs the full event stream to accumulate log history.
- Display log lines in a scrolling container, newest at bottom.
- Respect `maxLines` — trim oldest entries when exceeded.
- Optionally show timestamp prefix when `showTimestamps: true`.
- Optionally wrap long lines when `wrapLines: true`.
- Show a "No logs yet" placeholder when the channel has produced no events.
- Apply styles via deterministic CSS class names prefixed with `sct-LogViewer-`. A single `<style>` block is injected into `document.head` on first render — no external CSS dependencies, no inline styles.

The component is framework-internal and lives in `packages/framework-core-ui/src/LogViewer.tsx`. It is not exported from `index.ts` — consumers obtain it through the registry's factory, not by importing it directly.

### 2.2 Update Default Widget Definitions

Update `LOG_VIEWER` and `STATUS_INDICATOR` in `defaultWidgets.ts` with the correct `defaultRegion` assignments and real factories:

```typescript
export const LOG_VIEWER: WidgetDefinition = {
  name: "LogViewer",
  description: "...", // unchanged
  channelPattern: "log/*",
  consumes: ["text/plain"],
  priority: 10,
  defaultRegion: "bottom",
  parameters: {
    /* unchanged */
  },
  factory: () => LogViewerComponent, // real component — see 2.1
};

export const STATUS_INDICATOR: WidgetDefinition = {
  name: "StatusIndicator",
  description: "...", // unchanged
  channelPattern: "control/*",
  consumes: ["application/x-control+json"],
  priority: 10,
  defaultRegion: "status-bar",
  parameters: {
    /* unchanged */
  },
  factory: () => StatusIndicatorComponent, // placeholder until real component is built
};
```

`LOG_VIEWER` belongs in `"bottom"` (log panel), `STATUS_INDICATOR` in `"status-bar"` (thin bar). Both override the `"main"` default.

### 2.3 Manifest Format

Each package that provides widgets ships an `sct-manifest.json` sidecar file at a well-known path. The manifest is plain JSON — no code, no dynamic imports. Each widget entry contains the full `WidgetDefinition` metadata inline (every field except `factory`), plus `module` and `export` fields to resolve the component lazily.

```json
{
  "$schema": "https://app-framework/schemas/sct-manifest.json",
  "version": "1",
  "widgets": [
    {
      "name": "LogViewer",
      "description": "Displays live log stream from simulation stdout/stderr. Suitable for real-time monitoring of text-based output with a scrollable, searchable interface.",
      "channelPattern": "log/*",
      "consumes": ["text/plain"],
      "priority": 10,
      "defaultRegion": "bottom",
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
      "module": "./LogViewer",
      "export": "LogViewerComponent"
    },
    {
      "name": "StatusIndicator",
      "description": "Displays heartbeat and run status from the control channel. Shows connection status, last heartbeat time, and simulation run state.",
      "channelPattern": "control/*",
      "consumes": ["application/x-control+json"],
      "priority": 10,
      "defaultRegion": "status-bar",
      "parameters": {
        "label": { "type": "string", "default": "Simulation Status" },
        "showLastSeen": { "type": "boolean", "default": true }
      },
      "module": "./StatusIndicator",
      "export": "StatusIndicatorComponent"
    }
  ]
}
```

**Metadata fields** (`name`, `description`, `channelPattern`, `consumes`, `priority`, `defaultRegion`, `parameters`) are inlined directly — the loader reads them from the manifest and constructs the `WidgetDefinition` without loading the component module. This means the registry can answer all metadata queries immediately after `loadManifest` resolves, before any widget is rendered.

**`module` and `export`** are used only to resolve `factory`. The loader does `import(module)[export]` on first factory call.

**Why JSON, not TypeScript/JS:** A JSON manifest can be statically analyzed, linted, validated against a schema, and read by tooling without executing code. It is the same reason `package.json` is JSON. A `.ts` manifest would require `tsx` or `ts-node` to parse, which is inappropriate for a runtime loader.

**JSON Schema:** A `sct-manifest.schema.json` is shipped alongside the manifest for validation and editor tooling. The TypeScript interfaces `SctManifestEntry` and `SctManifest` in `widgetLoader.ts` should eventually be generated from this schema to ensure consistency — this is a follow-up task pending agreement on the codegen tool (see open questions).

The TypeScript interface for a manifest entry:

```typescript
/** A single widget entry in an {@link SctManifest}. */
export interface SctManifestEntry {
  /** Unique widget identifier used as the registry key. */
  name: string;
  /** Human-readable description of the widget's purpose. */
  description: string;
  /** Glob pattern matched against EventBus channel names. */
  channelPattern: string;
  /** List of MIME types this widget expects to receive. */
  consumes: string[];
  /** Priority for tie-breaking. Higher wins. */
  priority: number;
  /** Optional preferred layout region. */
  defaultRegion?: RegionId;
  /** JSON Schema-compatible parameter descriptors. */
  parameters: Record<string, unknown>;
  /** Relative import path. Always starts with `./`. */
  module: string;
  /** Named export holding the React component. */
  export: string;
}

/** Shape of a parsed `sct-manifest.json` file. */
export interface SctManifest {
  version: string;
  widgets: SctManifestEntry[];
}
```

### 2.4 WidgetLoader

A new class `WidgetLoader` in `packages/framework-core-ui/src/widgetLoader.ts`.
`WidgetLoader` implements `IDisposable`.

**Multiple manifests:** A single `WidgetLoader` instance can load multiple manifests from different URLs. Each `loadManifest` call tracks its own registration handles so that a single manifest can be unloaded via `unloadManifest` without affecting widgets registered by other manifests.

````typescript
/**
 * Loads widget definitions from `sct-manifest.json` manifest files and
 * registers them into a {@link WidgetRegistry}.
 *
 * Multiple manifests can be loaded independently — each call to
 * {@link loadManifest} tracks its own registration handles so that a single
 * manifest can be unloaded via {@link unloadManifest} without affecting
 * widgets registered by other manifests.
 *
 * Implements {@link IDisposable} — calling {@link dispose} unregisters all
 * widgets across every loaded manifest.
 *
 * @example
 * ```ts
 * const loader = new WidgetLoader(registry);
 * await loader.loadManifest("/plugin-a/sct-manifest.json");
 * await loader.loadManifest("/plugin-b/sct-manifest.json");
 * loader.unloadManifest("/plugin-a/sct-manifest.json");
 * loader.dispose(); // unloads everything
 * ```
 */
export class WidgetLoader implements IDisposable {
  constructor(registry: WidgetRegistry, importFn?: ImportFn);

  /**
   * Fetch and parse a manifest, then register each declared widget.
   * - Same URL called twice: no-op on second call.
   * - Concurrent calls for the same URL: coalesced into a single fetch.
   * - Multiple distinct URLs: load independently without interference.
   */
  async loadManifest(manifestUrl: string): Promise<void>;

  /**
   * Unregister all widgets from a specific manifest.
   * No-op if the URL was never loaded.
   */
  unloadManifest(manifestUrl: string): void;

  /**
   * Unregister all widgets across every loaded manifest.
   * Calling dispose() more than once is a no-op.
   */
  dispose(): void;
}
````

**Lazy loading contract:** For each manifest entry, the loader calls `registry.register()` immediately with all metadata from the manifest. Only the `factory` function defers work: the first call triggers `import(module)` and resolves the named export. Subsequent calls use a cached promise.

**Error handling:**

- Manifest fetch/parse error: `loadManifest()` rejects. No partial registration.
- Unknown export at factory call time: factory returns a `widget-load-error` component inline. Does not throw.
- Duplicate name: skipped with `console.warn`. Does not throw.
- Same URL called twice: second call is a no-op (resolves immediately, no re-fetch).

### 2.5 WidgetLoaderContext

A new `WidgetLoaderContext.tsx` provides a **single shared `WidgetLoader` instance** to the React subtree. This is required because `useWidgetLoader` (see 2.6) must reuse the same loader across multiple components — each plugin component calls `useWidgetLoader` with its own URL, and they must all share one loader to avoid duplicate registrations.

```typescript
/**
 * Provides a single shared WidgetLoader to the subtree.
 * Must be rendered inside WidgetRegistryContext.Provider.
 */
export const WidgetLoaderProvider: ComponentType<{ children: ReactNode }>;

/** Returns the shared WidgetLoader instance from context. */
export function useWidgetLoaderInstance(): WidgetLoader;
```

### 2.6 useWidgetLoader Hook

A new hook `useWidgetLoader` in `packages/framework-core-ui/src/useWidgetLoader.ts`.

Uses the shared `WidgetLoader` from `WidgetLoaderProvider` context. On unmount calls `loader.unloadManifest(manifestUrl)` — not `loader.dispose()` — so only this component's manifest is unloaded, leaving other manifests untouched.

Returns `WidgetLoaderStatus` — a named exported type:

```typescript
/** "loading" | "ready" | "error" */
export type WidgetLoaderStatus = "loading" | "ready" | "error";

export function useWidgetLoader(manifestUrl: string): WidgetLoaderStatus;
```

### 2.7 Manifest for framework-core-ui Default Widgets

Ship `packages/framework-core-ui/sct-manifest.json` declaring `LogViewer` and `StatusIndicator`. Also ship `packages/framework-core-ui/sct-manifest.schema.json` — the JSON Schema for validating manifest files.

`EventBusProvider` does NOT auto-load this manifest. The consuming application calls `useWidgetLoader` explicitly inside a `WidgetLoaderProvider`.

### 2.8 Export Updates

Export from `packages/framework-core-ui/src/index.ts`:

- `WidgetLoader` class
- `WidgetLoaderProvider` component
- `useWidgetLoader` hook
- `WidgetLoaderStatus` type
- `SctManifest` type
- `SctManifestEntry` type

Do NOT export `LogViewerComponent` or `StatusIndicatorComponent`.

### 2.9 Tests

- **`defaultWidgets.test.ts`** — add or update:
  - `LOG_VIEWER.defaultRegion` is `"bottom"`.
  - `STATUS_INDICATOR.defaultRegion` is `"status-bar"`.
  - `LOG_VIEWER.factory()` returns a React component.

- **`LogViewer.test.tsx`** — component behaviour:
  - Renders "No logs yet" when no events arrived.
  - Displays log lines when channel emits events.
  - Trims oldest lines when `maxLines` exceeded.
  - Shows/hides timestamps per `showTimestamps`.
  - Wraps lines per `wrapLines`.

- **`widgetLoader.test.ts`** — loader behaviour:
  - `loadManifest` registers all declared widgets.
  - Metadata available immediately after resolve.
  - Factory triggers dynamic import.
  - Factory is cached.
  - Duplicate name skipped with `console.warn`.
  - Fetch failure rejects with descriptive error.
  - Same URL twice is a no-op — fetch called only once.
  - Concurrent calls for same URL coalesce into one fetch.
  - Loads two manifests independently.
  - `unloadManifest` removes only that manifest's widgets.
  - `unloadManifest` on unknown URL is a no-op.
  - After `unloadManifest`, same URL can be reloaded.
  - Two manifests loaded concurrently without interference.
  - `dispose()` unregisters all widgets across all manifests.
  - `dispose()` after `dispose()` is a no-op.

- **`useWidgetLoader.test.tsx`** — hook state:
  - Returns `"loading"` immediately after mount.
  - Returns `"ready"` after manifest loads.
  - Returns `"error"` when manifest load fails.
  - Unmount calls `unloadManifest` — widgets removed.
  - Transitions loading → ready in correct order.
  - Two hooks sharing one `WidgetLoaderProvider` register both manifests.
  - Unmounting one hook unloads only its manifest.
  - Same URL used by two hooks only fetches once.

### 2.10 Open Questions

- **Codegen for TypeScript interfaces:** `SctManifestEntry` and `SctManifest` in `widgetLoader.ts` should be generated from `sct-manifest.schema.json` to ensure consistency. Pending agreement on tooling — `json-schema-to-typescript` is the proposed tool. To be resolved before the next PR that touches the manifest format.

### 2.11 PR Checklist

- [x] Add `defaultRegion?: RegionId` to `WidgetDefinition` in `widgetRegistry.ts`
- [x] Create `packages/framework-core-ui/src/LogViewer.tsx` with real component
- [x] Replace `LogViewerPlaceholder` in `defaultWidgets.ts` factory with `LogViewerComponent`
- [x] Update `LOG_VIEWER` in `defaultWidgets.ts` — set `defaultRegion: "bottom"`
- [x] Update `STATUS_INDICATOR` in `defaultWidgets.ts` — set `defaultRegion: "status-bar"`
- [x] Create `packages/framework-core-ui/src/widgetLoader.ts` — `WidgetLoader implements IDisposable`, multi-manifest support
- [x] Create `packages/framework-core-ui/src/WidgetLoaderContext.tsx` — shared loader context
- [x] Create `packages/framework-core-ui/src/useWidgetLoader.ts` — uses context, `WidgetLoaderStatus` type, `unloadManifest` on unmount
- [x] Create `packages/framework-core-ui/sct-manifest.json`
- [x] Create `packages/framework-core-ui/sct-manifest.schema.json`
- [x] Export `WidgetLoader`, `WidgetLoaderProvider`, `useWidgetLoader`, `WidgetLoaderStatus`, `SctManifest`, `SctManifestEntry` from `index.ts`
- [x] Add `defaultRegion` tests to `defaultWidgets.test.ts`
- [x] Create `LogViewer.test.tsx` with component behaviour tests
- [x] Create `widgetLoader.test.ts` with all loader behaviour tests (including multi-manifest)
- [x] Create `useWidgetLoader.test.tsx` with all hook state tests (including multi-manifest)
- [x] Update `examples/frontend/src/main.tsx` to use `WidgetLoaderProvider` + `useWidgetLoader`
- [x] Run `npm run typecheck` — no errors
- [x] Run `npm run lint` — no errors
- [ ] Run `npm run test:ui` — all tests pass
- [ ] Codegen for `SctManifestEntry`/`SctManifest` from schema — follow-up PR

---

## 3. Design Decisions

### 3.1 Registry and Loader Are Loosely Coupled

`WidgetRegistry` has no `loadManifest` method. `WidgetLoader` has no internal state beyond its registry reference and the dispose handles it accumulates. The coupling is one-directional: the loader calls `registry.register()`.

**Why:** If the manifest system were baked into the registry, it would be impossible to test the registry without mocking the manifest loader, and impossible to use the registry without the loader. Keeping them separate means each can be tested independently and swapped independently.

### 3.2 No Auto-Registration from EventBusProvider

`EventBusProvider` does not automatically load any manifest. Framework-provided defaults (`LOG_VIEWER`, `STATUS_INDICATOR`) are available in the registry after the consuming application calls `useWidgetLoader` with the framework manifest URL. This is a one-liner in application code.

**Why:** Auto-loading from the provider would make the manifest URL implicit and unconfigurable. Explicit `useWidgetLoader` calls are transparent, testable, and configurable.

### 3.3 Full Metadata in Manifest — No Eager Module Loads

Manifest entries contain every `WidgetDefinition` field except `factory`. Only `factory` is lazy. Because all metadata is inlined, queries against the registry work immediately after `loadManifest` resolves.

### 3.4 Single Shared WidgetLoader via Context

`useWidgetLoader` pulls the `WidgetLoader` instance from `WidgetLoaderContext` rather than creating one per component. This means multiple plugin components each calling `useWidgetLoader` with different URLs all share one loader, avoiding duplicate registrations and ensuring `unloadManifest` on one URL doesn't affect others.

### 3.5 CSS Class Names Instead of Inline Styles

`LogViewer` applies styles via deterministic `sct-LogViewer-*` class names, injected once into `document.head`. This allows theming and overrides from consuming applications without specificity battles against inline styles.

### 3.6 Same URL Called Twice is a No-op

The old design threw `Error: manifest already loaded` on a second `loadManifest` call. The new design treats it as a no-op and coalesces concurrent in-flight requests for the same URL. This is safer for React StrictMode (which double-invokes effects) and for plugin systems where two components might independently request the same manifest.

---

## 4. Edge Cases

| Scenario                                              | Behaviour                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Manifest `module` path does not resolve               | Factory renders `widget-load-error` inline. No crash. `console.error` logged.                   |
| Manifest `export` is not a valid React component      | Factory renders `widget-load-error`.                                                            |
| Two loaders register widgets with the same name       | Second registration skipped with `console.warn`. First wins.                                    |
| `dispose()` called while factory promise is in flight | Promise resolves normally. Widget then unregistered. Rendered instances stable until re-render. |
| Same URL called twice on same loader                  | Second call is a no-op. No re-fetch.                                                            |
| Concurrent calls for same URL                         | Coalesced into one fetch.                                                                       |
| `unloadManifest` on never-loaded URL                  | No-op.                                                                                          |
| After `unloadManifest`, same URL reloaded             | Works — fetches again, re-registers.                                                            |

---

## 5. File Map

```
packages/framework-core-ui/src/
├── widgetRegistry.ts         # MODIFIED: defaultRegion on WidgetDefinition; removed duplicate field
├── defaultWidgets.ts         # MODIFIED: real factories; defaultRegion on both widgets
├── LogViewer.tsx             # NEW: real LogViewer component with sct-LogViewer- CSS classes
├── widgetLoader.ts           # NEW: WidgetLoader implements IDisposable; multi-manifest
├── WidgetLoaderContext.tsx   # NEW: shared WidgetLoader context provider
├── useWidgetLoader.ts        # NEW: useWidgetLoader hook; WidgetLoaderStatus type
├── index.ts                  # MODIFIED: exports WidgetLoader, WidgetLoaderProvider,
│                             #           useWidgetLoader, WidgetLoaderStatus,
│                             #           SctManifest, SctManifestEntry
├── defaultWidgets.test.ts    # MODIFIED: defaultRegion tests
├── LogViewer.test.tsx        # NEW: component behaviour tests
├── widgetLoader.test.ts      # MODIFIED: multi-manifest tests added
└── useWidgetLoader.test.tsx  # MODIFIED: WidgetLoaderProvider in harness; multi-manifest tests

packages/framework-core-ui/
├── sct-manifest.json         # NEW: manifest for LogViewer + StatusIndicator
└── sct-manifest.schema.json  # NEW: JSON Schema for manifest validation

examples/frontend/src/
└── main.tsx                  # MODIFIED: WidgetLoaderProvider + useWidgetLoader
```
