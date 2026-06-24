import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { mergeClassNames } from "./helpers";

import { useShellLayoutStore } from "./stores/shellStore";
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

// ─── ShellAIConfig ─────────────────────────────────────────────────────────

/**
 * Configuration for the built-in AI assistant panel.
 *
 * When passed to {@link ApplicationShell} via the `ai` prop, the shell renders
 * the {@link AIChatPanel} and its collapse/expand affordance itself — wiring
 * the current layout and apply-layout handler from its own store — so consumer
 * apps don't have to repeat that boilerplate.
 */
export interface ShellAIConfig {
  /** Layout-generation endpoint. Defaults to `"/ai/layout"`. */
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
    return <p style={SHELL_STATUS_STYLE}>Loading widgets…</p>;
  }
  if (status === "error") {
    return <p style={SHELL_STATUS_STYLE}>Failed to load widget manifest.</p>;
  }
  return <>{children}</>;
}

const SHELL_STATUS_STYLE: React.CSSProperties = {
  padding: 16,
  fontFamily: "var(--font-sans, sans-serif)",
};

/**
 * Right-edge tab that reopens the collapsed AI assistant. Uses the app's brand
 * tokens (`--primary` / `--primary-foreground`) so consumers can theme it,
 * falling back to a neutral dark treatment when no theme is set.
 */
const AI_TAB_STYLE: React.CSSProperties = {
  position: "fixed",
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  padding: "14px 6px",
  background: "var(--primary, #1e1e1e)",
  color: "var(--primary-foreground, #fff)",
  border: "1px solid var(--primary, #555)",
  borderRight: "none",
  borderRadius: "6px 0 0 6px",
  cursor: "pointer",
  writingMode: "vertical-rl",
  fontSize: 12,
  letterSpacing: "0.06em",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
  zIndex: 40,
};

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
 *   ai={{ apiUrl: "/ai/layout" }}
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
  const { layout, setLayout } = useShellLayoutStore();
  const [chatOpen, setChatOpen] = useState(false);

  const tree = (
    <ShellLayoutTree initialLayout={initialLayout} classNames={classNames} />
  );

  return (
    <>
      {manifestUrl ? <ManifestGate url={manifestUrl}>{tree}</ManifestGate> : tree}

      {ai && (
        <>
          {/* Right-edge tab — stays visible when the panel is collapsed so the
              user can reopen it. */}
          {!chatOpen && (
            <button
              style={AI_TAB_STYLE}
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
          />
        </>
      )}
    </>
  );
}
