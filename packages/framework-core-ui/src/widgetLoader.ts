import { createElement } from "react";
import type { ComponentType } from "react";

import type { IDisposable } from "./disposable";
import type { WidgetDefinition, WidgetRegistry } from "./widgetRegistry";

// ─── Manifest types ───────────────────────────────────────────────────────────

// Generated from sct-manifest.schema.json — do not edit by hand.
// To regenerate: npx json-schema-to-typescript <path>/sct-manifest.schema.json -o <path>/sct-manifest.types.ts
import type { SctManifest } from "./sct-manifest.types";
export type { SctManifest, SctWidgetEntry } from "./sct-manifest.types";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** A minimal inline error component rendered when a widget module fails to load. */
function createWidgetLoadError(message: string): ComponentType {
  return function WidgetLoadError() {
    return createElement(
      "div",
      {
        "data-widget-load-error": "true",
        style: {
          color: "#c00",
          padding: "8px",
          fontFamily: "monospace",
          fontSize: "12px",
        },
      },
      message,
    );
  };
}

/** Internal type for the dynamic-import function, replaceable in tests. */
type ImportFn = (modulePath: string) => Promise<Record<string, unknown>>;

// ─── WidgetLoader ─────────────────────────────────────────────────────────────

/**
 * Loads widget definitions from `sct-manifest.json` manifest files and
 * registers them into a {@link WidgetRegistry}.
 *
 * Multiple manifests can be loaded independently — each call to
 * {@link loadManifest} tracks its own registration handles so that a single
 * manifest can be unloaded via {@link unloadManifest} without affecting
 * widgets registered by other manifests.
 *
 * The registry and the loader are loosely coupled:
 * - The registry has no knowledge of manifests.
 * - The loader has no knowledge of how the registry stores or resolves widgets.
 *
 * **Lazy loading:** the factory for each manifest widget wraps the module
 * import in a dynamic `import()`. The module is not loaded until the widget is
 * first rendered — not at manifest load time. All metadata fields are read from
 * the manifest directly, so the registry can answer metadata queries
 * immediately after `loadManifest` resolves.
 *
 * **Disposable pattern:** `WidgetLoader` implements {@link IDisposable}.
 * Calling {@link dispose} unregisters *all* widgets across every loaded
 * manifest. To unload a single manifest, use {@link unloadManifest} instead.
 *
 * @example
 * ```ts
 * const loader = new WidgetLoader(registry);
 * await loader.loadManifest("/plugin-a/sct-manifest.json");
 * await loader.loadManifest("/plugin-b/sct-manifest.json");
 * // Later, unload only plugin-a:
 * loader.unloadManifest("/plugin-a/sct-manifest.json");
 * // Or tear everything down:
 * loader.dispose();
 * ```
 */
export class WidgetLoader implements IDisposable {
  /**
   * Registration handles grouped by manifest URL.
   * Each entry holds the disposables for all widgets registered from that URL.
   */
  private readonly _handlesByManifest = new Map<string, IDisposable[]>();

  /**
   * Tracks in-flight `loadManifest` calls so that concurrent requests for the
   * same URL are coalesced into a single fetch rather than racing.
   */
  private readonly _inFlight = new Map<string, Promise<void>>();

  private readonly _importFn: ImportFn;

  /**
   * @param registry The widget registry to register manifest widgets into.
   * @param importFn Optional custom import function (used in tests to avoid
   *   real dynamic imports). Defaults to the native `import()`.
   */
  constructor(
    private readonly registry: WidgetRegistry,
    importFn?: ImportFn,
  ) {
    this._importFn =
      importFn ??
      ((m: string) => import(/* @vite-ignore */ m) as Promise<Record<string, unknown>>);
  }

  /**
   * Fetch and parse an `sct-manifest.json` manifest, then register each
   * declared widget into the registry.
   *
   * - If `manifestUrl` has already been loaded successfully, this is a no-op.
   * - If a load for `manifestUrl` is already in progress, the returned promise
   *   resolves when that in-flight request completes (no duplicate fetch).
   * - Multiple distinct manifest URLs can be loaded concurrently or
   *   sequentially; they do not interfere with each other.
   *
   * Registration is immediate for metadata; the component factory is lazy —
   * the module import is deferred until the factory is first called.
   *
   * @param manifestUrl Absolute URL or path to the `sct-manifest.json` file.
   * @returns Promise that resolves when all widgets from this manifest are registered.
   * @throws Error if the manifest cannot be fetched or parsed.
   */
  async loadManifest(manifestUrl: string): Promise<void> {
    if (this._handlesByManifest.has(manifestUrl)) {
      return; // already loaded — no-op
    }

    // Coalesce concurrent calls for the same URL
    const existing = this._inFlight.get(manifestUrl);
    if (existing) {
      return existing;
    }

    const load = this._doLoad(manifestUrl);
    this._inFlight.set(manifestUrl, load);
    try {
      await load;
    } finally {
      this._inFlight.delete(manifestUrl);
    }
  }

  /** Internal implementation of the manifest fetch + registration. */
  private async _doLoad(manifestUrl: string): Promise<void> {
    let manifest: SctManifest;
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch manifest from '${manifestUrl}': ${response.status} ${response.statusText}`,
        );
      }
      manifest = (await response.json()) as SctManifest;
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(`Failed to load manifest from '${manifestUrl}': ${String(e)}`);
    }

    const handles: IDisposable[] = [];

    for (const entry of manifest.widgets) {
      if (this.registry.get(entry.name) !== undefined) {
        console.warn(
          `WidgetLoader: widget '${entry.name}' is already registered — skipping manifest entry.`,
        );
        continue;
      }

      let cachedPromise: Promise<ComponentType> | null = null;

      const definition: WidgetDefinition = {
        name: entry.name,
        description: entry.description,
        channelPattern: entry.channelPattern,
        consumes: entry.consumes,
        priority: entry.priority,
        defaultRegion: entry.defaultRegion,
        parameters: entry.parameters,
        factory: () => {
          if (!cachedPromise) {
            cachedPromise = this._importFn(entry.module)
              .then((mod) => {
                const component = mod[entry.export];
                if (typeof component !== "function") {
                  console.error(
                    `WidgetLoader: export '${entry.export}' from '${entry.module}' is not a valid React component.`,
                  );
                  return createWidgetLoadError(
                    `Widget '${entry.name}': invalid export '${entry.export}'`,
                  );
                }
                return component as ComponentType;
              })
              .catch((e: unknown) => {
                console.error(
                  `WidgetLoader: failed to load module '${entry.module}' for widget '${entry.name}'.`,
                  e,
                );
                return createWidgetLoadError(
                  `Widget '${entry.name}': failed to load module '${entry.module}'`,
                );
              });
          }
          return cachedPromise;
        },
      };

      const handle = this.registry.register(definition);
      handles.push(handle);
    }

    this._handlesByManifest.set(manifestUrl, handles);
  }

  /**
   * Unregister all widgets that were registered from a specific manifest.
   *
   * If `manifestUrl` was never loaded, this is a no-op.
   *
   * @param manifestUrl The same URL that was passed to {@link loadManifest}.
   */
  unloadManifest(manifestUrl: string): void {
    const handles = this._handlesByManifest.get(manifestUrl);
    if (!handles) return;
    for (const handle of handles) {
      handle.dispose();
    }
    this._handlesByManifest.delete(manifestUrl);
  }

  /**
   * Unregister all widgets across every loaded manifest.
   *
   * Calls `dispose()` on all registration handles. Widgets currently rendered
   * are not affected — `WidgetRegistry` guarantees stability of resolved
   * components until re-render.
   *
   * Calling `dispose()` more than once is a no-op.
   */
  dispose(): void {
    for (const manifestUrl of this._handlesByManifest.keys()) {
      this.unloadManifest(manifestUrl);
    }
  }
}
