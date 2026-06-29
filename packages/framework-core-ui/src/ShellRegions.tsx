import React, { lazy, Suspense } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { mergeClassNames } from "./helpers";

import type { RegionItem, RegionSetter, RegionState } from "./shellTypes";
import { useWidgetRegistryInstance } from "./WidgetRegistryContext";

// ─── RegionItemRenderer ───────────────────────────────────────────────────────

// Module-level cache: maps widget type name to its lazy-loaded component.
// Phase 1 limitation: cache is never invalidated. If a widget is unregistered
// and re-registered with a different factory, the cached component will be stale.
const componentCache = new Map<string, React.ComponentType>();

/** Renders a single RegionItem — resolves type from registry, falls back to placeholders. */
function RegionItemRenderer({ item }: { item: RegionItem }): React.ReactElement {
  const registry = useWidgetRegistryInstance();
  const definition = registry.get(item.type);

  if (!definition) {
    return <div>Widget not found: {item.type}</div>;
  }

  const result = definition.factory({ parameters: item.props });

  // Sync factory — result is already a component
  if (typeof result === "function") {
    const WidgetComponent = result as React.ComponentType<Record<string, unknown>>;
    return <WidgetComponent {...item.props} />;
  }

  // Async factory — result is a Promise, use React.lazy + Suspense
  if (!componentCache.has(item.type)) {
    const widgetType = item.type;
    const LazyComponent = lazy(() =>
      (result as Promise<React.ComponentType>)
        .then((Component) => ({ default: Component }))
        .catch(() => ({
          default: () => <div>Failed to load: {widgetType}</div>,
        })),
    );
    componentCache.set(item.type, LazyComponent);
  }

  const LazyWidget = componentCache.get(item.type)! as React.ComponentType<
    Record<string, unknown>
  >;
  return (
    <Suspense fallback={<div>Loading: {item.type}</div>}>
      <LazyWidget {...item.props} />
    </Suspense>
  );
}

// ─── ShellPartProps ───────────────────────────────────────────────────────────

/** Base props shared by all shell region components. */
export interface ShellPartProps {
  /** Current state of this region. */
  region: RegionState;
  /** Per-region updater. */
  setRegion: RegionSetter;
  /** Optional CSS class name. */
  className?: string;
}

// ─── ShellHeaderProps ─────────────────────────────────────────────────────────

/**
 * Props for {@link ShellHeader}.
 */
export type ShellHeaderProps = ShellPartProps;

// ─── ShellHeader ──────────────────────────────────────────────────────────────

/**
 * Renders the `header` shell region. Always visible (non-togglable).
 *
 * @param props - {@link ShellHeaderProps}
 * @returns A header element with `data-testid="shell-header"` containing sorted region items.
 * @example
 * ```tsx
 * <ShellHeader region={layout.regions.header} setRegion={makeRegionSetter("header")} />
 * ```
 */
export function ShellHeader({
  region,
  setRegion: _setRegion,
  className,
}: ShellHeaderProps): React.ReactElement {
  const sorted = region.items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <header
      className={mergeClassNames("sct-ShellHeader", className)}
      data-testid="shell-header"
    >
      {sorted.map((item) => (
        <RegionItemRenderer key={item.id} item={item} />
      ))}
    </header>
  );
}

// ─── ShellSidebarProps ────────────────────────────────────────────────────────

/**
 * Props for {@link ShellSidebar}.
 */
export interface ShellSidebarProps extends ShellPartProps {
  /** Which sidebar to render. */
  side: "left" | "right";
}

// ─── ShellSidebar ─────────────────────────────────────────────────────────────

/**
 * Renders a collapsible sidebar shell region (`sidebar-left` or `sidebar-right`).
 *
 * Sizing is controlled by the parent `Panel` from `react-resizable-panels`.
 * The toggle button updates `region.visible`; the parent `ApplicationShell`
 * watches that flag and imperatively collapses or expands the panel.
 *
 * @param props - {@link ShellSidebarProps}
 * @returns An aside with `data-testid="shell-sidebar-{side}"` containing sorted region items.
 * @example
 * ```tsx
 * <ShellSidebar side="left" region={layout.regions["sidebar-left"]} setRegion={makeRegionSetter("sidebar-left")} />
 * ```
 */
export function ShellSidebar({
  side,
  region,
  setRegion,
  className,
}: ShellSidebarProps): React.ReactElement {
  const sorted = region.items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <aside
      aria-label={`${side} sidebar`}
      className={mergeClassNames(
        `sct-ShellSidebar sct-ShellSidebar--${side}${
          region.visible ? "" : " sct-ShellSidebar--collapsed"
        }`,
        className,
      )}
      data-testid={`shell-sidebar-${side}`}
    >
      <button
        data-testid={`shell-sidebar-${side}-toggle`}
        className={`sct-ShellRegion-toggle sct-ShellSidebar-toggle sct-ShellSidebar-toggle--${side}`}
        aria-label={`${region.visible ? "Collapse" : "Expand"} ${side} sidebar`}
        aria-expanded={region.visible}
        title={`${region.visible ? "Collapse" : "Expand"} sidebar`}
        onClick={() => setRegion((prev) => ({ ...prev, visible: !prev.visible }))}
      >
        {(side === "left") === region.visible ? (
          <ChevronLeft size={16} aria-hidden />
        ) : (
          <ChevronRight size={16} aria-hidden />
        )}
      </button>
      {sorted.map((item) => (
        <RegionItemRenderer key={item.id} item={item} />
      ))}
    </aside>
  );
}

// ─── ShellMainProps ───────────────────────────────────────────────────────────

/**
 * Props for {@link ShellMain}.
 */
export type ShellMainProps = ShellPartProps;

// ─── ShellMain ────────────────────────────────────────────────────────────────

/**
 * Renders the `main` shell region. Always visible (non-togglable).
 *
 * When the region contains multiple items, they are placed in a vertical
 * `PanelGroup` from `react-resizable-panels` so each item can be resized
 * by dragging the handle between them — just like VS Code panes.
 *
 * @param props - {@link ShellMainProps}
 * @returns A main element with `data-testid="shell-main"` containing sorted region items or an empty placeholder.
 * @example
 * ```tsx
 * <ShellMain region={layout.regions.main} setRegion={makeRegionSetter("main")} />
 * ```
 */
export function ShellMain({
  region,
  setRegion: _setRegion,
  className,
}: ShellMainProps): React.ReactElement {
  const sorted = region.items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <main
      id="sct-main-content"
      tabIndex={-1}
      className={mergeClassNames("sct-ShellMain", className)}
      data-testid="shell-main"
    >
      {sorted.length === 0 ? (
        <div data-testid="shell-main-empty">No widgets placed</div>
      ) : sorted.length === 1 ? (
        <div className="sct-ShellMain-item">
          <RegionItemRenderer item={sorted[0]} />
        </div>
      ) : (
        <Group orientation="vertical" className="sct-ShellPanelGroup">
          {sorted.map((item, idx) => (
            <React.Fragment key={item.id}>
              {idx > 0 && (
                <Separator className="sct-PanelHandle sct-PanelHandle--horizontal" />
              )}
              {/* Percentage strings: react-resizable-panels v4 reads a bare
                  number as pixels, so sizes must carry an explicit `%` unit. */}
              <Panel minSize="8%" defaultSize={`${item.size ?? 100 / sorted.length}%`}>
                <div className="sct-ShellMain-item">
                  <RegionItemRenderer item={item} />
                </div>
              </Panel>
            </React.Fragment>
          ))}
        </Group>
      )}
    </main>
  );
}

// ─── ShellBottomProps ─────────────────────────────────────────────────────────

/**
 * Props for {@link ShellBottom}.
 */
export type ShellBottomProps = ShellPartProps;

// ─── ShellBottom ──────────────────────────────────────────────────────────────

/**
 * Renders the `bottom` shell region. Collapsible.
 *
 * Sizing is controlled by the parent `Panel` from `react-resizable-panels`.
 *
 * @param props - {@link ShellBottomProps}
 * @returns A div with `data-testid="shell-bottom"` containing sorted region items.
 * @example
 * ```tsx
 * <ShellBottom region={layout.regions.bottom} setRegion={makeRegionSetter("bottom")} />
 * ```
 */
export function ShellBottom({
  region,
  setRegion,
  className,
}: ShellBottomProps): React.ReactElement {
  const sorted = region.items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <div
      role="region"
      aria-label="bottom panel"
      className={mergeClassNames(
        `sct-ShellBottom${region.visible ? "" : " sct-ShellBottom--collapsed"}`,
        className,
      )}
      data-testid="shell-bottom"
    >
      <div className="sct-ShellBottom-bar">
        <button
          data-testid="shell-bottom-toggle"
          className="sct-ShellRegion-toggle sct-ShellBottom-toggle"
          aria-label={`${region.visible ? "Collapse" : "Expand"} bottom panel`}
          aria-expanded={region.visible}
          onClick={() => setRegion((prev) => ({ ...prev, visible: !prev.visible }))}
        >
          {region.visible ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronUp size={14} aria-hidden />
          )}
          {region.visible ? "Hide" : "Show"}
        </button>
      </div>
      {sorted.map((item) => (
        <RegionItemRenderer key={item.id} item={item} />
      ))}
    </div>
  );
}

// ─── ShellStatusBarProps ──────────────────────────────────────────────────────

/**
 * Props for {@link ShellStatusBar}.
 */
export type ShellStatusBarProps = ShellPartProps;

// ─── ShellStatusBar ───────────────────────────────────────────────────────────

/**
 * Renders the `status-bar` shell region. Always visible (non-togglable).
 *
 * @param props - {@link ShellStatusBarProps}
 * @returns A footer element with `data-testid="shell-status-bar"` containing sorted region items.
 * @example
 * ```tsx
 * <ShellStatusBar region={layout.regions["status-bar"]} setRegion={makeRegionSetter("status-bar")} />
 * ```
 */
export function ShellStatusBar({
  region,
  setRegion: _setRegion,
  className,
}: ShellStatusBarProps): React.ReactElement {
  const sorted = region.items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <footer
      className={mergeClassNames("sct-ShellStatusBar", className)}
      data-testid="shell-status-bar"
    >
      {sorted.map((item) => (
        <RegionItemRenderer key={item.id} item={item} />
      ))}
    </footer>
  );
}
