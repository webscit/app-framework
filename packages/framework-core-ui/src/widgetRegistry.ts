/** Schema for a single widget type registered in the {@link WidgetRegistry}. */
export interface WidgetDefinition {
  /** Unique identifier, e.g. `"LogViewer"`. */
  name: string;
  /** Human-readable purpose of the widget. */
  description: string;
  /**
   * Open string — which WebSocket stream this widget consumes.
   * Not a closed enum so future stream types need zero registry changes.
   * e.g. `"log"`, `"control"`, `"data"`, `"geometry"`.
   */
  stream: string;
  /**
   * MIME type describing the exact data shape expected.
   * e.g. `"text/plain"`, `"application/x-timeseries+json"`.
   */
  consumes: string;
  /**
   * Open tags for AI reasoning and human search.
   * No validation — any string is valid.
   * e.g. `["log-viewer", "scrollable", "searchable"]`.
   */
  capabilities: string[];
  /**
   * JSON schema of user-configurable parameters.
   * e.g. `{ maxLines: { type: "integer", default: 1000 } }`.
   */
  parameters: Record<string, unknown>;
  /**
   * Relative path to the React component.
   * e.g. `"./src/widgets/LogViewer.tsx"`.
   */
  component: string;
}

type RegistryListener = () => void;

/**
 * Catalog of available widget types.
 *
 * Not a singleton — instantiated per `EventBusProvider` so multiple app
 * instances remain independent and tests can construct their own registries.
 *
 * Notifies all registered listeners via {@link onChange} whenever the catalog
 * changes, enabling React hooks to re-render on updates.
 *
 * @example
 * ```ts
 * const registry = new WidgetRegistry();
 * registry.register({ name: "LogViewer", stream: "log", ... });
 * const widgets = registry.findByStream("log");
 * ```
 */
export class WidgetRegistry {
  private readonly widgets = new Map<string, WidgetDefinition>();
  private readonly listeners = new Set<RegistryListener>();

  /**
   * Add *widget* to the catalog.
   *
   * @param widget Widget definition to register.
   * @returns Nothing.
   * @throws Error if a widget with the same name is already registered.
   */
  register(widget: WidgetDefinition): void {
    if (this.widgets.has(widget.name)) {
      throw new Error(`Widget '${widget.name}' is already registered`);
    }
    this.widgets.set(widget.name, widget);
    this.notify();
  }

  /**
   * Remove the widget identified by *name* from the catalog.
   *
   * @param name Widget name to remove.
   * @returns Nothing.
   * @throws Error if no widget with that name is registered.
   */
  unregister(name: string): void {
    if (!this.widgets.has(name)) {
      throw new Error(`Widget '${name}' is not registered`);
    }
    this.widgets.delete(name);
    this.notify();
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
   * Return widgets whose `capabilities` array includes *tag*.
   *
   * @param tag Capability tag to search for.
   * @returns Matching widgets, or `[]` when none match.
   */
  findByCapability(tag: string): WidgetDefinition[] {
    return [...this.widgets.values()].filter((w) => w.capabilities.includes(tag));
  }

  /**
   * Return widgets whose `stream` field equals *stream* exactly.
   *
   * @param stream Stream type string to match.
   * @returns Matching widgets, or `[]` when none match.
   */
  findByStream(stream: string): WidgetDefinition[] {
    return [...this.widgets.values()].filter((w) => w.stream === stream);
  }

  /**
   * Return widgets whose `consumes` field equals *mimeType* exactly.
   *
   * @param mimeType MIME type string to match.
   * @returns Matching widgets, or `[]` when none match.
   */
  findByMime(mimeType: string): WidgetDefinition[] {
    return [...this.widgets.values()].filter((w) => w.consumes === mimeType);
  }

  /**
   * Register *listener* to be called whenever the catalog changes.
   *
   * @param listener Callback invoked on any register/unregister.
   * @returns Function that unregisters the listener.
   * @example
   * ```ts
   * const off = registry.onChange(() => setWidgets(registry.list()));
   * off(); // stop listening
   * ```
   */
  onChange(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
