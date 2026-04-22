import type { ComponentType } from "react";

import { channelMatches } from "./client";
import type { IDisposable } from "./disposable";
import type { RegionId } from "./shellTypes";

export type { IDisposable } from "./disposable";

// ─── ComponentOptions ─────────────────────────────────────────────────────────

/**
 * Options passed to a widget's {@link WidgetDefinition.factory} function.
 */
export interface ComponentOptions {
  /** User-configurable parameters as declared in the widget's `parameters` schema. */
  parameters: Record<string, unknown>;
}

// ─── WidgetDefinition ─────────────────────────────────────────────────────────

/**
 * Schema for a single widget type in the frontend-only {@link WidgetRegistry}.
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
   * The shell region where this widget should be auto-placed when no
   * explicit ShellLayout is provided. Defaults to "main" if omitted.
   */
  defaultRegion?: RegionId;

  /**
   * Glob pattern matching the EventBus channels this widget handles.
   * e.g. `"log/*"`, `"data/temperature"`, `"control/*"`.
   *
   * This is the PRIMARY matching field — the channel conveys intent/purpose.
   * `consumes` then refines the match to the exact data format.
   * See {@link WidgetRegistry.resolveWidgets}.
   */
  channelPattern: string;

  /**
   * MIME types this widget can render, in preference order.
   * e.g. `["text/plain"]`, `["application/x-timeseries+json"]`.
   *
   * This is the REFINEMENT layer — once a channel match is found, `mimeType`
   * is checked against this list to narrow selection.
   */
  consumes: string[];

  /**
   * Sort weight when multiple widgets match the same channel or MIME type.
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
   * Factory that produces the React component for this widget.
   *
   * Receives {@link ComponentOptions} containing user-configured parameters
   * and returns a React component (or a Promise of one for lazy loading).
   */
  factory: (options: ComponentOptions) => ComponentType | Promise<ComponentType>;
}

// ─── WidgetRegistry ───────────────────────────────────────────────────────────

/** Payload delivered to {@link WidgetRegistry.onChange} listeners. */
export interface WidgetChangeEvent {
  type: "added" | "removed";
  widget: Omit<WidgetDefinition, "factory">;
}

export type ChangeListener = (change: WidgetChangeEvent) => void;

/**
 * Frontend-only catalog of available widget types.
 *
 * Widget resolution uses a channel-first strategy:
 * 1. Find widgets whose `channelPattern` glob matches the channel (primary).
 * 2. If `mimeType` is provided, filter those results to widgets whose
 *    `consumes` list includes the mimeType (refinement).
 * 3. Sort by `priority` descending.
 *
 * @example
 * ```ts
 * const registry = new WidgetRegistry();
 * const handle = registry.register({ name: "LogViewer", ... });
 * handle.dispose(); // remove it
 * ```
 */
export class WidgetRegistry {
  private readonly _widgets = new Map<string, WidgetDefinition>();
  private readonly _changeListeners = new Set<ChangeListener>();

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
    if (this._widgets.has(definition.name)) {
      throw new Error(`Widget '${definition.name}' is already registered`);
    }
    this._widgets.set(definition.name, Object.freeze(definition));
    const { factory: _factory, ...snapshot } = definition;
    this._notify({ type: "added", widget: snapshot });

    let disposed = false;
    return Object.freeze({
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this._widgets.delete(definition.name);
        this._notify({ type: "removed", widget: snapshot });
      },
    });
  }

  /**
   * Return the widget with *name*, or `undefined` if not found.
   *
   * @param name Widget name to look up.
   * @returns Matching {@link WidgetDefinition}, or `undefined`.
   */
  get(name: string): WidgetDefinition | undefined {
    return this._widgets.get(name);
  }

  /**
   * Return all registered widgets.
   *
   * @returns Array of every registered {@link WidgetDefinition}, or `[]`.
   */
  list(): WidgetDefinition[] {
    return [...this._widgets.values()];
  }

  /**
   * Return widgets whose `consumes` list includes *mimeType*, sorted by
   * `priority` descending.
   *
   * @param mimeType MIME type to match against each widget's `consumes` array.
   * @returns Matching widgets sorted by priority, or `[]` when none match.
   */
  findByMime(mimeType: string): WidgetDefinition[] {
    return [...this._widgets.values()]
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
    return [...this._widgets.values()]
      .filter((w) => channelMatches(channel, w.channelPattern))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Resolve the best-matching widgets for an incoming message.
   *
   * Resolution strategy (channel-first):
   * 1. Find all widgets whose `channelPattern` glob matches `channel`.
   * 2. If `mimeType` is provided, filter those results to widgets whose
   *    `consumes` list includes the mimeType.
   * 3. Sort by `priority` descending and return.
   *
   * @param channel Concrete channel the message arrived on.
   * @param mimeType Optional MIME type from the message headers.
   * @returns Sorted list of matching widgets, or `[]` when none match.
   */
  resolveWidgets(channel: string, mimeType?: string): WidgetDefinition[] {
    const byChannel = this.findByChannel(channel);
    if (mimeType) {
      return byChannel.filter((w) => w.consumes.includes(mimeType));
    }
    return byChannel;
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
    this._changeListeners.add(listener);
    return Object.freeze({
      dispose: () => {
        this._changeListeners.delete(listener);
      },
    });
  }

  private _notify(change: WidgetChangeEvent): void {
    for (const listener of this._changeListeners) {
      try {
        listener(change);
      } catch (error) {
        console.error("Fail to notify a listener of widget registry changes.", error);
      }
    }
  }
}
