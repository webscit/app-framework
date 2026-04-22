/** Serializable identifier for a shell region. */
export type RegionId =
  | "header"
  | "sidebar-left"
  | "main"
  | "sidebar-right"
  | "bottom"
  | "status-bar";

/** A single widget placement in a shell region — fully serializable, no function references. */
export interface RegionItem {
  /** Stable unique identifier. Preserves identity across saves/reloads. */
  id: string;
  /** Widget type name — resolved via WidgetRegistry at render time. */
  type: string;
  /** User-configurable props. Must be JSON-serializable. */
  props: Record<string, unknown>;
  /** Render order within the region. Lower renders first. Defaults to 0. */
  order?: number;
}

/** Serializable state for a single region. */
export interface RegionState {
  /** Whether the region is currently visible. */
  visible: boolean;
  /** Ordered list of widget placements in this region. */
  items: RegionItem[];
}

/** Serializable snapshot of the full shell layout. */
export interface ShellLayout {
  regions: Record<RegionId, RegionState>;
}

/** Context value provided by ApplicationShell. */
export interface ShellLayoutContextValue {
  /** The current shell layout snapshot. */
  layout: ShellLayout;
  /**
   * Functional updater for the shell layout.  Always use the updater form
   * `setLayout(prev => ...)` to guarantee atomic, stale-closure-safe updates.
   * Direct value passing is not supported — only the updater form is exposed.
   */
  setLayout: (updater: (prev: ShellLayout) => ShellLayout) => void;
}

/**
 * Narrowed per-region updater.  Allows a region component to update only its
 * own {@link RegionState} without touching the rest of the {@link ShellLayout}.
 *
 * Toggle visibility example:
 * ```ts
 * setRegion(prev => ({ ...prev, visible: !prev.visible }));
 * ```
 */
export type RegionSetter = (updater: (prev: RegionState) => RegionState) => void;

/**
 * Returns a {@link ShellLayout} with all six regions at their spec-defined
 * default visibility.
 *
 * @returns A fresh `ShellLayout` where `header`, `sidebar-left`, `main`, and
 *   `status-bar` are visible, and `sidebar-right` and `bottom` are hidden.
 * @example
 * ```ts
 * const layout = createDefaultShellLayout();
 * layout.regions.main.visible; // true
 * layout.regions["sidebar-right"].visible; // false
 * ```
 */
export function createDefaultShellLayout(): ShellLayout {
  return {
    regions: {
      header: { visible: true, items: [] },
      "sidebar-left": { visible: true, items: [] },
      main: { visible: true, items: [] },
      "sidebar-right": { visible: false, items: [] },
      bottom: { visible: false, items: [] },
      "status-bar": { visible: true, items: [] },
    },
  };
}
