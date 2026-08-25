import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createDefaultShellLayout, SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import type { LayoutProfile, ShellLayout } from "../shellTypes";
import { applyProfileState, snapshotProfileState } from "../profileStateRegistry";

/**
 * Zustand store shape for saved layout profiles.
 *
 * The store separates two things:
 *
 * - **`workingLayout`** — the live arrangement the shell renders and that the
 *   user edits (drag-to-resize, region toggles, AI-applied layouts). Edits go
 *   here and are **not** written to any saved profile, and are **not** persisted
 *   to `localStorage`.
 * - **`profiles`** — named, frozen *snapshots*. A snapshot is captured only when
 *   the user explicitly saves ({@link ShellLayoutStore.saveAsProfile}), and
 *   loaded back into `workingLayout` when they switch to it
 *   ({@link ShellLayoutStore.switchProfile}). Only profiles + the active id are
 *   persisted.
 *
 * This gives "freeze on save" semantics: rearranging never mutates a saved
 * profile — you must Save to capture the current window, and switching restores
 * exactly what you saved.
 *
 * **Invariants:** there is always at least one profile, and
 * {@link ShellLayoutStore.activeProfileId} always points at an existing profile.
 */
export interface ShellLayoutStore {
  /** All saved profile snapshots. Always length ≥ 1. */
  profiles: LayoutProfile[];
  /** Id of the profile most recently loaded/saved (for the menu label + check). */
  activeProfileId: string;
  /** The live layout the shell renders and the user edits (not persisted). */
  workingLayout: ShellLayout;
  /**
   * Functional updater for the **working layout**. Always pass an updater
   * function — direct value setting is not supported. Edits are ephemeral until
   * captured with {@link ShellLayoutStore.saveAsProfile}.
   */
  setLayout: (updater: (prev: ShellLayout) => ShellLayout) => void;
  /**
   * Capture the current {@link ShellLayoutStore.workingLayout} as a **new**
   * frozen profile snapshot with a fresh id, and make it active. A blank name is
   * ignored (no-op).
   */
  saveAsProfile: (name: string) => void;
  /**
   * Load the profile with `id`: its snapshot is copied into `workingLayout` and
   * it becomes active. No-op if `id` is unknown.
   */
  switchProfile: (id: string) => void;
  /** Rename the profile with `id`. A blank name is rejected (no-op). */
  renameProfile: (id: string, name: string) => void;
  /**
   * Delete the profile with `id`. If it was active, the first remaining profile
   * is loaded and becomes active. Deleting the **last** profile is refused.
   */
  deleteProfile: (id: string) => void;
  /** Reset the working layout back to {@link ShellLayoutStore.defaultLayout}. */
  resetActiveProfile: () => void;
  /**
   * The app's baseline layout — used to seed the first working layout and as the
   * target of {@link ShellLayoutStore.resetActiveProfile}. Set once by
   * `ApplicationShell` on mount; defaults to {@link createDefaultShellLayout}.
   */
  defaultLayout: ShellLayout;
  /**
   * Register the app's baseline layout. Seeds it into `workingLayout` (and any
   * empty profile) **only when nothing has been arranged yet** (first run), so a
   * restored working view / saved profiles survive reloads without a clobber.
   */
  setDefaultLayout: (layout: ShellLayout) => void;
}

/** True when no region in the layout holds any widget. */
function isLayoutEmpty(layout: ShellLayout): boolean {
  return Object.values(layout.regions).every((region) => region.items.length === 0);
}

/** Deep-clone a (JSON-serializable) layout so snapshots never share references. */
function cloneLayout(layout: ShellLayout): ShellLayout {
  return structuredClone(layout);
}

/** Generate a stable unique profile id. */
function newId(): string {
  // Prefer Web Crypto when available (browsers, modern runtimes); fall back for
  // environments that don't expose a global `crypto` (e.g. some node test
  // runtimes) so the store still initialises everywhere.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Find the saved snapshot of the active profile (falls back to the first). */
function activeProfile(state: ShellLayoutStore): LayoutProfile {
  return (
    state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0]
  );
}

/**
 * Selects the layout the shell should render — the live working layout.
 *
 * @param state - The {@link ShellLayoutStore} state.
 * @returns The working {@link ShellLayout}.
 * @example
 * ```ts
 * const layout = selectActiveLayout(useShellLayoutStore.getState());
 * ```
 */
export function selectActiveLayout(state: ShellLayoutStore): ShellLayout {
  return state.workingLayout;
}

/** Build the initial single-"Default"-profile state (empty until seeded). */
function createInitialState(): Pick<
  ShellLayoutStore,
  "profiles" | "activeProfileId" | "workingLayout" | "defaultLayout"
> {
  const id = newId();
  const layout = createDefaultShellLayout();
  return {
    profiles: [{ id, name: "Default", layout: cloneLayout(layout) }],
    activeProfileId: id,
    workingLayout: cloneLayout(layout),
    defaultLayout: cloneLayout(layout),
  };
}

type PersistedShape = Pick<ShellLayoutStore, "profiles" | "activeProfileId">;

/**
 * Migrate a persisted state to the current schema. Only runs when the stored
 * version differs from {@link SHELL_LAYOUT_STORAGE_VERSION} (matching-version
 * data is used as-is).
 *
 * This is a demonstrator: we don't carry backward compatibility. Any
 * version mismatch (or corrupted data) simply resets to a fresh "Default"
 * profile. `workingLayout` is not persisted; it is restored from the active
 * profile in `onRehydrateStorage`.
 */
function migrate(): PersistedShape {
  const init = createInitialState();
  return { profiles: init.profiles, activeProfileId: init.activeProfileId };
}

/**
 * Zustand store for saved layout profiles, persisted to `localStorage`.
 *
 * Storage key: `"sci-framework:shell-layout"`. **Only `profiles` and
 * `activeProfileId` are persisted** — the live `workingLayout` is intentionally
 * not, so unsaved drags never touch storage. On load, `workingLayout` is
 * restored from the active profile's snapshot.
 *
 * @example
 * ```ts
 * const { setLayout, saveAsProfile } = useShellLayoutStore();
 * setLayout((prev) => ({ ...prev, regions: { ...prev.regions } })); // edits working
 * saveAsProfile("Monitoring"); // freezes a snapshot of working
 * ```
 */
export const useShellLayoutStore = create<ShellLayoutStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      setLayout: (updater) =>
        set((state) => ({ workingLayout: updater(state.workingLayout) })),

      saveAsProfile: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const state = get();
        const id = newId();
        const profile: LayoutProfile = {
          id,
          name: trimmed,
          // Freeze a deep-cloned snapshot of the current working layout…
          layout: cloneLayout(state.workingLayout),
          // …and a frozen deep-clone of the current per-widget state, so later
          // edits to a widget can never mutate this snapshot.
          state: structuredClone(snapshotProfileState()),
        };
        set({ profiles: [...state.profiles, profile], activeProfileId: id });
      },

      switchProfile: (id) => {
        const profile = get().profiles.find((p) => p.id === id);
        if (!profile) return;
        // Load the frozen snapshot into the working layout…
        set({ activeProfileId: id, workingLayout: cloneLayout(profile.layout) });
        // …and replay the saved widget state through registered setters.
        applyProfileState(profile.state);
      },

      renameProfile: (id, name) =>
        set((state) => {
          const trimmed = name.trim();
          if (!trimmed) return {};
          return {
            profiles: state.profiles.map((p) =>
              p.id === id ? { ...p, name: trimmed } : p,
            ),
          };
        }),

      deleteProfile: (id) => {
        const state = get();
        if (state.profiles.length <= 1) return;
        const remaining = state.profiles.filter((p) => p.id !== id);
        if (remaining.length === state.profiles.length) return; // unknown id
        if (state.activeProfileId === id) {
          const next = remaining[0];
          set({
            profiles: remaining,
            activeProfileId: next.id,
            workingLayout: cloneLayout(next.layout),
          });
          applyProfileState(next.state);
          return;
        }
        set({ profiles: remaining });
      },

      resetActiveProfile: () => {
        set((state) => ({ workingLayout: cloneLayout(state.defaultLayout) }));
        // Reset opted-in widgets (via useProfileState) back to their defaults
        // too, so "Reset to default" clears the whole view, not just the panels.
        applyProfileState(undefined);
      },

      setDefaultLayout: (layout) =>
        set((state) => {
          const updates: Partial<ShellLayoutStore> = { defaultLayout: layout };
          // First run only: seed the working view and any still-empty profile
          // (the fresh "Default") with the app's real layout.
          if (isLayoutEmpty(state.workingLayout)) {
            updates.workingLayout = cloneLayout(layout);
          }
          if (state.profiles.some((p) => isLayoutEmpty(p.layout))) {
            updates.profiles = state.profiles.map((p) =>
              isLayoutEmpty(p.layout) ? { ...p, layout: cloneLayout(layout) } : p,
            );
          }
          return updates;
        }),
    }),
    {
      name: "sci-framework:shell-layout",
      version: SHELL_LAYOUT_STORAGE_VERSION,
      // Persist only the saved snapshots + active id. The live working layout is
      // deliberately excluded so unsaved edits never reach localStorage.
      partialize: (state) => ({
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
      }),
      migrate,
      // After load, restore the working layout from the active profile's snapshot.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.workingLayout = cloneLayout(activeProfile(state).layout);
      },
    },
  ),
);

/**
 * React hook returning the layout the shell should render (the working layout).
 *
 * @returns The working {@link ShellLayout}.
 * @example
 * ```tsx
 * const layout = useActiveLayout();
 * layout.regions.main.visible; // true
 * ```
 */
export function useActiveLayout(): ShellLayout {
  return useShellLayoutStore(selectActiveLayout);
}

/**
 * Clears the persisted profiles from localStorage and resets the store to a
 * single fresh "Default" profile with an empty working layout. Useful for
 * testing and for a "Reset" UI action.
 */
export function clearPersistedLayout(): void {
  // Reset in-memory state first (this re-persists), then clear storage last so
  // the final on-disk value is removed rather than immediately rewritten.
  useShellLayoutStore.setState(createInitialState());
  useShellLayoutStore.persist.clearStorage();
}
