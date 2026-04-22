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
- Subscribe to the channel it was placed on using `useChannel` — the channel is passed as a prop by `RegionItemRenderer` via `item.props.channel`.
- Display log lines in a scrolling container, newest at bottom.
- Respect `maxLines` — trim oldest entries when exceeded.
- Optionally show timestamp prefix when `showTimestamps: true`.
- Optionally wrap long lines when `wrapLines: true`.
- Show a "No logs yet" placeholder when the channel has produced no events.
- Apply no external CSS dependencies — use inline styles or a CSS module scoped to this file.

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

The TypeScript interface for a manifest entry:

```typescript
/** A single widget entry in an {@link SctManifest}. */
export interface SctManifestEntry {
  name: string;
  description: string;
  channelPattern: string;
  consumes: string[];
  priority: number;
  defaultRegion?: RegionId;
  parameters: Record<string, unknown>;
  /** Relative import path resolved from the manifest file's location. Always starts with `./`. */
  module: string;
  /** Named export in the module that holds the React component. */
  export: string;
}

/** Shape of a parsed `sct-manifest.json` file. */
export interface SctManifest {
  version: string;
  widgets: SctManifestEntry[];
}
```

### 2.4 WidgetLoader

A new class `WidgetLoader` in `packages/framework-core-ui/src/widgetLoader.ts`:

````typescript
/**
 * Loads widget definitions from an `sct-manifest.json` manifest and registers
 * them into a {@link WidgetRegistry}.
 *
 * The registry and the loader are loosely coupled:
 * - The registry has no knowledge of manifests.
 * - The loader has no knowledge of how the registry stores or resolves widgets.
 *
 * Lazy loading: the factory for each manifest widget wraps the module import
 * in a dynamic `import()`. The module is not loaded until the widget is first
 * rendered — not at manifest load time. All metadata fields are read from the
 * manifest directly, so the registry can answer metadata queries immediately
 * after `loadManifest` resolves.
 *
 * @example
 * ```ts
 * const loader = new WidgetLoader(registry);
 * await loader.loadManifest("/sct-manifest.json");
 * ```
 */
export class WidgetLoader {
  constructor(private readonly registry: WidgetRegistry) {}

  /**
   * Fetch and parse an `sct-manifest.json` manifest, then register each declared
   * widget into the registry.
   *
   * Registration is immediate for metadata; the component factory is lazy —
   * the module import is deferred until the factory is first called.
   *
   * @param manifestUrl Absolute URL or path to the `sct-manifest.json` file.
   * @returns Promise that resolves when all widgets are registered.
   * @throws Error if the manifest cannot be fetched or parsed.
   * @throws Error if a widget module or export cannot be resolved at factory call time.
   */
  async loadManifest(manifestUrl: string): Promise<void>;

  /**
   * Unregister all widgets that were registered by this loader instance.
   *
   * Calls `dispose()` on all registration handles. Widgets currently rendered
   * are not affected — `WidgetRegistry` guarantees stability of resolved
   * components until re-render.
   */
  dispose(): void;
}
````

**Lazy loading contract:** For each manifest entry, the loader calls `registry.register()` immediately with all metadata from the manifest. Only the `factory` function defers work: the first call to `factory(options)` triggers `import(module)` and resolves the named export as the React component. Subsequent calls use a cached promise.

**Error handling:**

- Manifest fetch/parse error: `loadManifest()` rejects with a descriptive error. No partial registration.
- Unknown export at factory call time: factory returns a `widget-load-error` component that renders an error message inline. It does not throw — the shell must not crash on a plugin failure.
- Duplicate name: `WidgetLoader` checks the registry before registering. If the name is already registered (by another loader or by direct `register()` call), it skips the manifest entry and emits a `console.warn`. It does not throw.
- `loadManifest` called twice on the same instance: second call rejects with `Error: manifest already loaded`. Call `dispose()` first to reload.

### 2.5 useWidgetLoader Hook

A new hook `useWidgetLoader` in `packages/framework-core-ui/src/useWidgetLoader.ts`:

````typescript
/**
 * Load a widget manifest into the shared registry and keep it registered
 * for the lifetime of the calling component.
 *
 * Calls `loader.loadManifest(manifestUrl)` on mount and `loader.dispose()`
 * on unmount. Triggers a re-render once the manifest is loaded so that
 * widgets registered by the manifest are available for layout resolution.
 *
 * **Note on manifest URL serving:** For now, consumers hardcode the manifest
 * URL (e.g. `useWidgetLoader("/sct-manifest.json")`). Serving manifest files
 * from the backend — so that installed plugins can register themselves at a
 * well-known URL — is a follow-up task. The URL parameter is intentionally
 * left open to support this pattern without API changes.
 *
 * @param manifestUrl URL of the `sct-manifest.json` manifest to load.
 * @returns Loading state — `"loading"`, `"ready"`, or `"error"`.
 * @example
 * ```ts
 * function App() {
 *   const status = useWidgetLoader("/sct-manifest.json");
 *   if (status === "loading") return <Spinner />;
 *   return <ApplicationShell />;
 * }
 * ```
 */
export function useWidgetLoader(manifestUrl: string): "loading" | "ready" | "error";
````

### 2.6 Manifest for framework-core-ui Default Widgets

Ship a `packages/framework-core-ui/sct-manifest.json` manifest declaring `LogViewer` and `StatusIndicator`. This is the reference manifest — it is loaded by the integration test to verify end-to-end manifest loading.

`EventBusProvider` itself does NOT auto-load this manifest. Auto-loading would couple the provider to the manifest path and make it non-configurable. Instead, the consuming application calls `useWidgetLoader` explicitly. The example frontend (`examples/frontend`) is updated to demonstrate this pattern.

### 2.7 Export Updates

Export from `packages/framework-core-ui/src/index.ts`:

- `WidgetLoader` class
- `useWidgetLoader` hook
- `SctManifest` type (the parsed JSON shape)
- `SctManifestEntry` type (a single entry within the manifest)

Do NOT export `LogViewerComponent` or `StatusIndicatorComponent` — they are internal, resolved through the registry's factory.

### 2.8 Tests

- **`defaultWidgets.test.ts`** — add or update tests:
  - `LOG_VIEWER.defaultRegion` is `"bottom"`.
  - `STATUS_INDICATOR.defaultRegion` is `"status-bar"`.
  - `LOG_VIEWER.factory()` returns a React component (not null, not a Promise).

- **`LogViewer.test.tsx`** — new test file for the LogViewer component:
  - Renders "No logs yet" when no events have arrived.
  - Displays log lines when channel emits events.
  - Trims oldest lines when `maxLines` is exceeded.
  - Shows timestamps when `showTimestamps: true`.
  - Hides timestamps when `showTimestamps: false`.
  - Wraps lines when `wrapLines: true`.

- **`widgetLoader.test.ts`** — new test file:
  - `loadManifest` registers all declared widgets.
  - Metadata fields (name, description, channelPattern, defaultRegion) are available immediately after `loadManifest` resolves.
  - Factory calls trigger dynamic import (mock the import to avoid real network calls).
  - Factory is cached — second call reuses the first import promise.
  - Duplicate widget name is skipped with `console.warn`, does not throw.
  - Manifest fetch failure rejects `loadManifest` with descriptive error.
  - `loadManifest` called twice rejects with `Error: manifest already loaded`.
  - `dispose()` unregisters all loaded widgets.
  - `dispose()` after `dispose()` is a no-op.

- **`useWidgetLoader.test.tsx`** — new test file:
  - Returns `"loading"` immediately after mount.
  - Returns `"ready"` after manifest loads.
  - Returns `"error"` when manifest load fails.
  - Calls `loader.dispose()` on unmount.
  - Re-renders when manifest loading completes.

### 2.9 PR Checklist

- [ ] Add `defaultRegion?: RegionId` to `WidgetDefinition` in `widgetRegistry.ts`
- [ ] Create `packages/framework-core-ui/src/LogViewer.tsx` with real component
- [ ] Replace `LogViewerPlaceholder` in `defaultWidgets.ts` factory with `LogViewerComponent`
- [ ] Update `LOG_VIEWER` in `defaultWidgets.ts` — set `defaultRegion: "bottom"`
- [ ] Update `STATUS_INDICATOR` in `defaultWidgets.ts` — set `defaultRegion: "status-bar"`
- [ ] Create `packages/framework-core-ui/src/widgetLoader.ts` with `WidgetLoader` class
- [ ] Create `packages/framework-core-ui/src/useWidgetLoader.ts` with `useWidgetLoader` hook
- [ ] Create `packages/framework-core-ui/sct-manifest.json` manifest for default widgets
- [ ] Export `WidgetLoader`, `useWidgetLoader`, `SctManifest`, `SctManifestEntry` from `index.ts`
- [ ] Add `defaultRegion` tests to `defaultWidgets.test.ts`
- [ ] Create `LogViewer.test.tsx` with component behaviour tests
- [ ] Create `widgetLoader.test.ts` with all loader behaviour tests
- [ ] Create `useWidgetLoader.test.tsx` with all hook state tests
- [ ] Update `examples/frontend/src/main.tsx` to demonstrate `useWidgetLoader`
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm run test:ui` — all tests pass
- [ ] Run `npm run lint` — no errors

---

## 3. Design Decisions

### 3.1 Registry and Loader Are Loosely Coupled

`WidgetRegistry` has no `loadManifest` method. `WidgetLoader` has no internal state beyond its registry reference and the dispose handles it accumulates. The coupling is one-directional: the loader calls `registry.register()`.

**Why:** If the manifest system were baked into the registry, it would be impossible to test the registry without mocking the manifest loader, and impossible to use the registry without the loader. Keeping them separate means each can be tested independently and swapped independently.

### 3.2 No Auto-Registration from EventBusProvider

`EventBusProvider` does not automatically load any manifest. Framework-provided defaults (`LOG_VIEWER`, `STATUS_INDICATOR`) are available in the registry after the consuming application calls `useWidgetLoader` with the framework manifest URL. This is a one-liner in application code.

**Why:** Auto-loading from the provider would make the manifest URL implicit and unconfigurable. It would also couple the provider to the file system layout of the package. Explicit `useWidgetLoader` calls are transparent, testable, and configurable. The framework's goal is to provide the mechanism, not to make invisible decisions on behalf of the application.

### 3.3 Full Metadata in Manifest — No Eager Module Loads

Manifest entries contain every `WidgetDefinition` field except `factory`. The loader constructs the full `WidgetDefinition` from the manifest without loading the component module. Only `factory` is lazy: the first `factory(options)` call triggers `import(module)[export]`.

**Why:** A manifest may declare dozens of widgets. Loading all their modules at startup would increase initial bundle load time proportionally. Lazy loading means the application only pays for the modules it actually renders. Because all metadata is inlined in the manifest, queries against the registry (channel resolution, defaultRegion lookup) work immediately after `loadManifest` resolves — no module load required.

### 3.4 Hardcoded Manifest URLs for Now

`useWidgetLoader` accepts an arbitrary URL. Consumers currently hardcode the path. Serving manifest files dynamically from the backend — so that installed plugins can register themselves at a well-known URL — is a follow-up task. The `manifestUrl` parameter is intentionally left open for this extension without API changes.

---

## 4. Edge Cases

| Scenario                                                | Behaviour                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest `module` path does not resolve                 | Factory renders `widget-load-error` component inline. No crash. `console.error` logged.                                                        |
| Manifest `export` is not a valid React component        | Factory renders `widget-load-error`. Validation: at minimum, the export must be callable as a React component.                                 |
| Two loaders register widgets with the same name         | Second registration is skipped with `console.warn`. First registration wins.                                                                   |
| `dispose()` called while a factory promise is in flight | Promise resolves normally; component is returned. Widget is then unregistered. Already-rendered instances continue to display until re-render. |
| `loadManifest` called twice on same instance            | Second call rejects immediately with `Error: manifest already loaded`. Call `dispose()` first to reload.                                       |

---

## 5. File Map

```
packages/framework-core-ui/src/
├── widgetRegistry.ts         # MODIFIED: add defaultRegion field to WidgetDefinition
├── defaultWidgets.ts         # MODIFIED: set defaultRegion on LOG_VIEWER + STATUS_INDICATOR; real LogViewer factory
├── LogViewer.tsx             # NEW: real LogViewer component
├── widgetLoader.ts           # NEW: WidgetLoader class
├── useWidgetLoader.ts        # NEW: useWidgetLoader hook
├── index.ts                  # MODIFIED: export WidgetLoader, useWidgetLoader, SctManifest, SctManifestEntry
├── defaultWidgets.test.ts    # MODIFIED: add defaultRegion tests
├── LogViewer.test.tsx        # NEW: component behaviour tests
├── widgetLoader.test.ts      # NEW: loader behaviour tests
└── useWidgetLoader.test.tsx  # NEW: hook state tests

packages/framework-core-ui/
└── sct-manifest.json         # NEW: manifest declaring LOG_VIEWER and STATUS_INDICATOR

examples/frontend/src/
└── main.tsx                  # MODIFIED: demonstrate useWidgetLoader
```
