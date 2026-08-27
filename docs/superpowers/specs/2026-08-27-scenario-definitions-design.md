# Scenario definition storage + UI slot — design

GitHub issue: #35

## Problem

There is no "simulation scenario" concept in the codebase, backend or
frontend. Scenario definition is inherently simulation-tool dependent (an
FMU parameter set, a MuJoCo choreography, etc.), so the framework should
provide storage and a UI contract rather than a concrete editing UI.

## Goal

Add backend storage for scenario definitions tied to a workspace, plus a
frontend contract that lets each example plug in its own tool-specific
scenario-editing widget without re-inventing persistence or placement.

## Scope

In scope:
- Documenting the `workspace.metadata["scenarios"]` storage convention
  (no new backend code — see "Backend storage" below).
- A new `useScenarios()` hook in `packages/framework-core-ui`.
- Documenting the widget-registration convention examples use to plug a
  scenario-editing widget into the shell.
- Unit tests for `useScenarios()`.

Out of scope (left to each example, or to follow-up issues):
- Any concrete scenario-editing UI — each example (drone, reachy_mini,
  simple) supplies its own, tool-specific to its own parameters.
- New backend routes or a typed `Scenario` Pydantic model — scenarios ride
  entirely on the existing `Workspace`/`workspace.metadata` CRUD from #30.
- A dedicated shell region — the widget uses an existing region (`"main"`).
- Auto-persisting scenario edits independent of the workspace Save action.

## Backend storage

No new code in `pypackages/framework-core`. `Workspace.metadata` (from #30)
already exists as a `dict[str, Any]` escape hatch, explicitly earmarked in
its docstring for scenario references. This design formalizes the
convention without adding a storage layer:

- Key: `metadata["scenarios"]`.
- Value: a JSON array of scenario envelopes (see "Scenario shape" below).
- Read/write path: the existing `GET /workspaces/{id}` and
  `PUT /workspaces/{id}` routes — scenarios are just another field inside
  the `metadata` object those routes already accept and return.

This mirrors how `layout_snapshot`'s version stamp
(`SHELL_LAYOUT_VERSION_METADATA_KEY`) already rides inside
`workspace.metadata` today (see `workspaceStore.ts`'s `save()`).

## Scenario shape

A minimal common envelope, defined once in `framework-core-ui` and reused
by every example:

```ts
export interface Scenario {
  /** Stable identifier, generated client-side (e.g. crypto.randomUUID()). */
  id: string;
  /** Human-readable name shown in scenario lists/pickers. */
  name: string;
  /** Tool-specific scenario payload. Opaque to the framework. */
  data: unknown;
}
```

`id`/`name` are standardized because generic tooling (a scenario picker,
future AI reasoning over "which scenarios exist") needs them without
knowing the domain. `data` is fully opaque — each example defines its own
shape (FMU parameter overrides, choreography steps, etc.) and is
responsible for validating it.

## Frontend: `useScenarios()`

New file: `packages/framework-core-ui/src/useScenarios.ts`, exported from
`index.ts` alongside `useWorkspaceStore`.

### Behavior

Built directly on `useWorkspaceStore` (from #31) — no new zustand store,
no new backend calls:

```ts
export function useScenarios(): {
  scenarios: Scenario[];
  add: (name: string, data: unknown) => void;
  update: (id: string, patch: Partial<Omit<Scenario, "id">>) => void;
  remove: (id: string) => void;
  setScenarios: (scenarios: Scenario[]) => void;
};
```

- `scenarios` reads `activeWorkspace.metadata.scenarios` from
  `useWorkspaceStore()`, defaulting to `[]` when absent or when no
  workspace is active.
- `add`/`update`/`remove`/`setScenarios` all write back into
  `useWorkspaceStore`'s `activeWorkspace.metadata.scenarios` — **local
  state only**. This mirrors how the shell's working layout is edited
  freely and only becomes durable when `save()` runs; no new store or
  backend endpoint is introduced for scenario mutations.
- `add` generates the `id` (`crypto.randomUUID()`) and appends a new
  `Scenario`.
- `update` merges `patch` into the matching scenario by `id`; a no-op if
  `id` isn't found.
- `remove` filters out the scenario by `id`; a no-op if not found.
- Persistence: unchanged — the existing `useWorkspaceStore().save()`
  action (which already sends the full `activeWorkspace`, including
  `metadata`) is the only path that reaches the backend. No new save
  action is added.
- No active workspace: all mutators become no-ops (matching `save()`'s
  existing no-active-workspace no-op behavior), and `scenarios` reads as
  `[]`.

### Testing

`packages/framework-core-ui/src/useScenarios.test.ts` (Vitest +
`react-test-renderer` hook-testing pattern, matching
`workspaceStore.test.ts`):
- `add` appends a scenario with a generated `id` to an empty list.
- `update` patches an existing scenario by `id`; no-ops for an unknown
  `id`.
- `remove` filters an existing scenario by `id`; no-ops for an unknown
  `id`.
- `setScenarios` replaces the list wholesale.
- With no active workspace, `scenarios` is `[]` and mutators are no-ops.
- Mutations do not call the backend (`updateWorkspace` is not invoked)
  until `useWorkspaceStore().save()` is called separately.

## Frontend: widget-registration convention

No new `RegionId`, no shell code changes. The convention (documented in
this spec, not enforced in code): an example's scenario-editing widget is
a normal `WidgetDefinition`, registered the same opt-in way as
`PARAMETER_CONTROLLER`/`LOG_VIEWER` in each example's `main.tsx`, using
`useScenarios()` internally to read/edit the list and
`useWorkspaceStore().save()` (typically via the existing workspace Save
button) to persist.

- `defaultRegion: "main"` — reuses the existing `"main"` shell region
  rather than adding a dedicated one.
- `channelPattern` is set to a scenario-specific but otherwise inert
  pattern (e.g. `"scenario/*"`) since the widget is REST/store-driven, not
  EventBus-driven; explicit placement in a layout does not require a
  channel to actually carry traffic.

Each example supplies its own factory/component; the framework supplies
only `Scenario`, `useScenarios()`, and this registration convention.

## Documentation

- JSDoc on `Scenario`, its fields, and `useScenarios()` (description,
  `@example`), per `CLAUDE.md`'s public-API doc requirement.
- This spec itself documents the `metadata["scenarios"]` backend
  convention and the widget-registration convention, since neither has
  dedicated code to carry doc comments.
