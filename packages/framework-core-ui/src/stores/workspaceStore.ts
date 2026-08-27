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
      set({
        activeWorkspaceId: workspace.id,
        activeWorkspace: workspace,
        status: "idle",
      });
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
          w.id === saved.id
            ? { ...w, name: saved.name, updated_at: saved.updated_at }
            : w,
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
          w.id === saved.id
            ? { ...w, name: saved.name, updated_at: saved.updated_at }
            : w,
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
