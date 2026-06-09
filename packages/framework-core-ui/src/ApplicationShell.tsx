import { useEffect, useMemo } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { mergeClassNames } from "./helpers";

import { useShellLayoutStore } from "./stores/shellStore";
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
} from "./shellTypes";

// ─── Non-togglable ──────────────────────────────────────────────────────────

/** Regions that must always be visible — silently forced to true if false. */
const NON_TOGGLABLE: ReadonlySet<RegionId> = new Set<RegionId>([
  "header",
  "main",
  "status-bar",
]);

/**
 * Ensures non-togglable regions (`header`, `main`, `status-bar`) have
 * `visible: true`. Returns a new layout object if any change was needed,
 * otherwise returns the same reference.
 *
 * @param layout - Layout to validate.
 * @returns Validated layout.
 */
export function applyNonTogglableCorrection(layout: ShellLayout): ShellLayout {
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
  /** Applied to the root shell layout div. */
  layout?: string;
  /** Applied to the {@link ShellHeader} element. */
  header?: string;
  /** Applied to the horizontal content wrapper div. */
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
   * Explicit layout spec. When provided, merged over
   * {@link createDefaultShellLayout} — auto-placement is skipped.
   * If omitted, builds layout from WidgetRegistry defaultRegion fields.
   * Widgets with no defaultRegion are auto-placed into main.
   */
  initialLayout?: ShellLayout;
  /** Optional CSS class overrides for individual shell regions. */
  classNames?: ShellClassNames;
}

// ─── ApplicationShell ─────────────────────────────────────────────────────────

/**
 * Root shell component. Owns layout state via Zustand store.
 *
 * When `initialLayout` is omitted the shell builds its layout from the
 * {@link WidgetRegistry}. When provided, that layout is used as-is after
 * non-togglable correction.
 *
 * @param props - {@link ApplicationShellProps}
 * @returns The full shell layout tree with header, sidebars, main, bottom, and status-bar regions.
 * @example
 * ```tsx
 * <WidgetRegistryContext.Provider value={registry}>
 *   <ApplicationShell />
 * </WidgetRegistryContext.Provider>
 * ```
 */
export function ApplicationShell({
  initialLayout,
  classNames,
}: ApplicationShellProps): React.ReactElement {
  const registry = useWidgetRegistryInstance();
  const isControlled = initialLayout !== undefined;
  const { layout, setLayout } = useShellLayoutStore();

  // Initialize layout on mount
  useEffect(() => {
    if (isControlled) {
      const base = createDefaultShellLayout();
      const merged: ShellLayout = {
        ...base,
        regions: { ...base.regions, ...initialLayout.regions },
      };
      useShellLayoutStore.setState({ layout: applyNonTogglableCorrection(merged) });
    } else {
      // Build layout from registry.
      // TODO: Remove once AI layout generation or layout editor is available.
      const base = createDefaultShellLayout();
      const regions = { ...base.regions } as Record<RegionId, RegionState>;

      for (const widget of registry.list()) {
        const region = (widget.defaultRegion ?? "main") as RegionId;
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

      useShellLayoutStore.setState({
        layout: applyNonTogglableCorrection({ ...base, regions }),
      });
    }
  }, []);

  // Subscribe to registry changes
  useEffect(() => {
    const handle = registry.onChange((event) => {
      if (event.type === "added") {
        if (isControlled) return;
        // FIXME: Auto-injecting widgets on registration should be removed at a later stage.
        setLayout((prev) => {
          const region = (event.widget.defaultRegion ?? "main") as RegionId;
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
        // Always remove — even in controlled mode.
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
  }, [registry, isControlled, setLayout]);

  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const bottomPanelRef = usePanelRef();

  // Sync panel collapse/expand with region.visible toggled by the sidebar buttons.
  useEffect(() => {
    const p = leftPanelRef.current;
    if (!p) return;
    if (layout.regions["sidebar-left"].visible) {
      p.expand();
    } else {
      p.collapse();
    }
  }, [layout.regions["sidebar-left"].visible]);

  useEffect(() => {
    const p = rightPanelRef.current;
    if (!p) return;
    if (layout.regions["sidebar-right"].visible) {
      p.expand();
    } else {
      p.collapse();
    }
  }, [layout.regions["sidebar-right"].visible]);

  useEffect(() => {
    const p = bottomPanelRef.current;
    if (!p) return;
    if (layout.regions.bottom.visible) {
      p.expand();
    } else {
      p.collapse();
    }
  }, [layout.regions.bottom.visible]);

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
  }, [setLayout]);

  return (
    <div
      className={mergeClassNames("sct-ApplicationShell", classNames?.layout)}
      data-testid="shell-layout"
    >
      <ShellHeader
        region={layout.regions.header}
        setRegion={regionSetters["header"]}
        className={classNames?.header}
      />

      {/* Vertical split: content row above, bottom panel below */}
      <Group
        orientation="vertical"
        className={mergeClassNames("sct-ApplicationShell-Body", classNames?.content)}
      >
        <Panel minSize={20} defaultSize={80}>
          {/* Horizontal split: left sidebar | main | right sidebar */}
          <Group orientation="horizontal" style={{ height: "100%" }}>
            <Panel
              panelRef={leftPanelRef}
              defaultSize={18}
              minSize={5}
              collapsible
              collapsedSize={0}
            >
              <ShellSidebar
                side="left"
                region={layout.regions["sidebar-left"]}
                setRegion={regionSetters["sidebar-left"]}
                className={classNames?.leftSidebar}
              />
            </Panel>
            <Separator className="sct-PanelHandle sct-PanelHandle--vertical" />
            <Panel minSize={20}>
              <ShellMain
                region={layout.regions.main}
                setRegion={regionSetters["main"]}
                className={classNames?.main}
              />
            </Panel>
            <Separator className="sct-PanelHandle sct-PanelHandle--vertical" />
            <Panel
              panelRef={rightPanelRef}
              defaultSize={18}
              minSize={5}
              collapsible
              collapsedSize={0}
            >
              <ShellSidebar
                side="right"
                region={layout.regions["sidebar-right"]}
                setRegion={regionSetters["sidebar-right"]}
                className={classNames?.rightSidebar}
              />
            </Panel>
          </Group>
        </Panel>

        <Separator className="sct-PanelHandle sct-PanelHandle--horizontal" />

        <Panel
          panelRef={bottomPanelRef}
          defaultSize={20}
          minSize={5}
          collapsible
          collapsedSize={0}
        >
          <ShellBottom
            region={layout.regions.bottom}
            setRegion={regionSetters["bottom"]}
            className={classNames?.bottom}
          />
        </Panel>
      </Group>

      <ShellStatusBar
        region={layout.regions["status-bar"]}
        setRegion={regionSetters["status-bar"]}
        className={classNames?.statusBar}
      />
    </div>
  );
}
