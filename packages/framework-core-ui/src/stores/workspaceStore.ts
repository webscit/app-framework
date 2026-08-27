import { create } from "zustand";

import {
  createWorkspace as createWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import { useShellLayoutStore } from "./shellStore";

/**
 * `metadata` key under which {@link SHELL_LAYOUT_STORAGE_VERSION} is stamped
 * when saving a workspace's `layout_snapshot`, so it can be compared against
 * the running app's version before being applied on open.
 */
const SHELL_LAYOUT_VERSION_METADATA_KEY = "shellLayoutVersion";

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

  /**
   * Re-fetches {@link WorkspaceStore.workspaces} from the backend.
   *
   * @returns `true` if the list was refreshed; `false` if the request failed
   *   (in which case `error` describes the failure).
   */
  refreshList: () => Promise<boolean>;
  /**
   * Creates a new workspace and makes it active. A successful create also
   * writes its id to `localStorage`.
   *
   * @returns `true` if the workspace was created; `false` if the request
   *   failed (in which case `error` describes the failure).
   */
  createWorkspace: (name: string, goal?: string) => Promise<boolean>;
  /**
   * Fetches workspace `id`, makes it active, and — if it has a saved,
   * version-compatible `layout_snapshot` — applies it to
   * {@link useShellLayoutStore}'s working layout. A workspace with no saved
   * snapshot, or one whose snapshot's stamped version doesn't match the
   * running app's, leaves the shell layout as-is.
   *
   * @returns `true` if the workspace was fetched and made active; `false` if
   *   the request failed (in which case `error` describes the failure).
   */
  openWorkspace: (id: string) => Promise<boolean>;
  /**
   * Saves the active workspace with the shell's current working layout as
   * its `layout_snapshot`. No-op if no workspace is active.
   *
   * @returns `true` if the save succeeded or there was no active workspace
   *   to save (a no-op); `false` if the request failed (in which case
   *   `error` describes the failure).
   */
  save: () => Promise<boolean>;
  /**
   * Renames the active workspace. No-op if no workspace is active or `name`
   * is blank.
   *
   * @returns `true` if the rename succeeded or was a no-op; `false` if the
   *   request failed (in which case `error` describes the failure).
   */
  rename: (name: string) => Promise<boolean>;
  /**
   * Clears the active workspace (store state + `localStorage`) and resets
   * the shell's working layout back to its default. Also resets `status`
   * and `error` to their idle defaults.
   */
  close: () => void;
  /**
   * Deletes workspace `id`. If it was the active workspace, behaves like
   * {@link WorkspaceStore.close} afterward.
   *
   * @returns `true` if the delete succeeded; `false` if the request failed
   *   (in which case `error` describes the failure).
   */
  deleteWorkspace: (id: string) => Promise<boolean>;
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
      set({ workspaces, status: "idle", error: null });
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
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
        error: null,
      }));
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
    }
  },

  openWorkspace: async (id) => {
    set({ status: "loading", error: null });
    try {
      const workspace = await getWorkspace(id);
      writeStoredActiveWorkspaceId(workspace.id);
      set({
        activeWorkspaceId: workspace.id,
        activeWorkspace: workspace,
        status: "idle",
        error: null,
      });
      const snapshot = workspace.layout_snapshot;
      // layout_snapshot and the shell's own persisted layout are two
      // independent channels for the same ShellLayout shape; only apply the
      // snapshot when it was stamped by a compatible app version, so we
      // never splice an incompatible/foreign snapshot into the live layout.
      const snapshotVersion = workspace.metadata[SHELL_LAYOUT_VERSION_METADATA_KEY];
      if (snapshot && snapshotVersion === SHELL_LAYOUT_STORAGE_VERSION) {
        useShellLayoutStore.getState().setLayout(() => structuredClone(snapshot));
      }
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
    }
  },

  save: async () => {
    const { activeWorkspace } = get();
    if (!activeWorkspace) return true;
    set({ status: "loading", error: null });
    try {
      const layout = useShellLayoutStore.getState().workingLayout;
      const record: Workspace = {
        ...activeWorkspace,
        layout_snapshot: layout,
        metadata: {
          ...activeWorkspace.metadata,
          [SHELL_LAYOUT_VERSION_METADATA_KEY]: SHELL_LAYOUT_STORAGE_VERSION,
        },
      };
      const saved = await updateWorkspace(activeWorkspace.id, record);
      set((state) => ({
        activeWorkspace: saved,
        workspaces: state.workspaces.map((w) =>
          w.id === saved.id
            ? { ...w, name: saved.name, updated_at: saved.updated_at }
            : w,
        ),
        status: "idle",
        error: null,
      }));
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
    }
  },

  rename: async (name) => {
    const { activeWorkspace } = get();
    const trimmed = name.trim();
    if (!activeWorkspace || !trimmed) return true;
    set({ status: "loading", error: null });
    try {
      const record: Workspace = { ...activeWorkspace, name: trimmed };
      const saved = await updateWorkspace(activeWorkspace.id, record);
      set((state) => ({
        activeWorkspace: saved,
        workspaces: state.workspaces.map((w) =>
          w.id === saved.id
            ? { ...w, name: saved.name, updated_at: saved.updated_at }
            : w,
        ),
        status: "idle",
        error: null,
      }));
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
    }
  },

  close: () => {
    clearStoredActiveWorkspaceId();
    set({
      activeWorkspaceId: null,
      activeWorkspace: null,
      status: "idle",
      error: null,
    });
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
        error: null,
      }));
      if (closingActive) {
        clearStoredActiveWorkspaceId();
        useShellLayoutStore.getState().resetActiveProfile();
      }
      return true;
    } catch (error) {
      set({ status: "error", error: describeError(error) });
      return false;
    }
  },
}));
