# Frontend Workspace Controller Widget — Design

**Issue:** [#31](https://github.com/webscit/app-framework/issues/31)
**Status:** Design approved, pending implementation plan.
**Depends on:** [#30](https://github.com/webscit/app-framework/issues/30) — Backend workspace persistence API.

**Goal:** Give applications built on the framework a default shell widget for
opening, saving, renaming, closing, and deleting a "workspace" (the persisted
application state defined by #30), wired to the backend workspace API and to
the existing shell layout store.

**Tech stack:** TypeScript, React, Zustand, Vitest, `react-test-renderer`.

---

## 1. Problem Statement

Applications built with the framework display the shell's `LayoutProfilesMenu`
by default, which manages named local (browser `localStorage`) layout
presets. There is no widget for the new backend-owned "workspace" concept
(#30) at all — no way to create, open, save, or close a workspace from the UI.

**What this solves:** a default shell menu, `WorkspaceMenu`, that performs the
full CRUD surface of the workspace API and keeps the shell layout in sync
with the active workspace's `layout_snapshot`.

**What this does not solve (out of scope for this issue):**

- The AI onboarding wizard shown on new-workspace creation (#36).
- Scenario storage or validation constraint UI (#35, #32).
- The "open workspace" AI notification (#37).
- Toast/notification infrastructure — errors are shown inline in the popover.
- Any change to `LayoutProfilesMenu` itself; it continues to manage local
  named layout presets independently of workspaces.

---

## 2. Scope

**In scope:**

- `packages/framework-core-ui/src/workspaceClient.ts` — typed `fetch` wrapper
  around the 5 `/workspaces` REST endpoints from #30.
- `packages/framework-core-ui/src/stores/workspaceStore.ts` — Zustand store
  holding workspace list + active workspace state and actions.
- `packages/framework-core-ui/src/components/WorkspaceMenu.tsx` (+ `.css`) —
  the shell menu widget, mounted by default in `ShellRegions.tsx`.
- Auto-load of the last-active workspace on mount.
- Vitest unit tests for all three new modules.

**Out of scope:** everything listed under "What this does not solve" above.

---

## 3. Architecture

### 3.1 `workspaceClient.ts`

A thin `fetch`-wrapping module, structurally parallel to how
`EventBusContext.tsx` derives its WebSocket URL:

```typescript
function buildWorkspaceApiUrl(locationLike: LocationLike): string {
  const scheme = locationLike.protocol === "https:" ? "https" : "http";
  return `${scheme}://${locationLike.host}/workspaces`;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]>;
export async function createWorkspace(input: { name: string; goal?: string }): Promise<Workspace>;
export async function getWorkspace(id: string): Promise<Workspace>;
export async function updateWorkspace(id: string, workspace: Workspace): Promise<Workspace>;
export async function deleteWorkspace(id: string): Promise<void>;
```

Each function throws a `WorkspaceApiError` (containing the HTTP status and
parsed detail message, when present) on a non-2xx response, so callers (the
store) can distinguish "not found" from other failures if ever needed, while
today the store treats all errors uniformly (see §3.4).

`Workspace` / `WorkspaceSummary` TypeScript types mirror the Pydantic models
from #30 exactly (`id`, `name`, `created_at`, `updated_at`, `goal`,
`layout_snapshot`, `metadata`) and are exported from `index.ts`.

### 3.2 `workspaceStore.ts`

```typescript
interface WorkspaceStore {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;

  refreshList: () => Promise<void>;
  createWorkspace: (name: string, goal?: string) => Promise<void>;
  openWorkspace: (id: string) => Promise<void>;
  save: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  close: () => void;
  deleteWorkspace: (id: string) => Promise<void>;
}
```

Only `activeWorkspaceId` is persisted client-side, under the `localStorage`
key `app-framework:active-workspace-id` (namespaced like the existing
`app-framework:shell-layout` key). This is a plain read/write on that one
key, not the Zustand `persist` middleware — the store's other fields
(`workspaces`, `status`, `error`) are always re-fetched from the backend and
must never be treated as durable client state.

The store holds the full active `Workspace` record (not just its id)
internally, to know what to send back on `save()`/`rename()`; it exposes
`activeWorkspaceId` (and the resolved summary from `workspaces`) as the
public read surface used by the UI to render the current name.

### 3.3 `WorkspaceMenu.tsx`

Same trigger-button + popover structure as `LayoutProfilesMenu.tsx`:

- Trigger label: active workspace's name, or `"No workspace"` when
  `activeWorkspaceId` is `null`.
- Popover, `role="menu"`:
  - List of workspaces (`role="menuitemradio"`, checked = active) → clicking
    calls `openWorkspace(id)`.
  - Divider.
  - **New workspace…** → inline name-entry form (same `Draft` pattern as
    `LayoutProfilesMenu`) → `createWorkspace(name)`.
  - **Save** → `save()`. Disabled when no workspace is active.
  - **Rename** → inline edit form → `rename(name)`. Disabled when no
    workspace is active.
  - **Close** → `close()`. Disabled when no workspace is active.
  - **Delete** → `deleteWorkspace(activeWorkspaceId)`. Disabled when no
    workspace is active.
- On mount (`useEffect`, once): call `refreshList()`; if
  `localStorage["app-framework:active-workspace-id"]` names a workspace
  present in the fetched list, call `openWorkspace(id)` automatically. If the
  stored id is stale (workspace no longer exists — 404), clear the stored key
  and leave no workspace active, silently (no error shown for this specific
  startup case).

Placed in `ShellRegions.tsx` immediately after `LayoutProfilesMenu`, so every
app gets it by default, same as the layout menu.

### 3.4 Layout coupling

- `openWorkspace(id)`: fetches the full `Workspace`, then if
  `layout_snapshot` is non-null, calls
  `useShellLayoutStore.getState().setLayout(() => layout_snapshot as ShellLayout)`.
  If `layout_snapshot` is null (workspace never saved with a layout), the
  shell layout is left untouched.
- `save()`: reads `useShellLayoutStore.getState().layout`, assigns it to the
  active workspace's `layout_snapshot`, and `PUT`s the full record.
- `close()`: clears `activeWorkspaceId` (store + `localStorage`), then calls
  `useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout())`.
- No new coupling is added to `shellStore.ts` itself — `workspaceStore.ts` is
  the one that reaches into `useShellLayoutStore`'s public API
  (`getState().layout`, `getState().setLayout`), keeping `shellStore`
  unaware that workspaces exist.

### 3.5 Error handling

All store actions that call the API wrap the call in try/catch: on failure,
`status` is set to `"error"` and `error` holds a human-readable message (the
`WorkspaceApiError` message, or a generic fallback for network failures).
Store state (`workspaces`, `activeWorkspaceId`) is only updated after a
successful response — a failed `save()` leaves the previously-known state
intact. `WorkspaceMenu` renders `error` as inline text in the popover when
present, and clears it the next time any action is attempted.

---

## 4. Public API Changes

New exports from `packages/framework-core-ui/src/index.ts`:

```typescript
export { WorkspaceMenu } from "./components/WorkspaceMenu";
export { useWorkspaceStore } from "./stores/workspaceStore";
export type { Workspace, WorkspaceSummary } from "./workspaceClient";
```

No existing exports change shape. `ShellRegions.tsx`'s header now always
renders `WorkspaceMenu` alongside `LayoutProfilesMenu` — this is a visible
default-shell change but not a breaking API change (no new required props
anywhere).

---

## 5. Testing

- `workspaceClient.test.ts` — mocks `global.fetch`; covers each of the 5
  functions (success path + non-2xx → `WorkspaceApiError`).
- `workspaceStore.test.ts` — mocks `workspaceClient`; covers:
  - `refreshList` populates `workspaces`.
  - `createWorkspace` sets the new workspace active.
  - `openWorkspace` sets active + applies `layout_snapshot` to
    `shellStore` (asserted via `useShellLayoutStore.getState().layout`).
  - `openWorkspace` leaves shell layout untouched when `layout_snapshot` is
    null.
  - `save` sends the current shell layout in the `PUT` body.
  - `close` clears active id, clears the `localStorage` key, resets shell
    layout to default.
  - `deleteWorkspace` on the active workspace behaves like `close` afterward.
  - A failed action sets `status: "error"` and leaves prior state intact.
- `WorkspaceMenu.test.tsx` — React-renderer tests (mirroring
  `LayoutProfilesMenu.test.tsx`) covering: trigger shows "No workspace"
  initially, opening the popover lists workspaces, "New workspace…" flow,
  disabled state of Save/Rename/Close/Delete with no active workspace, and
  auto-open-on-mount from a stubbed `localStorage` value.

---

## 6. Implementation Checklist

```
- [ ] Task 1: workspaceClient.ts
      - [ ] Workspace/WorkspaceSummary types mirroring #30's Pydantic models
      - [ ] buildWorkspaceApiUrl + 5 fetch-wrapping functions
      - [ ] WorkspaceApiError class
      - [ ] Unit tests (mocked fetch)

- [ ] Task 2: workspaceStore.ts
      - [ ] Store shape + actions per §3.2
      - [ ] localStorage read/write of active workspace id
      - [ ] Layout coupling per §3.4
      - [ ] Unit tests (mocked client, mocked shellStore)

- [ ] Task 3: WorkspaceMenu.tsx + .css
      - [ ] Trigger + popover structure mirroring LayoutProfilesMenu
      - [ ] New/Open/Save/Rename/Close/Delete actions wired to store
      - [ ] Auto-load-on-mount effect
      - [ ] Inline error display
      - [ ] Unit tests

- [ ] Task 4: Wiring
      - [ ] Mount WorkspaceMenu in ShellRegions.tsx header
      - [ ] Export WorkspaceMenu, useWorkspaceStore, Workspace, WorkspaceSummary from index.ts

- [ ] Task 5: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```
