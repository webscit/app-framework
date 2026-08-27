# Frontend Workspace Controller Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `WorkspaceMenu` shell widget to `packages/framework-core-ui`, backed by a new `workspaceStore` Zustand store and `workspaceClient` REST wrapper, so every app can create, open, save, rename, close, and delete a backend-persisted workspace and have it drive the shell layout.

**Architecture:** Three new modules layered the same way `LayoutProfilesMenu` layers on `shellStore`: a thin `fetch`-wrapping client (`workspaceClient.ts`) talking to the 5 `/workspaces` REST endpoints already implemented on `feat/30-workspace-persistence-api`; a Zustand store (`workspaceStore.ts`) that owns workspace list/active state and reaches into `useShellLayoutStore`'s existing public API (`workingLayout`, `setLayout`, `resetActiveProfile`) to keep the shell layout in sync; and a presentational component (`WorkspaceMenu.tsx`) that mirrors `LayoutProfilesMenu.tsx`'s trigger+popover structure and is mounted in `ShellHeader` right after it.

**Tech Stack:** TypeScript, React, Zustand (no `persist` middleware — only the active workspace id is hand-written to `localStorage`), Vitest with `vitest-browser-react` + `vitest/browser` `page` locators (this package's actual browser-mode test convention — not `react-test-renderer`, which the design doc's tech-stack line named but no test in this package uses).

## Global Constraints

- Public APIs must be documented: every exported function gets a JSDoc summary + `@param`/`@returns`/`@example`; every exported interface/type field gets an inline `/** ... */` comment (per `CLAUDE.md`).
- Every feature must be tested: Vitest tests for all three new modules (per `CLAUDE.md`).
- Naming: hooks are named `useX`; this feature adds no new hook, only a store hook `useWorkspaceStore`.
- Imports: explicit named imports, grouped, lint/formatter compliant.
- Testing: no `data-testid`; use `page.getByRole()` / accessible-name selectors only (per `CLAUDE.md` and the existing `LayoutProfilesMenu.test.tsx` convention).
- `localStorage` keys in this package use the `sci-framework:` prefix (see `stores/shellStore.ts:253`, `"sci-framework:shell-layout"`) — **not** `app-framework:` as an earlier draft of the design doc assumed. This plan uses `sci-framework:active-workspace-id`.
- Do not modify `LayoutProfilesMenu.tsx`, `shellStore.ts`'s public API, or the backend workspace API (`pypackages/framework-core/src/sci_framework_core/workspace.py` on `feat/30-workspace-persistence-api`) — this plan only adds new frontend modules and one two-line addition to `ShellRegions.tsx` + `index.ts`.

---

## Backend contract (already implemented on `feat/30-workspace-persistence-api`, read-only reference)

`pypackages/framework-core/src/sci_framework_core/workspace.py` mounts, via `mount_workspace_routes(app, app_name)`:

- `POST /workspaces` — body `{name: string, goal?: string}` → `201` full `Workspace`.
- `GET /workspaces` → `200` `WorkspaceSummary[]`, sorted by `updated_at` descending.
- `GET /workspaces/{id}` → `200` full `Workspace`, or `404 {"detail": "..."}`.
- `PUT /workspaces/{id}` — body: full `Workspace` → `200` saved `Workspace` (server refreshes `updated_at`), or `404`.
- `DELETE /workspaces/{id}` → `204` empty body, or `404`.

Pydantic `Workspace` fields (all present in every JSON response): `id: str`, `name: str`, `created_at: datetime` (serializes to an ISO 8601 string), `updated_at: datetime` (ISO 8601 string), `goal: str | None`, `layout_snapshot: dict | None` (opaque — this plan types it as `ShellLayout | null` on the frontend since that's the only shape the frontend ever writes into it), `metadata: dict` (always present, defaults to `{}`).

---

### Task 1: `workspaceClient.ts` — typed REST wrapper

**Files:**

- Create: `packages/framework-core-ui/src/workspaceClient.ts`
- Test: `packages/framework-core-ui/src/workspaceClient.test.ts`

**Interfaces:**

- Consumes: nothing from this codebase besides `ShellLayout` from `packages/framework-core-ui/src/shellTypes.ts` (already exists).
- Produces (used by Task 2): `WorkspaceSummary`, `Workspace`, `WorkspaceApiError`, `buildWorkspaceApiUrl(locationLike)`, `listWorkspaces(locationLike?)`, `createWorkspace(input: {name: string; goal?: string}, locationLike?)`, `getWorkspace(id, locationLike?)`, `updateWorkspace(id, workspace, locationLike?)`, `deleteWorkspace(id, locationLike?)`. Every function's `locationLike` parameter defaults to `window.location` and every function throws `WorkspaceApiError` on a non-2xx response.

- [ ] **Step 1: Write the failing test file**

Create `packages/framework-core-ui/src/workspaceClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkspaceApiUrl,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  WorkspaceApiError,
} from "./workspaceClient";
import type { Workspace } from "./workspaceClient";

const LOCATION = { protocol: "http:", host: "localhost:5173" };

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: () => Promise.resolve(body),
    }),
  );
}

const WORKSPACE: Workspace = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
  goal: null,
  layout_snapshot: null,
  metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildWorkspaceApiUrl", () => {
  it("builds an http URL from a non-https location", () => {
    expect(buildWorkspaceApiUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
      "http://localhost:5173/workspaces",
    );
  });

  it("builds an https URL from an https location", () => {
    expect(buildWorkspaceApiUrl({ protocol: "https:", host: "app.example.com" })).toBe(
      "https://app.example.com/workspaces",
    );
  });
});

describe("listWorkspaces", () => {
  it("returns the parsed summary list on success", async () => {
    mockFetchOnce(200, [WORKSPACE]);

    const result = await listWorkspaces(LOCATION);

    expect(result).toEqual([WORKSPACE]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces");
  });

  it("throws WorkspaceApiError with the parsed detail on failure", async () => {
    mockFetchOnce(500, { detail: "boom" });

    await expect(listWorkspaces(LOCATION)).rejects.toMatchObject({
      name: "WorkspaceApiError",
      status: 500,
      message: "boom",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new Error("not json")),
      }),
    );

    await expect(listWorkspaces(LOCATION)).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });
});

describe("createWorkspace", () => {
  it("POSTs name and goal and returns the created workspace", async () => {
    mockFetchOnce(201, WORKSPACE);

    const result = await createWorkspace({ name: "Drone survey" }, LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:5173/workspaces",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Drone survey" }),
      }),
    );
  });
});

describe("getWorkspace", () => {
  it("returns the workspace on success", async () => {
    mockFetchOnce(200, WORKSPACE);

    const result = await getWorkspace("w1", LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces/w1");
  });

  it("throws WorkspaceApiError with status 404 when missing", async () => {
    mockFetchOnce(404, { detail: "Workspace 'w1' not found" });

    await expect(getWorkspace("w1", LOCATION)).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateWorkspace", () => {
  it("PUTs the full record and returns the saved workspace", async () => {
    mockFetchOnce(200, WORKSPACE);

    const result = await updateWorkspace("w1", WORKSPACE, LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:5173/workspaces/w1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(WORKSPACE) }),
    );
  });
});

describe("deleteWorkspace", () => {
  it("DELETEs and resolves on success", async () => {
    mockFetchOnce(204, undefined);

    await expect(deleteWorkspace("w1", LOCATION)).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces/w1", {
      method: "DELETE",
    });
  });

  it("throws WorkspaceApiError on failure", async () => {
    mockFetchOnce(404, { detail: "not found" });

    await expect(deleteWorkspace("w1", LOCATION)).rejects.toBeInstanceOf(WorkspaceApiError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/framework-core-ui/`: `npx vitest run src/workspaceClient.test.ts`
Expected: FAIL — `Cannot find module './workspaceClient'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/framework-core-ui/src/workspaceClient.ts`:

```ts
import type { ShellLayout } from "./shellTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Lightweight workspace listing entry, mirroring the backend's
 * `WorkspaceSummary` Pydantic model.
 */
export interface WorkspaceSummary {
  /** Server-generated UUID4, immutable for the workspace's lifetime. */
  id: string;
  /** User-editable display name. */
  name: string;
  /** ISO 8601 timestamp the workspace was created. */
  created_at: string;
  /** ISO 8601 timestamp the workspace was last saved. */
  updated_at: string;
}

/**
 * Full workspace record, mirroring the backend's `Workspace` Pydantic model.
 */
export interface Workspace extends WorkspaceSummary {
  /** Free-text description of the workspace's goal, or `null` if unset. */
  goal: string | null;
  /** Shell layout captured on last save, or `null` if never saved with one. */
  layout_snapshot: ShellLayout | null;
  /** Escape-hatch bag for future scenario/constraint references. */
  metadata: Record<string, unknown>;
}

interface LocationLike {
  /** e.g. `"http:"` or `"https:"`. */
  protocol: string;
  /** Host including port, e.g. `"localhost:5173"`. */
  host: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown by every `workspaceClient` function on a non-2xx HTTP response.
 */
export class WorkspaceApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkspaceApiError";
    this.status = status;
  }
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = response.statusText;
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { detail?: unknown }).detail === "string"
    ) {
      detail = (body as { detail: string }).detail;
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall back to statusText.
  }
  throw new WorkspaceApiError(response.status, detail);
}

// ─── URL building ─────────────────────────────────────────────────────────────

/**
 * Builds the base `/workspaces` REST API URL from a browser location-like object.
 *
 * @param locationLike Current location containing protocol and host.
 * @returns Absolute `http://` or `https://` base URL for the workspaces API.
 * @example
 * ```ts
 * const url = buildWorkspaceApiUrl(window.location);
 * // http://localhost:5173/workspaces
 * ```
 */
export function buildWorkspaceApiUrl(locationLike: LocationLike): string {
  const scheme = locationLike.protocol === "https:" ? "https" : "http";
  return `${scheme}://${locationLike.host}/workspaces`;
}

// ─── CRUD functions ─────────────────────────────────────────────────────────────

/**
 * Lists all workspaces as lightweight summaries.
 *
 * @param locationLike Current location, defaults to `window.location`.
 * @returns Summaries sorted by `updated_at` descending (server-side sort).
 * @throws {WorkspaceApiError} On a non-2xx response.
 * @example
 * ```ts
 * const workspaces = await listWorkspaces();
 * ```
 */
export async function listWorkspaces(
  locationLike: LocationLike = window.location,
): Promise<WorkspaceSummary[]> {
  const response = await fetch(buildWorkspaceApiUrl(locationLike));
  await throwIfNotOk(response);
  return response.json() as Promise<WorkspaceSummary[]>;
}

/**
 * Creates a new workspace.
 *
 * @param input Name and optional goal for the new workspace.
 * @param locationLike Current location, defaults to `window.location`.
 * @returns The newly created `Workspace`, with generated `id` and timestamps.
 * @throws {WorkspaceApiError} On a non-2xx response.
 * @example
 * ```ts
 * const workspace = await createWorkspace({ name: "Drone survey" });
 * ```
 */
export async function createWorkspace(
  input: { name: string; goal?: string },
  locationLike: LocationLike = window.location,
): Promise<Workspace> {
  const response = await fetch(buildWorkspaceApiUrl(locationLike), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await throwIfNotOk(response);
  return response.json() as Promise<Workspace>;
}

/**
 * Fetches one workspace by id.
 *
 * @param id The workspace's `id`.
 * @param locationLike Current location, defaults to `window.location`.
 * @returns The full `Workspace` record.
 * @throws {WorkspaceApiError} With `status: 404` if no such workspace exists.
 * @example
 * ```ts
 * const workspace = await getWorkspace("w1");
 * ```
 */
export async function getWorkspace(
  id: string,
  locationLike: LocationLike = window.location,
): Promise<Workspace> {
  const response = await fetch(`${buildWorkspaceApiUrl(locationLike)}/${id}`);
  await throwIfNotOk(response);
  return response.json() as Promise<Workspace>;
}

/**
 * Saves changes to an existing workspace.
 *
 * @param id The workspace's `id`.
 * @param workspace The full record to save.
 * @param locationLike Current location, defaults to `window.location`.
 * @returns The saved `Workspace`, with `updated_at` refreshed by the server.
 * @throws {WorkspaceApiError} With `status: 404` if no such workspace exists.
 * @example
 * ```ts
 * const saved = await updateWorkspace("w1", workspace);
 * ```
 */
export async function updateWorkspace(
  id: string,
  workspace: Workspace,
  locationLike: LocationLike = window.location,
): Promise<Workspace> {
  const response = await fetch(`${buildWorkspaceApiUrl(locationLike)}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace),
  });
  await throwIfNotOk(response);
  return response.json() as Promise<Workspace>;
}

/**
 * Deletes a workspace.
 *
 * @param id The workspace's `id`.
 * @param locationLike Current location, defaults to `window.location`.
 * @throws {WorkspaceApiError} With `status: 404` if no such workspace exists.
 * @example
 * ```ts
 * await deleteWorkspace("w1");
 * ```
 */
export async function deleteWorkspace(
  id: string,
  locationLike: LocationLike = window.location,
): Promise<void> {
  const response = await fetch(`${buildWorkspaceApiUrl(locationLike)}/${id}`, {
    method: "DELETE",
  });
  await throwIfNotOk(response);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/framework-core-ui/`: `npx vitest run src/workspaceClient.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Typecheck**

Run from `packages/framework-core-ui/`: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/framework-core-ui/src/workspaceClient.ts packages/framework-core-ui/src/workspaceClient.test.ts
git commit -m "feat: add workspaceClient REST wrapper for the /workspaces API"
```

---

### Task 2: `workspaceStore.ts` — Zustand store + shell-layout coupling

**Files:**

- Create: `packages/framework-core-ui/src/stores/workspaceStore.ts`
- Test: `packages/framework-core-ui/src/stores/workspaceStore.test.ts`

**Interfaces:**

- Consumes: everything exported from Task 1's `../workspaceClient` (`WorkspaceSummary`, `Workspace`, `WorkspaceApiError`, `listWorkspaces`, `createWorkspace`, `getWorkspace`, `updateWorkspace`, `deleteWorkspace`); and from the existing `./shellStore`: `useShellLayoutStore` — specifically `useShellLayoutStore.getState().workingLayout: ShellLayout`, `useShellLayoutStore.getState().setLayout(updater: (prev: ShellLayout) => ShellLayout): void`, and `useShellLayoutStore.getState().resetActiveProfile(): void`.
- Produces (used by Task 3): `useWorkspaceStore` (Zustand hook) with state `{workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null; activeWorkspace: Workspace | null; status: "idle" | "loading" | "error"; error: string | null}` and actions `refreshList(): Promise<void>`, `createWorkspace(name: string, goal?: string): Promise<void>`, `openWorkspace(id: string): Promise<void>`, `save(): Promise<void>`, `rename(name: string): Promise<void>`, `close(): void`, `deleteWorkspace(id: string): Promise<void>`. Also produces `ACTIVE_WORKSPACE_STORAGE_KEY: string`, `readStoredActiveWorkspaceId(): string | null`, `clearStoredActiveWorkspaceId(): void` for Task 3's mount-time auto-load.

- [ ] **Step 1: Write the failing test file**

Create `packages/framework-core-ui/src/stores/workspaceStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultShellLayout } from "../shellTypes";
import * as workspaceClient from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { useShellLayoutStore } from "./shellStore";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  readStoredActiveWorkspaceId,
  useWorkspaceStore,
} from "./workspaceStore";

vi.mock("../workspaceClient", async () => {
  const actual =
    await vi.importActual<typeof import("../workspaceClient")>("../workspaceClient");
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  };
});

const SUMMARY: WorkspaceSummary = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const WORKSPACE: Workspace = { ...SUMMARY, goal: null, layout_snapshot: null, metadata: {} };

function resetShellLayout(): void {
  const layout = createDefaultShellLayout();
  useShellLayoutStore.setState({
    profiles: [{ id: "p1", name: "Default", layout }],
    activeProfileId: "p1",
    workingLayout: structuredClone(layout),
    defaultLayout: structuredClone(layout),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetShellLayout();
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspace: null,
    status: "idle",
    error: null,
  });
  vi.mocked(workspaceClient.listWorkspaces).mockReset();
  vi.mocked(workspaceClient.createWorkspace).mockReset();
  vi.mocked(workspaceClient.getWorkspace).mockReset();
  vi.mocked(workspaceClient.updateWorkspace).mockReset();
  vi.mocked(workspaceClient.deleteWorkspace).mockReset();
});

describe("useWorkspaceStore", () => {
  it("refreshList populates workspaces from the API", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);

    await useWorkspaceStore.getState().refreshList();

    expect(useWorkspaceStore.getState().workspaces).toEqual([SUMMARY]);
    expect(useWorkspaceStore.getState().status).toBe("idle");
  });

  it("createWorkspace adds the workspace and makes it active", async () => {
    vi.mocked(workspaceClient.createWorkspace).mockResolvedValue(WORKSPACE);

    await useWorkspaceStore.getState().createWorkspace("Drone survey");

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("w1");
    expect(state.workspaces).toEqual([SUMMARY]);
    expect(readStoredActiveWorkspaceId()).toBe("w1");
  });

  it("openWorkspace applies layout_snapshot to the shell layout store", async () => {
    const layout = createDefaultShellLayout();
    layout.regions.header.visible = false;
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue({
      ...WORKSPACE,
      layout_snapshot: layout,
    });

    await useWorkspaceStore.getState().openWorkspace("w1");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w1");
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(false);
  });

  it("openWorkspace leaves the shell layout untouched when layout_snapshot is null", async () => {
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);
    const before = useShellLayoutStore.getState().workingLayout;

    await useWorkspaceStore.getState().openWorkspace("w1");

    expect(useShellLayoutStore.getState().workingLayout).toEqual(before);
  });

  it("save sends the current shell layout in the update request", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });
    const layout = useShellLayoutStore.getState().workingLayout;
    vi.mocked(workspaceClient.updateWorkspace).mockResolvedValue({
      ...WORKSPACE,
      layout_snapshot: layout,
    });

    await useWorkspaceStore.getState().save();

    expect(workspaceClient.updateWorkspace).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ layout_snapshot: layout }),
    );
  });

  it("close clears the active workspace and resets the shell layout", () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });

    useWorkspaceStore.getState().close();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(readStoredActiveWorkspaceId()).toBeNull();
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(true);
  });

  it("deleteWorkspace on the active workspace clears it and resets the shell layout", async () => {
    useWorkspaceStore.setState({
      workspaces: [SUMMARY],
      activeWorkspaceId: "w1",
      activeWorkspace: WORKSPACE,
    });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });
    vi.mocked(workspaceClient.deleteWorkspace).mockResolvedValue(undefined);

    await useWorkspaceStore.getState().deleteWorkspace("w1");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([]);
    expect(state.activeWorkspaceId).toBeNull();
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(true);
  });

  it("deleteWorkspace on an inactive workspace leaves the active one untouched", async () => {
    useWorkspaceStore.setState({
      workspaces: [SUMMARY, { ...SUMMARY, id: "w2", name: "Other" }],
      activeWorkspaceId: "w1",
      activeWorkspace: WORKSPACE,
    });
    vi.mocked(workspaceClient.deleteWorkspace).mockResolvedValue(undefined);

    await useWorkspaceStore.getState().deleteWorkspace("w2");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([SUMMARY]);
    expect(state.activeWorkspaceId).toBe("w1");
  });

  it("a failed action sets status to error and leaves prior state intact", async () => {
    useWorkspaceStore.setState({ workspaces: [SUMMARY] });
    vi.mocked(workspaceClient.listWorkspaces).mockRejectedValue(
      new workspaceClient.WorkspaceApiError(500, "server exploded"),
    );

    await useWorkspaceStore.getState().refreshList();

    const state = useWorkspaceStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("server exploded");
    expect(state.workspaces).toEqual([SUMMARY]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/framework-core-ui/`: `npx vitest run src/stores/workspaceStore.test.ts`
Expected: FAIL — `Cannot find module './workspaceStore'`.

- [ ] **Step 3: Write the implementation**

Create `packages/framework-core-ui/src/stores/workspaceStore.ts`:

```ts
import { create } from "zustand";

import {
  createWorkspace as createWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  WorkspaceApiError,
} from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { useShellLayoutStore } from "./shellStore";

/** `localStorage` key under which the active workspace id is persisted. */
export const ACTIVE_WORKSPACE_STORAGE_KEY = "sci-framework:active-workspace-id";

/**
 * Reads the active workspace id last written to `localStorage`, if any.
 *
 * @returns The stored workspace id, or `null` if none is stored or
 *   `localStorage` is unavailable.
 * @example
 * ```ts
 * const id = readStoredActiveWorkspaceId();
 * ```
 */
export function readStoredActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActiveWorkspaceId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable (e.g. private browsing quota) — degrade silently.
  }
}

/**
 * Clears the stored active workspace id from `localStorage`.
 *
 * @example
 * ```ts
 * clearStoredActiveWorkspaceId();
 * ```
 */
export function clearStoredActiveWorkspaceId(): void {
  try {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    // localStorage unavailable — nothing to clear.
  }
}

function describeError(error: unknown): string {
  if (error instanceof WorkspaceApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

/**
 * Zustand store shape for the backend-persisted workspace CRUD surface.
 *
 * Only {@link WorkspaceStore.activeWorkspaceId} is persisted client-side (to
 * `localStorage`, via {@link readStoredActiveWorkspaceId} /
 * {@link clearStoredActiveWorkspaceId} — not the Zustand `persist`
 * middleware). `workspaces`, `activeWorkspace`, `status`, and `error` are
 * always re-fetched from the backend and must never be treated as durable.
 */
export interface WorkspaceStore {
  /** All known workspaces as lightweight summaries. */
  workspaces: WorkspaceSummary[];
  /** Id of the currently active workspace, or `null` if none is open. */
  activeWorkspaceId: string | null;
  /**
   * Full record of the active workspace, held so `save`/`rename` know what
   * to send back. Prefer `activeWorkspaceId` + `workspaces` for rendering.
   */
  activeWorkspace: Workspace | null;
  /** Whether the store is idle, mid-request, or the last request failed. */
  status: "idle" | "loading" | "error";
  /** Human-readable message for the last failed action, or `null`. */
  error: string | null;

  /** Re-fetches {@link WorkspaceStore.workspaces} from the backend. */
  refreshList: () => Promise<void>;
  /**
   * Creates a new workspace and makes it active. A successful create also
   * writes its id to `localStorage`.
   */
  createWorkspace: (name: string, goal?: string) => Promise<void>;
  /**
   * Fetches workspace `id`, makes it active, and — if it has a saved
   * `layout_snapshot` — applies it to {@link useShellLayoutStore}'s working
   * layout. A workspace with no saved snapshot leaves the shell layout as-is.
   */
  openWorkspace: (id: string) => Promise<void>;
  /**
   * Saves the active workspace with the shell's current working layout as
   * its `layout_snapshot`. No-op if no workspace is active.
   */
  save: () => Promise<void>;
  /** Renames the active workspace. No-op if no workspace is active or `name` is blank. */
  rename: (name: string) => Promise<void>;
  /**
   * Clears the active workspace (store state + `localStorage`) and resets
   * the shell's working layout back to its default.
   */
  close: () => void;
  /**
   * Deletes workspace `id`. If it was the active workspace, behaves like
   * {@link WorkspaceStore.close} afterward.
   */
  deleteWorkspace: (id: string) => Promise<void>;
}

/**
 * Zustand store for backend-persisted workspaces. See {@link WorkspaceStore}.
 *
 * @example
 * ```ts
 * const { openWorkspace, save } = useWorkspaceStore();
 * await openWorkspace("w1");
 * await save();
 * ```
 */
export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspace: null,
  status: "idle",
  error: null,

  refreshList: async () => {
    set({ status: "loading", error: null });
    try {
      const workspaces = await listWorkspaces();
      set({ workspaces, status: "idle" });
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  createWorkspace: async (name, goal) => {
    set({ status: "loading", error: null });
    try {
      const workspace = await createWorkspaceRequest({ name, goal });
      writeStoredActiveWorkspaceId(workspace.id);
      set((state) => ({
        workspaces: [
          {
            id: workspace.id,
            name: workspace.name,
            created_at: workspace.created_at,
            updated_at: workspace.updated_at,
          },
          ...state.workspaces,
        ],
        activeWorkspaceId: workspace.id,
        activeWorkspace: workspace,
        status: "idle",
      }));
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  openWorkspace: async (id) => {
    set({ status: "loading", error: null });
    try {
      const workspace = await getWorkspace(id);
      writeStoredActiveWorkspaceId(workspace.id);
      set({ activeWorkspaceId: workspace.id, activeWorkspace: workspace, status: "idle" });
      const snapshot = workspace.layout_snapshot;
      if (snapshot) {
        useShellLayoutStore.getState().setLayout(() => snapshot);
      }
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  save: async () => {
    const { activeWorkspace } = get();
    if (!activeWorkspace) return;
    set({ status: "loading", error: null });
    try {
      const layout = useShellLayoutStore.getState().workingLayout;
      const record: Workspace = { ...activeWorkspace, layout_snapshot: layout };
      const saved = await updateWorkspace(activeWorkspace.id, record);
      set((state) => ({
        activeWorkspace: saved,
        workspaces: state.workspaces.map((w) =>
          w.id === saved.id ? { ...w, name: saved.name, updated_at: saved.updated_at } : w,
        ),
        status: "idle",
      }));
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  rename: async (name) => {
    const { activeWorkspace } = get();
    const trimmed = name.trim();
    if (!activeWorkspace || !trimmed) return;
    set({ status: "loading", error: null });
    try {
      const record: Workspace = { ...activeWorkspace, name: trimmed };
      const saved = await updateWorkspace(activeWorkspace.id, record);
      set((state) => ({
        activeWorkspace: saved,
        workspaces: state.workspaces.map((w) =>
          w.id === saved.id ? { ...w, name: saved.name, updated_at: saved.updated_at } : w,
        ),
        status: "idle",
      }));
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },

  close: () => {
    clearStoredActiveWorkspaceId();
    set({ activeWorkspaceId: null, activeWorkspace: null });
    useShellLayoutStore.getState().resetActiveProfile();
  },

  deleteWorkspace: async (id) => {
    set({ status: "loading", error: null });
    try {
      await deleteWorkspaceRequest(id);
      const closingActive = get().activeWorkspaceId === id;
      set((state) => ({
        workspaces: state.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId: closingActive ? null : state.activeWorkspaceId,
        activeWorkspace: closingActive ? null : state.activeWorkspace,
        status: "idle",
      }));
      if (closingActive) {
        clearStoredActiveWorkspaceId();
        useShellLayoutStore.getState().resetActiveProfile();
      }
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    }
  },
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/framework-core-ui/`: `npx vitest run src/stores/workspaceStore.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Typecheck**

Run from `packages/framework-core-ui/`: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/framework-core-ui/src/stores/workspaceStore.ts packages/framework-core-ui/src/stores/workspaceStore.test.ts
git commit -m "feat: add workspaceStore with shell-layout coupling"
```

---

### Task 3: `WorkspaceMenu.tsx` + `.css` — shell header widget

**Files:**

- Create: `packages/framework-core-ui/src/components/WorkspaceMenu.tsx`
- Create: `packages/framework-core-ui/src/components/WorkspaceMenu.css`
- Test: `packages/framework-core-ui/src/components/WorkspaceMenu.test.tsx`

**Interfaces:**

- Consumes: Task 2's `useWorkspaceStore`, `readStoredActiveWorkspaceId`, `clearStoredActiveWorkspaceId` from `../stores/workspaceStore`; the existing `Button` from `./ui/button` (same import `LayoutProfilesMenu.tsx` uses).
- Produces (used by Task 4): `WorkspaceMenu(): React.ReactElement`, a component taking no props.

- [ ] **Step 1: Write the failing test file**

Create `packages/framework-core-ui/src/components/WorkspaceMenu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { createDefaultShellLayout } from "../shellTypes";
import { useShellLayoutStore } from "../stores/shellStore";
import { ACTIVE_WORKSPACE_STORAGE_KEY, useWorkspaceStore } from "../stores/workspaceStore";
import * as workspaceClient from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { WorkspaceMenu } from "./WorkspaceMenu";

vi.mock("../workspaceClient", async () => {
  const actual =
    await vi.importActual<typeof import("../workspaceClient")>("../workspaceClient");
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  };
});

const SUMMARY: WorkspaceSummary = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const WORKSPACE: Workspace = { ...SUMMARY, goal: null, layout_snapshot: null, metadata: {} };

beforeEach(() => {
  localStorage.clear();
  const layout = createDefaultShellLayout();
  useShellLayoutStore.setState({
    profiles: [{ id: "p1", name: "Default", layout }],
    activeProfileId: "p1",
    workingLayout: structuredClone(layout),
    defaultLayout: structuredClone(layout),
  });
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspace: null,
    status: "idle",
    error: null,
  });
  vi.mocked(workspaceClient.listWorkspaces).mockReset().mockResolvedValue([]);
  vi.mocked(workspaceClient.createWorkspace).mockReset();
  vi.mocked(workspaceClient.getWorkspace).mockReset();
  vi.mocked(workspaceClient.updateWorkspace).mockReset();
  vi.mocked(workspaceClient.deleteWorkspace).mockReset();
});

async function openMenu() {
  await page.getByRole("button", { name: /workspace/i }).click();
}

describe("WorkspaceMenu", () => {
  it("labels the trigger 'No workspace' before any workspace is active", async () => {
    await render(<WorkspaceMenu />);

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("No workspace");
  });

  it("lists every workspace as a menu item when opened", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([
      SUMMARY,
      { ...SUMMARY, id: "w2", name: "Bridge inspection" },
    ]);

    await render(<WorkspaceMenu />);
    await openMenu();

    await expect
      .element(page.getByRole("menuitemradio", { name: "Drone survey" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Bridge inspection" }))
      .toBeInTheDocument();
  });

  it("opens a workspace when selected from the list", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitemradio", { name: "Drone survey" }).click();

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("creates a workspace through the New workspace… form", async () => {
    vi.mocked(workspaceClient.createWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitem", { name: "New workspace…" }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill("Drone survey");
    await page.getByRole("button", { name: "Create workspace" }).click();

    expect(workspaceClient.createWorkspace).toHaveBeenCalledWith({
      name: "Drone survey",
      goal: undefined,
    });
    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("disables Save, Rename, Close, and Delete when no workspace is active", async () => {
    await render(<WorkspaceMenu />);
    await openMenu();

    await expect.element(page.getByRole("menuitem", { name: "Save" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Close" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });

  it("auto-opens the workspace named by localStorage on mount", async () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("clears a stale localStorage id without erroring when the workspace no longer exists", async () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "stale-id");
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);

    await render(<WorkspaceMenu />);

    expect(workspaceClient.getWorkspace).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull();
    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("No workspace");
  });

  it("shows an inline error message when an action fails", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockRejectedValue(new Error("network down"));

    await render(<WorkspaceMenu />);
    await openMenu();

    await expect.element(page.getByRole("alert")).toHaveTextContent("network down");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/framework-core-ui/`: `npx vitest run src/components/WorkspaceMenu.test.tsx`
Expected: FAIL — `Cannot find module './WorkspaceMenu'`.

- [ ] **Step 3: Write the CSS**

Create `packages/framework-core-ui/src/components/WorkspaceMenu.css`:

```css
.sct-WorkspaceMenu {
  position: relative;
  display: inline-flex;
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
}

/* ─── Trigger ─────────────────────────────────────────────────────────────── */

.sct-WorkspaceMenu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background-color: var(--card);
  color: var(--foreground);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.sct-WorkspaceMenu-trigger:hover {
  background-color: var(--muted);
}

.sct-WorkspaceMenu-triggerLabel {
  font-weight: 500;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sct-WorkspaceMenu-caret {
  font-size: 10px;
  color: var(--muted-foreground);
}

/* ─── Popover ─────────────────────────────────────────────────────────────── */

.sct-WorkspaceMenu-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 224px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background-color: var(--popover, var(--card));
  color: var(--popover-foreground, var(--foreground));
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.12),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
}

.sct-WorkspaceMenu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.sct-WorkspaceMenu-item:hover:not(:disabled) {
  background-color: var(--muted);
}

.sct-WorkspaceMenu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Checkmark before the active workspace via aria-checked. */
.sct-WorkspaceMenu-item[role="menuitemradio"]::before {
  content: "";
  width: 14px;
  flex-shrink: 0;
  color: var(--primary);
}

.sct-WorkspaceMenu-item[role="menuitemradio"][aria-checked="true"]::before {
  content: "✓";
}

.sct-WorkspaceMenu-divider {
  height: 1px;
  margin: 4px 2px;
  background-color: var(--border);
}

/* ─── Inline name form (create / rename) ────────────────────────────────────── */

.sct-WorkspaceMenu-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 6px 6px;
}

.sct-WorkspaceMenu-formLabel {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.sct-WorkspaceMenu-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background-color: var(--background);
  color: var(--foreground);
  font-size: 13px;
  outline: none;
}

.sct-WorkspaceMenu-input:focus-visible {
  border-color: var(--ring, var(--primary));
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--ring, var(--primary)) 25%, transparent);
}

.sct-WorkspaceMenu-formActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 2px;
}

.sct-WorkspaceMenu-formActions > button {
  padding-inline: 12px;
}

/* ─── Inline error ────────────────────────────────────────────────────────── */

.sct-WorkspaceMenu-error {
  margin: 4px 2px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: color-mix(in oklch, var(--destructive) 12%, transparent);
  color: var(--destructive);
  font-size: 12px;
}
```

- [ ] **Step 4: Write the implementation**

Create `packages/framework-core-ui/src/components/WorkspaceMenu.tsx`:

```tsx
import { useEffect, useState } from "react";
import type React from "react";

import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  useWorkspaceStore,
} from "../stores/workspaceStore";
import { Button } from "./ui/button";
import "./WorkspaceMenu.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Which inline text-entry form (if any) the menu is currently showing. */
type Draft =
  | { mode: "idle" }
  | { mode: "creating"; name: string }
  | { mode: "renaming"; name: string };

// ─── WorkspaceMenu ──────────────────────────────────────────────────────────────

/**
 * Header control for creating, opening, saving, renaming, closing, and
 * deleting a backend-persisted workspace.
 *
 * Shows the active workspace's name (or `"No workspace"`) as a menu trigger.
 * Opening it lists every workspace (selecting one calls `openWorkspace`) plus
 * actions to **New workspace…** (inline name entry → `createWorkspace`),
 * **Save** the active workspace's current shell layout (→ `save`),
 * **Rename** it (inline edit → `rename`), **Close** it (→ `close`), and
 * **Delete** it (→ `deleteWorkspace`). Save/Rename/Close/Delete are disabled
 * when no workspace is active.
 *
 * On mount, the workspace list is fetched and, if `localStorage` names a
 * workspace still present in that list, it is opened automatically; a stale
 * id (a workspace deleted elsewhere) is cleared silently.
 *
 * The component is a thin consumer of the workspace store and holds no
 * workspace state of its own — {@link useWorkspaceStore} is the single
 * source of truth. It is placed in the shell header by `ShellRegions`, next
 * to `LayoutProfilesMenu` (which continues to manage local layout presets
 * independently of workspaces).
 *
 * @returns The workspace menu element.
 * @example
 * ```tsx
 * // Rendered inside the shell header:
 * <WorkspaceMenu />
 * ```
 */
export function WorkspaceMenu(): React.ReactElement {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const error = useWorkspaceStore((s) => s.error);
  const refreshList = useWorkspaceStore((s) => s.refreshList);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const save = useWorkspaceStore((s) => s.save);
  const rename = useWorkspaceStore((s) => s.rename);
  const close = useWorkspaceStore((s) => s.close);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ mode: "idle" });

  useEffect(() => {
    async function init(): Promise<void> {
      await refreshList();
      const storedId = readStoredActiveWorkspaceId();
      if (!storedId) return;
      const exists = useWorkspaceStore.getState().workspaces.some((w) => w.id === storedId);
      if (exists) {
        await openWorkspace(storedId);
      } else {
        clearStoredActiveWorkspaceId();
      }
    }
    void init();
    // Runs once on mount only; refreshList/openWorkspace are stable store actions.
  }, []);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const hasActive = active !== undefined;

  function closeMenu(): void {
    setOpen(false);
    setDraft({ mode: "idle" });
  }

  function handleSelect(id: string): void {
    void openWorkspace(id);
    closeMenu();
  }

  function submitDraft(): void {
    if (draft.mode === "creating") {
      void createWorkspace(draft.name);
    } else if (draft.mode === "renaming") {
      void rename(draft.name);
    }
    closeMenu();
  }

  return (
    <div className="sct-WorkspaceMenu">
      <button
        type="button"
        className="sct-WorkspaceMenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${active ? active.name : "No workspace"}`}
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        <span className="sct-WorkspaceMenu-triggerLabel">
          {active ? active.name : "No workspace"}
        </span>
        <span aria-hidden className="sct-WorkspaceMenu-caret">
          ▾
        </span>
      </button>

      {open && (
        <div className="sct-WorkspaceMenu-popover" role="menu" aria-label="Workspaces">
          {draft.mode === "idle" ? (
            <>
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.id === activeWorkspaceId}
                  className="sct-WorkspaceMenu-item"
                  onClick={() => handleSelect(w.id)}
                >
                  {w.name}
                </button>
              ))}

              <div className="sct-WorkspaceMenu-divider" role="separator" />

              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                onClick={() => setDraft({ mode: "creating", name: "" })}
              >
                New workspace…
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  void save();
                  closeMenu();
                }}
              >
                Save
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => setDraft({ mode: "renaming", name: active?.name ?? "" })}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  close();
                  closeMenu();
                }}
              >
                Close
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  if (activeWorkspaceId) void deleteWorkspace(activeWorkspaceId);
                  closeMenu();
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <div className="sct-WorkspaceMenu-form">
              <span className="sct-WorkspaceMenu-formLabel">
                {draft.mode === "creating" ? "New workspace name" : "Rename workspace"}
              </span>
              <input
                className="sct-WorkspaceMenu-input"
                aria-label="Workspace name"
                placeholder={draft.mode === "creating" ? "e.g. Drone survey" : undefined}
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitDraft();
                  } else if (e.key === "Escape") {
                    setDraft({ mode: "idle" });
                  }
                }}
              />
              <div className="sct-WorkspaceMenu-formActions">
                <Button size="sm" onClick={submitDraft}>
                  {draft.mode === "creating" ? "Create workspace" : "Save name"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft({ mode: "idle" })}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="sct-WorkspaceMenu-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `packages/framework-core-ui/`: `npx vitest run src/components/WorkspaceMenu.test.tsx`
Expected: PASS, all 8 tests green.

- [ ] **Step 6: Typecheck and lint**

Run from `packages/framework-core-ui/`: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/framework-core-ui/src/components/WorkspaceMenu.tsx packages/framework-core-ui/src/components/WorkspaceMenu.css packages/framework-core-ui/src/components/WorkspaceMenu.test.tsx
git commit -m "feat: add WorkspaceMenu shell widget"
```

---

### Task 4: Wire `WorkspaceMenu` into the shell and public exports

**Files:**

- Modify: `packages/framework-core-ui/src/ShellRegions.tsx` (import + one JSX line, near line 8 and line 99)
- Modify: `packages/framework-core-ui/src/index.ts` (new exports)
- Modify: `packages/framework-core-ui/src/ShellRegions.test.tsx` (stub `fetch` so mounting `WorkspaceMenu` in existing shell tests never hits the network; add one assertion)

**Interfaces:**

- Consumes: Task 3's `WorkspaceMenu` from `./components/WorkspaceMenu`; Task 2's `useWorkspaceStore`, `WorkspaceStore` from `./stores/workspaceStore`; Task 1's `Workspace`, `WorkspaceSummary`, `WorkspaceApiError`, `buildWorkspaceApiUrl` from `./workspaceClient`.
- Produces: nothing further consumed by later tasks — this is the final integration point.

- [ ] **Step 1: Write the failing test**

In `packages/framework-core-ui/src/ShellRegions.test.tsx`, add `vi` to the existing `vitest` import and stub `fetch` for every test in this file (mounting `ApplicationShell` now also mounts `WorkspaceMenu`, which fetches `/workspaces` on mount):

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

Replace the existing `beforeEach` block:

```tsx
beforeEach(() => {
  clearPersistedLayout();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

Then add a new test inside the `describe("ShellHeader", ...)` block, after the existing `"renders header landmark"` test:

```tsx
it("renders the WorkspaceMenu trigger alongside LayoutProfilesMenu", async () => {
  const registry = new WidgetRegistry();
  await renderWithShell(registry);

  await expect
    .element(page.getByRole("button", { name: /layout profile/i }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: /workspace/i }))
    .toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/framework-core-ui/`: `npx vitest run src/ShellRegions.test.tsx`
Expected: FAIL on the new test — no element found matching `/workspace/i` (WorkspaceMenu isn't mounted yet).

- [ ] **Step 3: Wire `WorkspaceMenu` into `ShellHeader`**

In `packages/framework-core-ui/src/ShellRegions.tsx`, add the import next to the existing `LayoutProfilesMenu` import (around line 8):

```tsx
import { LayoutProfilesMenu } from "./components/LayoutProfilesMenu";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
```

And render it right after `<LayoutProfilesMenu />` inside `ShellHeader` (around line 99):

```tsx
<LayoutProfilesMenu />
<WorkspaceMenu />
```

- [ ] **Step 4: Add the public exports**

In `packages/framework-core-ui/src/index.ts`, after the existing `export { LayoutProfilesMenu } from "./components/LayoutProfilesMenu";` line, add:

```ts
export { WorkspaceMenu } from "./components/WorkspaceMenu";
export { useWorkspaceStore, type WorkspaceStore } from "./stores/workspaceStore";
export {
  buildWorkspaceApiUrl,
  WorkspaceApiError,
  type Workspace,
  type WorkspaceSummary,
} from "./workspaceClient";
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `packages/framework-core-ui/`: `npx vitest run src/ShellRegions.test.tsx`
Expected: PASS, including the new test.

- [ ] **Step 6: Run the full package test suite**

Run from `packages/framework-core-ui/`: `npx vitest run`
Expected: PASS — every existing test still green, plus the new `workspaceClient`, `workspaceStore`, and `WorkspaceMenu` suites.

- [ ] **Step 7: Typecheck and lint**

Run from `packages/framework-core-ui/`: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/framework-core-ui/src/ShellRegions.tsx packages/framework-core-ui/src/ShellRegions.test.tsx packages/framework-core-ui/src/index.ts
git commit -m "feat: mount WorkspaceMenu in the shell header by default"
```

---

### Task 5: Repo-wide quality gate

**Files:** none (verification only).

- [ ] **Step 1: Run TypeScript formatting check**

Run from the repo root: `npm run format:check`
Expected: no reported issues. If it fails, run `npm run format` and re-stage the affected files from Tasks 1–4.

- [ ] **Step 2: Run TypeScript lint**

Run from the repo root: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run TypeScript typecheck**

Run from the repo root: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full TypeScript test suite**

Run from the repo root: `npm run test`
Expected: PASS across all workspaces, including `packages/framework-core-ui`.

- [ ] **Step 5: Commit any formatting fixes**

Only if Step 1 required changes:

```bash
git add -u
git commit -m "style: apply formatting to workspace widget files"
```

---

## Post-plan note: cross-branch dependency

This plan's code imports nothing from the backend beyond the JSON shapes documented above — it does not require `feat/30-workspace-persistence-api` to be merged to implement or unit-test it (all backend calls are mocked). Before this branch is merged to `main`, confirm `feat/30-workspace-persistence-api` (issue #30) has landed first, since the widget is non-functional against a `main` that doesn't yet serve `/workspaces`.
