import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createDefaultShellLayout, SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import type { ShellLayout } from "../shellTypes";

/** Zustand store shape for the persisted shell layout. */
export interface ShellLayoutStore {
  /** Current serializable shell layout snapshot. */
  layout: ShellLayout;
  /**
   * Functional updater for the shell layout.
   * Always pass an updater function — direct value setting is not supported.
   */
  setLayout: (updater: (prev: ShellLayout) => ShellLayout) => void;
}

function migrate(persistedState: unknown, version: number): ShellLayoutStore {
  // version 0 → 1: no breaking changes, pass through
  if (version === 0) {
    return persistedState as ShellLayoutStore;
  }
  // Unknown version — fall back to default
  return { layout: createDefaultShellLayout(), setLayout: () => {} };
}

/**
 * Zustand store that persists the shell layout to `localStorage`.
 *
 * Storage key: `"app-framework:shell-layout"`. Automatically migrates
 * older persisted versions using {@link SHELL_LAYOUT_STORAGE_VERSION}.
 *
 * @example
 * ```ts
 * const { layout, setLayout } = useShellLayoutStore();
 * setLayout(prev => ({ ...prev, regions: { ...prev.regions } }));
 * ```
 */
export const useShellLayoutStore = create<ShellLayoutStore>()(
  persist(
    (set) => ({
      layout: createDefaultShellLayout(),
      setLayout: (updater) => set((state) => ({ layout: updater(state.layout) })),
    }),
    {
      name: "app-framework:shell-layout",
      version: SHELL_LAYOUT_STORAGE_VERSION,
      migrate,
    },
  ),
);

/**
 * Clears the persisted layout from localStorage and resets the store to the
 * default layout. Useful for testing and for a future "Reset layout" UI action.
 */
export function clearPersistedLayout(): void {
  useShellLayoutStore.persist.clearStorage();
  useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout());
}
