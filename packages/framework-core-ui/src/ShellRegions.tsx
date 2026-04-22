import React from "react";

import type { RegionItem, RegionSetter, RegionState } from "./shellTypes";
import { useWidgetRegistryInstance } from "./WidgetRegistryContext";

// ─── RegionItemRenderer ───────────────────────────────────────────────────────

// TODO: async factory (Promise return) is not yet handled beyond a loading placeholder —
// there is no Suspense/lazy integration. Implement proper async widget loading in a future pass.

/** Renders a single RegionItem — resolves type from registry, falls back to placeholders. */
function RegionItemRenderer({ item }: { item: RegionItem }): JSX.Element {
  const registry = useWidgetRegistryInstance();
  const definition = registry.get(item.type);
  if (!definition) {
    return <div data-testid="widget-not-found">Widget not found: {item.type}</div>;
  }
  const result = definition.factory({ parameters: item.props });
  if (typeof result !== "function") {
    return <div data-testid="widget-loading">Loading: {item.type}</div>;
  }
  const WidgetComponent = result;
  return <WidgetComponent />;
}

// ─── SortedItems ──────────────────────────────────────────────────────────────

/** Renders region items sorted by ascending `order`, then registration order. */
function SortedItems({ items }: { items: RegionItem[] }): JSX.Element | null {
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

// ─── ShellHeaderProps ─────────────────────────────────────────────────────────

/**
 * Props for {@link ShellHeader}.
 */
export interface ShellHeaderProps {
  /** Current state of the header region. */
  region: RegionState;
  /** Per-region updater (accepted for API consistency; header is non-togglable). */
  setRegion: RegionSetter;
  /** Optional CSS class name applied to the header element. */
  className?: string;
}

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
}: ShellHeaderProps): JSX.Element {
  return (
    <header
      className={["sct-ShellHeader", className].filter(Boolean).join(" ") || undefined}
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
export interface ShellSidebarProps {
  /** Which sidebar to render. */
  side: "left" | "right";
  /** Current state of the sidebar region. */
  region: RegionState;
  /** Per-region updater for this sidebar. */
  setRegion: RegionSetter;
  /** Optional CSS class name applied to the sidebar element. */
  className?: string;
}

// ─── ShellSidebar ─────────────────────────────────────────────────────────────

/**
 * Renders a collapsible sidebar shell region (`sidebar-left` or `sidebar-right`).
 *
 * Hidden via `display: none` when the region's `visible` flag is `false`.
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
  setRegion: _setRegion,
  className,
}: ShellSidebarProps): JSX.Element {
  return (
    <aside
      className={["sct-ShellSidebar", className].filter(Boolean).join(" ") || undefined}
      data-testid={`shell-sidebar-${side}`}
      style={{ display: region.visible ? undefined : "none" }}
    >
      <SortedItems items={region.items} />
    </aside>
  );
}

// ─── ShellMainProps ───────────────────────────────────────────────────────────

/**
 * Props for {@link ShellMain}.
 */
export interface ShellMainProps {
  /** Current state of the main region. */
  region: RegionState;
  /** Per-region updater (accepted for API consistency; main is non-togglable). */
  setRegion: RegionSetter;
  /** Optional CSS class name applied to the main element. */
  className?: string;
}

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
}: ShellMainProps): JSX.Element {
  return (
    <main
      className={["sct-ShellMain", className].filter(Boolean).join(" ") || undefined}
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
export interface ShellBottomProps {
  /** Current state of the bottom region. */
  region: RegionState;
  /** Per-region updater for this region. */
  setRegion: RegionSetter;
  /** Optional CSS class name applied to the bottom element. */
  className?: string;
}

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
  setRegion: _setRegion,
  className,
}: ShellBottomProps): JSX.Element {
  return (
    <div
      className={["sct-ShellBottom", className].filter(Boolean).join(" ") || undefined}
      data-testid="shell-bottom"
      style={{ display: region.visible ? undefined : "none" }}
    >
      <SortedItems items={region.items} />
    </div>
  );
}

// ─── ShellStatusBarProps ──────────────────────────────────────────────────────

/**
 * Props for {@link ShellStatusBar}.
 */
export interface ShellStatusBarProps {
  /** Current state of the status-bar region. */
  region: RegionState;
  /** Per-region updater (accepted for API consistency; status-bar is non-togglable). */
  setRegion: RegionSetter;
  /** Optional CSS class name applied to the status-bar element. */
  className?: string;
}

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
}: ShellStatusBarProps): JSX.Element {
  return (
    <footer
      className={
        ["sct-ShellStatusBar", className].filter(Boolean).join(" ") || undefined
      }
      data-testid="shell-status-bar"
    >
      <SortedItems items={region.items} />
    </footer>
  );
}
