import React, { lazy, Suspense } from "react";
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

// ─── SortedItems ──────────────────────────────────────────────────────────────

/** Renders region items sorted by ascending `order`, then registration order. */
function SortedItems({ items }: { items: RegionItem[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <>
      {items
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((item) => (
          <RegionItemRenderer key={item.id} item={item} />
        ))}
    </>
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
  return (
    <header
      className={mergeClassNames("sct-ShellHeader", className)}
      data-testid="shell-header"
    >
      <SortedItems items={region.items} />
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
 * Collapses to a thin strip (32px) showing only the toggle button when `visible` is `false`.
 * Never fully hidden — the toggle button is always accessible.
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
  return (
    <aside
      aria-label={`${side} sidebar`}
      className={mergeClassNames("sct-ShellSidebar", className)}
      data-testid={`shell-sidebar-${side}`}
      style={{ width: region.visible ? "220px" : "32px", overflow: "hidden" }}
    >
      <button
        data-testid={`shell-sidebar-${side}-toggle`}
        onClick={() => setRegion((prev) => ({ ...prev, visible: !prev.visible }))}
        style={{ width: "100%", cursor: "pointer" }}
      >
        {region.visible ? "<<" : ">>"}
      </button>
      {region.visible && <SortedItems items={region.items} />}
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
 * Shows a `data-testid="shell-main-empty"` fallback when no items are placed.
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
  return (
    <main
      className={mergeClassNames("sct-ShellMain", className)}
      data-testid="shell-main"
    >
      {region.items.length === 0 ? (
        <div data-testid="shell-main-empty">No widgets placed</div>
      ) : (
        <SortedItems items={region.items} />
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
 * Hidden via `display: none` when the region's `visible` flag is `false`.
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
  return (
    <div
      role="region"
      aria-label="bottom panel"
      className={mergeClassNames("sct-ShellBottom", className)}
      data-testid="shell-bottom"
      style={{ display: region.visible ? undefined : "none" }}
    >
      <button
        data-testid="shell-bottom-toggle"
        onClick={() => setRegion((prev) => ({ ...prev, visible: !prev.visible }))}
      >
        {region.visible ? "Hide" : "Show"}
      </button>
      <SortedItems items={region.items} />
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
  return (
    <footer
      className={mergeClassNames("sct-ShellStatusBar", className)}
      data-testid="shell-status-bar"
    >
      <SortedItems items={region.items} />
    </footer>
  );
}
