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
 * Builds the base `/api/workspaces` REST API URL from a browser location-like object.
 *
 * @param locationLike Current location containing protocol and host.
 * @returns Absolute `http://` or `https://` base URL for the workspaces API.
 * @example
 * ```ts
 * const url = buildWorkspaceApiUrl(window.location);
 * // http://localhost:5173/api/workspaces
 * ```
 */
export function buildWorkspaceApiUrl(locationLike: LocationLike): string {
  const scheme = locationLike.protocol === "https:" ? "https" : "http";
  return `${scheme}://${locationLike.host}/api/workspaces`;
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
