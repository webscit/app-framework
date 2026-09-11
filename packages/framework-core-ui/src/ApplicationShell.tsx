import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  usePanelRef,
} from "react-resizable-panels";
import { mergeClassNames } from "./helpers";

import {
  selectActiveLayout,
  useActiveLayout,
  useShellLayoutStore,
} from "./stores/shellStore";
import { useWidgetRegistryInstance } from "./WidgetRegistryContext";
import { useWidgetLoader } from "./useWidgetLoader";
import { AIChatPanel, type AISnapshot } from "./components/AIChatPanel";
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
import "./ApplicationShell.css";

// ─── Non-togglable ──────────────────────────────────────────────────────────

/** Regions that must always be visible — silently forced to true if false. */
const NON_TOGGLABLE: ReadonlySet<RegionId> = new Set<RegionId>([
  "header",
  "main",
  "status-bar",
]);

/**
 * Default expanded sizes for the collapsible regions, as a percentage. Used both
 * as the panels' `defaultSize` and as the size a profile restores to when it has
 * no explicit size of its own (e.g. the untouched "Default" profile).
 */
const SIDEBAR_DEFAULT_PCT = 18;
const BOTTOM_DEFAULT_PCT = 20;
// String forms (react-resizable-panels v4 treats a bare number as pixels).
const SIDEBAR_DEFAULT_SIZE = `${SIDEBAR_DEFAULT_PCT}%`;
const BOTTOM_DEFAULT_SIZE = `${BOTTOM_DEFAULT_PCT}%`;

/**
 * Width of the thin rail a collapsed sidebar shrinks to when it still holds
 * widgets — just enough to keep the expand notch reachable. Fixed px (not a
 * percentage) so the rail is a consistent size on any viewport.
 */
const SIDEBAR_RAIL_SIZE = "32px";

/**
 * Height the bottom region collapses to: a thin rail that still shows its
 * toggle bar, so the "Show" control stays reachable after hiding the panel.
 */
const BOTTOM_RAIL_SIZE = "44px";

/**
 * Below this percentage a panel is treated as collapsed, so we don't overwrite
 * a region's persisted expanded size with a near-zero value while it's hidden.
 */
const MIN_PERSISTED_SIZE = 5;

/**
 * Stable panel ids for the resizable groups. Required so a group's layout can
 * be snapshotted and restored by id (`getLayout`/`setLayout`) rather than by
 * positional index.
 */
const PANEL_ID = {
  /** The upper content row of the outer vertical group (holds the sidebars + main). */
  content: "shell-content",
  /** The bottom panel of the outer vertical group. */
  bottom: "shell-bottom",
  /** Left sidebar of the horizontal content group. */
  sidebarLeft: "shell-sidebar-left",
  /** Main region of the horizontal content group (absorbs the remainder). */
  main: "shell-main",
  /** Right sidebar of the horizontal content group. */
  sidebarRight: "shell-sidebar-right",
} as const;

/** A region's persisted size as a percentage string, or the shell default. */
function sizePct(size: number | undefined, fallback: string): string {
  return size != null ? `${size}%` : fallback;
}

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

// ─── ShellAIConfig ─────────────────────────────────────────────────────────

/**
 * Configuration for the built-in AI assistant panel.
 *
 * When passed to {@link ApplicationShell} via the `ai` prop, the shell renders
 * the {@link AIChatPanel} and its collapse/expand affordance itself — wiring
 * the current layout and apply-layout handler from its own store — so consumer
 * apps don't have to repeat that boilerplate.
 *
 * The shell also wires up the **"App view"** toggle: with it on (default),
 * sending a chat message attaches a screenshot of the dashboard so a
 * vision-capable model can reason over what the user sees. It sits next to the
 * **"Data context"** toggle (structured {@link AISnapshot} data); the user picks
 * either, both, or neither per message. No app wiring is required. Privacy note:
 * that image is the user's own dashboard and is sent to the configured model
 * provider, the same as the text context in {@link AISnapshot}.
 */
export interface ShellAIConfig {
  /** Layout-generation endpoint. Defaults to `"/api/ai/layout"`. */
  apiUrl?: string;
  /**
   * Called before every request to attach an application-specific
   * {@link AISnapshot}. Omit for layout-only assistants.
   */
  getSnapshot?: () => AISnapshot;
  /** Called when the user approves AI-suggested parameter values. */
  onApproveParams?: (params: Record<string, unknown>) => void;
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
  /**
   * When set, the shell loads this widget manifest itself (via
   * {@link useWidgetLoader}) and shows loading/error states until it is ready,
   * so consumers don't have to gate rendering on the manifest manually.
   */
  manifestUrl?: string;
  /**
   * When set, the shell renders the built-in {@link AIChatPanel} and its
   * expand affordance, wired to the shell's own layout store.
   */
  ai?: ShellAIConfig;
}

// ─── ShellLayoutTree (internal) ───────────────────────────────────────────────

/**
 * The resizable shell layout tree (header, sidebars, main, bottom, status-bar).
 * Owns layout state via the Zustand store. Internal — consumers use the
 * {@link ApplicationShell} wrapper, which adds optional manifest loading and
 * the built-in AI assistant.
 *
 * When `initialLayout` is omitted the layout is built from the
 * {@link WidgetRegistry}. When provided, that layout is used as-is after
 * non-togglable correction.
 *
 * @param props - `initialLayout` and `classNames` from {@link ApplicationShellProps}.
 * @returns The full shell layout tree.
 */
function ShellLayoutTree({
  initialLayout,
  classNames,
}: Pick<ApplicationShellProps, "initialLayout" | "classNames">): React.ReactElement {
  const registry = useWidgetRegistryInstance();
  const isControlled = initialLayout !== undefined;
  const layout = useActiveLayout();
  const setLayout = useShellLayoutStore((s) => s.setLayout);
  const setDefaultLayout = useShellLayoutStore((s) => s.setDefaultLayout);

  // Register the app's baseline layout on mount. `setDefaultLayout` seeds it
  // into the active profile only when that profile is still empty (first run),
  // so profiles restored from localStorage survive reloads, and "Reset to
  // default" has a real baseline (with widgets) to restore.
  useEffect(() => {
    if (isControlled) {
      const base = createDefaultShellLayout();
      const merged: ShellLayout = {
        ...base,
        regions: { ...base.regions, ...initialLayout.regions },
      };
      setDefaultLayout(applyNonTogglableCorrection(merged));
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

      setDefaultLayout(applyNonTogglableCorrection({ ...base, regions }));
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
  // Imperative handles to the two resizable groups, used to snapshot the whole
  // arrangement (getLayout) and restore it atomically on a profile switch
  // (setLayout) — far more reliable than resizing panels one at a time.
  const contentGroupRef = useGroupRef();
  const bodyGroupRef = useGroupRef();

  const activeProfileId = useShellLayoutStore((s) => s.activeProfileId);

  // Persist a region's live panel size into the active profile so a saved
  // profile captures not just which regions are visible but how large they are.
  // Guarded so we skip near-collapsed sizes (keeping the last expanded size) and
  // avoid redundant writes / feedback loops.
  const persistRegionSize = useCallback(
    (id: RegionId, size: number | undefined) => {
      if (size == null) return;
      const rounded = Math.round(size);
      if (rounded < MIN_PERSISTED_SIZE) return;
      const current = selectActiveLayout(useShellLayoutStore.getState()).regions[id]
        .size;
      if (current === rounded) return;
      setLayout((prev) => ({
        ...prev,
        regions: { ...prev.regions, [id]: { ...prev.regions[id], size: rounded } },
      }));
    },
    [setLayout],
  );

  // Capture live group layouts (fired after every drag settles) into the active
  // profile. Panel ids map to regions; the flex "main"/"content" panels are the
  // remainder and aren't stored.
  const captureContentLayout = useCallback(
    (l: Record<string, number>) => {
      persistRegionSize("sidebar-left", l[PANEL_ID.sidebarLeft]);
      persistRegionSize("sidebar-right", l[PANEL_ID.sidebarRight]);
    },
    [persistRegionSize],
  );
  const captureBodyLayout = useCallback(
    (l: Record<string, number>) => {
      persistRegionSize("bottom", l[PANEL_ID.bottom]);
    },
    [persistRegionSize],
  );

  // Sync panel collapse/expand with region.visible toggled by the region
  // buttons. On expand we `resize()` to an explicit percentage rather than
  // `expand()`: the layout hydrates after mount (visible flips false→true), and
  // react-resizable-panels' `expand()` only restores a "most recent size" that
  // doesn't exist yet, landing the panel on its `minSize` sliver. `resize()`
  // sets a deterministic size and is a no-op when already at that size. The
  // restored size is the region's persisted size when present, else the default.
  useEffect(() => {
    const p = leftPanelRef.current;
    if (!p) return;
    const region = layout.regions["sidebar-left"];
    if (region.visible) {
      if (p.isCollapsed()) p.resize(sizePct(region.size, SIDEBAR_DEFAULT_SIZE));
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [layout.regions["sidebar-left"].visible]);

  useEffect(() => {
    const p = rightPanelRef.current;
    if (!p) return;
    const region = layout.regions["sidebar-right"];
    if (region.visible) {
      if (p.isCollapsed()) p.resize(sizePct(region.size, SIDEBAR_DEFAULT_SIZE));
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [layout.regions["sidebar-right"].visible]);

  useEffect(() => {
    const p = bottomPanelRef.current;
    if (!p) return;
    const region = layout.regions.bottom;
    if (region.visible) {
      if (p.isCollapsed()) p.resize(sizePct(region.size, BOTTOM_DEFAULT_SIZE));
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [layout.regions.bottom.visible]);

  // When the active profile changes, restore each group's arrangement to that
  // profile's sizes in one atomic `setLayout` call. Keyed on `activeProfileId`
  // so it fires on a profile switch, not on every drag.
  //
  // A *visible* panel is always resized: to the profile's saved size, or — when
  // the profile has none (e.g. the untouched "Default") — to the shell default.
  // This is what makes switching back to Default actually shrink a panel the
  // previous profile had enlarged. A *hidden* panel keeps its current (collapsed)
  // size so it stays collapsed; the flex panel absorbs the remainder.
  useEffect(() => {
    const content = contentGroupRef.current;
    if (content) {
      const cur = content.getLayout();
      const left = layout.regions["sidebar-left"];
      const right = layout.regions["sidebar-right"];
      const L = left.visible
        ? (left.size ?? SIDEBAR_DEFAULT_PCT)
        : cur[PANEL_ID.sidebarLeft];
      const R = right.visible
        ? (right.size ?? SIDEBAR_DEFAULT_PCT)
        : cur[PANEL_ID.sidebarRight];
      content.setLayout({
        [PANEL_ID.sidebarLeft]: L,
        [PANEL_ID.main]: Math.max(0, 100 - L - R),
        [PANEL_ID.sidebarRight]: R,
      });
    }
    const body = bodyGroupRef.current;
    if (body) {
      const bottom = layout.regions.bottom;
      if (bottom.visible) {
        const B = bottom.size ?? BOTTOM_DEFAULT_PCT;
        body.setLayout({
          [PANEL_ID.content]: Math.max(0, 100 - B),
          [PANEL_ID.bottom]: B,
        });
      }
    }
    // Keyed only on `activeProfileId`: restore on profile switch, not per drag.
  }, [activeProfileId]);

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
        groupRef={bodyGroupRef}
        onLayoutChanged={captureBodyLayout}
        orientation="vertical"
        className={mergeClassNames("sct-ApplicationShell-Body", classNames?.content)}
      >
        {/* Sizes are percentage strings: react-resizable-panels v4 treats a
            bare number as pixels, so `18` would mean an 18px sliver, not 18%. */}
        <Panel
          id={PANEL_ID.content}
          minSize="20%"
          defaultSize={sizePct(
            layout.regions.bottom.size != null
              ? 100 - layout.regions.bottom.size
              : undefined,
            "80%",
          )}
        >
          {/* Horizontal split: left sidebar | main | right sidebar */}
          <Group
            groupRef={contentGroupRef}
            onLayoutChanged={captureContentLayout}
            orientation="horizontal"
            className="sct-ShellPanelGroup"
          >
            <Panel
              id={PANEL_ID.sidebarLeft}
              panelRef={leftPanelRef}
              defaultSize={sizePct(
                layout.regions["sidebar-left"].size,
                SIDEBAR_DEFAULT_SIZE,
              )}
              minSize="12%"
              collapsible
              // A sidebar with widgets collapses to a thin rail that keeps the
              // expand notch reachable; an empty sidebar hides completely.
              collapsedSize={
                layout.regions["sidebar-left"].items.length > 0
                  ? SIDEBAR_RAIL_SIZE
                  : "0%"
              }
            >
              <ShellSidebar
                side="left"
                region={layout.regions["sidebar-left"]}
                setRegion={regionSetters["sidebar-left"]}
                className={classNames?.leftSidebar}
              />
            </Panel>
            <Separator className="sct-PanelHandle sct-PanelHandle--vertical" />
            <Panel id={PANEL_ID.main} minSize="20%">
              <ShellMain
                region={layout.regions.main}
                setRegion={regionSetters["main"]}
                className={classNames?.main}
              />
            </Panel>
            <Separator className="sct-PanelHandle sct-PanelHandle--vertical" />
            <Panel
              id={PANEL_ID.sidebarRight}
              panelRef={rightPanelRef}
              defaultSize={sizePct(
                layout.regions["sidebar-right"].size,
                SIDEBAR_DEFAULT_SIZE,
              )}
              minSize="12%"
              collapsible
              collapsedSize={
                layout.regions["sidebar-right"].items.length > 0
                  ? SIDEBAR_RAIL_SIZE
                  : "0%"
              }
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
          id={PANEL_ID.bottom}
          panelRef={bottomPanelRef}
          defaultSize={sizePct(layout.regions.bottom.size, BOTTOM_DEFAULT_SIZE)}
          minSize="8%"
          collapsible
          collapsedSize={BOTTOM_RAIL_SIZE}
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

// ─── ManifestGate (internal) ──────────────────────────────────────────────────

/**
 * Loads a widget manifest and renders *children* only once it is ready,
 * showing loading/error fallbacks meanwhile.
 *
 * @param props.url - Manifest URL to load.
 * @param props.children - Rendered once the manifest is ready.
 * @returns The children, or a loading/error fallback.
 */
function ManifestGate({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}): React.ReactElement {
  const status = useWidgetLoader(url);
  if (status === "loading") {
    return <p className="sct-ManifestGate-status">Loading widgets…</p>;
  }
  if (status === "error") {
    return <p className="sct-ManifestGate-status">Failed to load widget manifest.</p>;
  }
  return <>{children}</>;
}

// ─── ApplicationShell ─────────────────────────────────────────────────────────

/**
 * The application shell: a resizable widget layout plus, optionally, manifest
 * loading and a built-in AI assistant.
 *
 * This is intended to be the top-level UI component of an app built on the
 * framework. Pass `manifestUrl` to let the shell load widgets itself, and `ai`
 * to render the {@link AIChatPanel} (and its expand affordance) wired to the
 * shell's own layout store — so consumer apps need no chat-panel boilerplate.
 *
 * @param props - {@link ApplicationShellProps}
 * @returns The shell, gated on manifest loading and with the AI panel when configured.
 * @example
 * ```tsx
 * <ApplicationShell
 *   initialLayout={layout}
 *   manifestUrl="/sct-manifest.json"
 *   ai={{ apiUrl: "/api/ai/layout" }}
 * />
 * ```
 */
export function ApplicationShell({
  initialLayout,
  classNames,
  manifestUrl,
  ai,
}: ApplicationShellProps): React.ReactElement {
  const registry = useWidgetRegistryInstance();
  const layout = useActiveLayout();
  const setLayout = useShellLayoutStore((s) => s.setLayout);
  const [chatOpen, setChatOpen] = useState(false);

  const tree = (
    <ShellLayoutTree initialLayout={initialLayout} classNames={classNames} />
  );

  return (
    <>
      {/* Keyboard users can jump straight to the main region, bypassing the
          header/sidebar widgets. Visually hidden until focused. */}
      <a href="#sct-main-content" className="sct-SkipLink">
        Skip to main content
      </a>

      {manifestUrl ? <ManifestGate url={manifestUrl}>{tree}</ManifestGate> : tree}

      {ai && (
        <>
          {/* Right-edge tab — stays visible when the panel is collapsed so the
              user can reopen it. */}
          {!chatOpen && (
            <button
              className="sct-AIAssistant-tab"
              onClick={() => setChatOpen(true)}
              aria-label="Open AI assistant"
            >
              AI Assistant
            </button>
          )}
          <AIChatPanel
            open={chatOpen}
            onOpenChange={setChatOpen}
            currentLayout={layout}
            onApplyLayout={(proposed) =>
              setLayout(() => applyNonTogglableCorrection(proposed))
            }
            registry={registry}
            apiUrl={ai.apiUrl}
            getSnapshot={ai.getSnapshot}
            onApproveParams={ai.onApproveParams}
            // Screenshot the whole dashboard (header, sidebars, main, bottom) —
            // the chat panel is a sibling of this element, so it is excluded.
            getCaptureTarget={() =>
              document.querySelector<HTMLElement>(".sct-ApplicationShell")
            }
          />
        </>
      )}
    </>
  );
}
