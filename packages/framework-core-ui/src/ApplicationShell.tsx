import React, { createContext, useEffect, useMemo, useState } from "react";

import { useWidgetRegistryInstance } from "./WidgetRegistryContext";
import {
  ShellBottom,
  ShellHeader,
  ShellMain,
  ShellSidebar,
  ShellStatusBar,
} from "./ShellRegions";
import {
  createDefaultShellLayout,
  type RegionId,
  type RegionItem,
  type RegionSetter,
  type RegionState,
  type ShellLayout,
  type ShellLayoutContextValue,
} from "./shellTypes";

// ─── ShellLayoutContext ───────────────────────────────────────────────────────

/**
 * React context providing the current {@link ShellLayout} and a functional
 * updater.  Consumed by region sub-components and the `useShellLayout` hook.
 *
 * @example
 * ```tsx
 * const { layout, setLayout } = useContext(ShellLayoutContext)!;
 * ```
 */
export const ShellLayoutContext = createContext<ShellLayoutContextValue | null>(null);

// ─── Non-togglable correction ─────────────────────────────────────────────────

/** Regions that must always be visible — silently corrected if `false`. */
const NON_TOGGLABLE: ReadonlySet<RegionId> = new Set<RegionId>([
  "header",
  "main",
  "status-bar",
]);

/**
 * Ensures non-togglable regions (`header`, `main`, `status-bar`) have
 * `visible: true`.  Returns a new layout object if any correction was needed,
 * otherwise returns the same reference.
 *
 * @param layout - Layout to validate.
 * @returns Corrected layout.
 */
function applyNonTogglableCorrection(layout: ShellLayout): ShellLayout {
  let corrected = false;
  const regions = { ...layout.regions } as Record<RegionId, RegionState>;

  for (const regionId of NON_TOGGLABLE) {
    if (!regions[regionId].visible) {
      console.warn(
        `[ApplicationShell] Region "${regionId}" is non-togglable and was forced to visible: true.`,
      );
      regions[regionId] = { ...regions[regionId], visible: true };
      corrected = true;
    }
  }

  return corrected ? { ...layout, regions } : layout;
}

// ─── ShellClassNames ──────────────────────────────────────────────────────────

/**
 * Optional CSS class overrides for each shell region and the content wrapper.
 */
export interface ShellClassNames {
  /** Applied to the {@link ShellHeader} element. */
  header?: string;
  /** Applied to the horizontal content wrapper div (left sidebar + main + right sidebar). */
  content?: string;
  /** Applied to the left {@link ShellSidebar} element. */
  leftSidebar?: string;
  /** Applied to the {@link ShellMain} element. */
  main?: string;
  /** Applied to the right {@link ShellSidebar} element. */
  rightSidebar?: string;
  /** Applied to the {@link ShellBottom} element. */
  bottom?: string;
  /** Applied to the {@link ShellStatusBar} element. */
  statusBar?: string;
}

// ─── ApplicationShellProps ───────────────────────────────────────────────────

/**
 * Props for {@link ApplicationShell}.
 */
export interface ApplicationShellProps {
  /**
   * Explicit layout spec.  When provided, merged over
   * {@link createDefaultShellLayout} — any region not specified in
   * `initialLayout` falls back to its default state.  Auto-placement from the
   * widget registry is skipped.  If omitted, `ApplicationShell` builds the
   * initial layout by grouping registered widgets by their `defaultRegion`
   * field.  Widgets with no `defaultRegion` are not auto-placed.
   */
  initialLayout?: ShellLayout;
  /**
   * Nodes rendered inside {@link ShellLayoutContext.Provider} but outside the
   * visual shell layout.  Use this to mount context consumers (e.g., hooks)
   * that need access to the shell layout without appearing in the DOM.
   */
  children?: React.ReactNode;
  /** Optional CSS class overrides for individual shell regions. */
  classNames?: ShellClassNames;
}

// ─── ApplicationShell ─────────────────────────────────────────────────────────

/**
 * Root shell component that owns the {@link ShellLayout} state and provides it
 * via {@link ShellLayoutContext}.
 *
 * When `initialLayout` is omitted the shell builds its layout from the
 * {@link WidgetRegistry} and continues to react to registry changes after
 * mount.  When `initialLayout` is provided that layout is used as-is (after
 * non-togglable correction) and registry changes are ignored.
 *
 * Non-togglable regions (`header`, `main`, `status-bar`) are silently forced
 * to `visible: true` regardless of what the layout specifies.
 *
 * @param props - {@link ApplicationShellProps}
 * @returns A layout container wrapped in {@link ShellLayoutContext.Provider}.
 * @example
 * ```tsx
 * <WidgetRegistryContext.Provider value={registry}>
 *   <ApplicationShell>
 *     <MyContent />
 *   </ApplicationShell>
 * </WidgetRegistryContext.Provider>
 * ```
 */
export function ApplicationShell({
  initialLayout,
  children,
  classNames,
}: ApplicationShellProps): JSX.Element {
  const registry = useWidgetRegistryInstance();
  const isControlled = initialLayout !== undefined;

  const [layout, setLayout] = useState<ShellLayout>(() => {
    if (isControlled) {
      const base = createDefaultShellLayout();
      const merged: ShellLayout = {
        ...base,
        regions: { ...base.regions, ...initialLayout.regions },
      };
      return applyNonTogglableCorrection(merged);
    }

    // Build layout from registry
    const base = createDefaultShellLayout();
    const regions = { ...base.regions } as Record<RegionId, RegionState>;

    for (const widget of registry.list()) {
      const region = widget.defaultRegion ?? "main";
      const newItem: RegionItem = {
        id: widget.name,
        type: widget.name,
        props: {},
        order: 0,
      };
      regions[region] = {
        ...regions[region],
        items: [...regions[region].items, newItem],
      };
    }

    return applyNonTogglableCorrection({ ...base, regions });
  });

  // Post-mount auto-placement: subscribe to registry changes when no
  // explicit initialLayout was provided.
  useEffect(() => {
    if (isControlled) return;

    const handle = registry.onChange((event) => {
      if (event.type === "added") {
        // FIXME: Auto-injecting widgets on registration should be removed at a later stage.
        // The registry should only catalog available widget types; the user/consumer
        // should decide what gets placed in the layout and when.
        setLayout((prev) => {
          const region = event.widget.defaultRegion ?? "main";
          const newItem: RegionItem = {
            id: event.widget.name,
            type: event.widget.name,
            props: {},
            order: 0,
          };
          return {
            ...prev,
            regions: {
              ...prev.regions,
              [region]: {
                ...prev.regions[region],
                items: [...prev.regions[region].items, newItem],
              },
            },
          };
        });
      } else if (event.type === "removed") {
        setLayout((prev) => {
          const updatedRegions = { ...prev.regions } as Record<RegionId, RegionState>;
          for (const regionId of Object.keys(updatedRegions) as RegionId[]) {
            updatedRegions[regionId] = {
              ...updatedRegions[regionId],
              items: updatedRegions[regionId].items.filter(
                (item) => item.id !== event.widget.name,
              ),
            };
          }
          return { ...prev, regions: updatedRegions };
        });
      }
    });

    return () => handle.dispose();
  }, [registry, isControlled]);

  const regionSetters = useMemo(() => {
    const ids: RegionId[] = [
      "header",
      "sidebar-left",
      "main",
      "sidebar-right",
      "bottom",
      "status-bar",
    ];
    const map = {} as Record<RegionId, RegionSetter>;
    for (const id of ids) {
      map[id] = (updater) =>
        setLayout((prev) => ({
          ...prev,
          regions: { ...prev.regions, [id]: updater(prev.regions[id]) },
        }));
    }
    return map;
  }, []); // setLayout from useState is stable — empty deps is correct

  return (
    <ShellLayoutContext.Provider value={{ layout, setLayout }}>
      <div data-testid="shell-layout">
        <ShellHeader
          region={layout.regions.header}
          setRegion={regionSetters["header"]}
          className={classNames?.header}
        />
        <div
          className={
            ["sct-ApplicationShell-Content", classNames?.content]
              .filter(Boolean)
              .join(" ") || undefined
          }
          data-testid="shell-body"
        >
          <ShellSidebar
            side="left"
            region={layout.regions["sidebar-left"]}
            setRegion={regionSetters["sidebar-left"]}
            className={classNames?.leftSidebar}
          />
          <ShellMain
            region={layout.regions.main}
            setRegion={regionSetters["main"]}
            className={classNames?.main}
          />
          <ShellSidebar
            side="right"
            region={layout.regions["sidebar-right"]}
            setRegion={regionSetters["sidebar-right"]}
            className={classNames?.rightSidebar}
          />
        </div>
        <ShellBottom
          region={layout.regions.bottom}
          setRegion={regionSetters["bottom"]}
          className={classNames?.bottom}
        />
        <ShellStatusBar
          region={layout.regions["status-bar"]}
          setRegion={regionSetters["status-bar"]}
          className={classNames?.statusBar}
        />
      </div>
      {children}
    </ShellLayoutContext.Provider>
  );
}
