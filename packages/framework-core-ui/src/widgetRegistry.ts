import type { ComponentType } from "react";

import { channelMatches } from "./client";

// ─── IDisposable ──────────────────────────────────────────────────────────────

/**
 * Handle returned by registry mutations.  Call {@link IDisposable.dispose}
 * to undo the mutation (e.g. remove a registered widget).
 *
 * Mirrors the JupyterLab `IDisposable` pattern.
 */
export interface IDisposable {
  /** Undo the operation that produced this handle. Idempotent. */
  dispose(): void;
}

// ─── WidgetDefinition ─────────────────────────────────────────────────────────

/**
 * Schema for a single widget type in the frontend-only {@link WidgetRegistry}.
 *
 * The registry is instantiated per {@link EventBusProvider} — it is not a
 * global singleton.
 */
export interface WidgetDefinition {
  /** Unique identifier, e.g. `"LogViewer"`. */
  name: string;

  /**
   * Verbose human-readable purpose.
   *
   * Used for AI reasoning and layout-editor tooltips.
   * No structured capability tags — the description is the reasoning surface.
   */
  description: string;

  /**
   * Glob pattern matching the EventBus channels this widget handles.
   * e.g. `"log/*"`, `"data/temperature"`, `"control/*"`.
   *
   * Used as a fallback when no `mimeType` match is found in the message
   * headers. See {@link WidgetRegistry.resolveWidgets}.
   */
  channelPattern: string;

  /**
   * MIME types this widget can render, in preference order.
   * e.g. `["text/plain"]`, `["application/x-timeseries+json"]`.
   *
   * Widget resolution checks `mimeType` from message headers against this
   * list first, then falls back to `channelPattern` matching.
   */
  consumes: string[];

  /**
   * Sort weight when multiple widgets match the same MIME type or channel.
   * Higher wins.  Widgets with equal priority are returned in registration
   * order.
   */
  priority: number;

  /**
   * JSON schema of user-configurable parameters displayed in the layout editor.
   * e.g. `{ maxLines: { type: "integer", default: 1000 } }`.
   */
  parameters: Record<string, unknown>;

  /**
   * React component responsible for rendering this widget.
   *
   * Passed by reference (not by path string) so the layout editor can
   * render a live preview without a dynamic import step.
   */
  component: ComponentType;
}

// ─── WidgetRegistry ───────────────────────────────────────────────────────────

/** Payload delivered to {@link WidgetRegistry.onChange} listeners. */
export interface WidgetChangeEvent {
  type: "added" | "removed";
  widget: WidgetDefinition;
}

type ChangeListener = (change: WidgetChangeEvent) => void;

/**
 * Frontend-only catalog of available widget types.
 *
 * Instantiated once per {@link EventBusProvider} — not a global singleton —
 * so multiple provider instances remain independent and tests construct their
 * own registries.
 *
 * Widget resolution uses a two-layer strategy:
 * 1. Check `mimeType` from message headers against each widget's `consumes`
 *    list (primary — most specific).
 * 2. Fall back to `channelPattern` glob matching (secondary — broader).
 * Matched widgets are sorted by `priority` descending.
 *
 * Follows the JupyterLab {@link https://jupyterlab.readthedocs.io DocumentRegistry}
 * pattern: `register()` returns an {@link IDisposable} the caller disposes to
 * remove the widget.
 *
 * @example
 * ```ts
 * const registry = new WidgetRegistry();
 * const handle = registry.register({ name: "LogViewer", ... });
 * handle.dispose(); // remove it
 * ```
 */
export class WidgetRegistry {
  private readonly widgets = new Map<string, WidgetDefinition>();
  private readonly changeListeners = new Set<ChangeListener>();

  /**
   * Add *definition* to the catalog.
   *
   * @param definition Widget to register.
   * @returns Disposable — call `dispose()` to remove the widget.
   * @throws Error if a widget with the same name is already registered.
   * @example
   * ```ts
   * const handle = registry.register(LOG_VIEWER);
   * handle.dispose(); // unregisters LOG_VIEWER
   * ```
   */
  register(definition: WidgetDefinition): IDisposable {
    if (this.widgets.has(definition.name)) {
      throw new Error(`Widget '${definition.name}' is already registered`);
    }
    this.widgets.set(definition.name, definition);
    this.notify({ type: "added", widget: definition });

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.widgets.delete(definition.name);
        this.notify({ type: "removed", widget: definition });
      },
    };
  }

  /**
   * Return the widget with *name*, or `undefined` if not found.
   *
   * @param name Widget name to look up.
   * @returns Matching {@link WidgetDefinition}, or `undefined`.
   */
  get(name: string): WidgetDefinition | undefined {
    return this.widgets.get(name);
  }

  /**
   * Return all registered widgets.
   *
   * @returns Array of every registered {@link WidgetDefinition}, or `[]`.
   */
  list(): WidgetDefinition[] {
    return [...this.widgets.values()];
  }

  /**
   * Return widgets whose `consumes` list includes *mimeType*, sorted by
   * `priority` descending.
   *
   * @param mimeType MIME type to match against each widget's `consumes` array.
   * @returns Matching widgets sorted by priority, or `[]` when none match.
   */
  findByMime(mimeType: string): WidgetDefinition[] {
    return [...this.widgets.values()]
      .filter((w) => w.consumes.includes(mimeType))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Return widgets whose `channelPattern` glob matches *channel*, sorted by
   * `priority` descending.
   *
   * @param channel Concrete channel name, e.g. `"log/app"`.
   * @returns Matching widgets sorted by priority, or `[]` when none match.
   */
  findByChannel(channel: string): WidgetDefinition[] {
    return [...this.widgets.values()]
      .filter((w) => channelMatches(channel, w.channelPattern))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Resolve the best-matching widgets for an incoming message.
   *
   * Resolution strategy:
   * 1. If *mimeType* is provided, return `findByMime(mimeType)` (most specific).
   * 2. Otherwise fall back to `findByChannel(channel)`.
   *
   * @param channel Concrete channel the message arrived on.
   * @param mimeType Optional MIME type from the message headers.
   * @returns Sorted list of matching widgets, or `[]` when none match.
   */
  resolveWidgets(channel: string, mimeType?: string): WidgetDefinition[] {
    if (mimeType) {
      const byMime = this.findByMime(mimeType);
      if (byMime.length > 0) return byMime;
    }
    return this.findByChannel(channel);
  }

  /**
   * Subscribe to catalog changes (widgets added or removed).
   *
   * The listener is called with a {@link WidgetChangeEvent} describing each
   * change.  Returns an {@link IDisposable} — call `dispose()` to unsubscribe.
   *
   * @param listener Callback invoked with each change event.
   * @returns Disposable that unsubscribes the listener.
   * @example
   * ```ts
   * const handle = registry.onChange(({ type, widget }) => {
   *   console.log(type, widget.name);
   * });
   * handle.dispose();
   * ```
   */
  onChange(listener: ChangeListener): IDisposable {
    this.changeListeners.add(listener);
    return {
      dispose: () => {
        this.changeListeners.delete(listener);
      },
    };
  }

  private notify(change: WidgetChangeEvent): void {
    for (const listener of this.changeListeners) {
      listener(change);
    }
  }
}
