import { useEffect, useState } from "react";

import { useWidgetLoaderInstance } from "./WidgetLoaderContext";

/**
 * Represents the loading state of a widget manifest.
 *
 * - `"loading"` — the manifest fetch is in progress.
 * - `"ready"` — the manifest was loaded and widgets are registered.
 * - `"error"` — the manifest fetch or registration failed.
 */
export type WidgetLoaderStatus = "loading" | "ready" | "error";

/**
 * Load a widget manifest into the shared registry and keep it registered
 * for the lifetime of the calling component.
 *
 * Uses the shared {@link WidgetLoader} instance from the nearest
 * {@link WidgetLoaderProvider}, so multiple calls across sibling components
 * (e.g. one per installed plugin) share a single loader and registry — there
 * is no risk of duplicate registrations or redundant fetches for the same URL.
 *
 * When the component unmounts, the manifest is unloaded via
 * `loader.unloadManifest(manifestUrl)`, leaving any other loaded manifests
 * untouched.
 *
 * **Note on manifest URL serving:** For now, consumers hardcode the manifest
 * URL (e.g. `useWidgetLoader("/sct-manifest.json")`). Serving manifest files
 * from the backend — so that installed plugins can register themselves at a
 * well-known URL — is a follow-up task. The URL parameter is intentionally
 * left open to support this pattern without API changes.
 *
 * @param manifestUrl URL of the `sct-manifest.json` manifest to load.
 * @returns Loading state — see {@link WidgetLoaderStatus}.
 * @example
 * ```tsx
 * // Each plugin mounts its own loader; they share the underlying registry.
 * function PluginA() {
 *   const status = useWidgetLoader("/plugin-a/sct-manifest.json");
 *   if (status === "loading") return <Spinner />;
 *   return <ApplicationShell />;
 * }
 *
 * function PluginB() {
 *   const status = useWidgetLoader("/plugin-b/sct-manifest.json");
 *   if (status === "loading") return <Spinner />;
 *   return <ApplicationShell />;
 * }
 * ```
 */
export function useWidgetLoader(manifestUrl: string): WidgetLoaderStatus {
  const loader = useWidgetLoaderInstance();
  const [status, setStatus] = useState<WidgetLoaderStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    loader.loadManifest(manifestUrl).then(
      () => {
        if (!cancelled) setStatus("ready");
      },
      () => {
        if (!cancelled) setStatus("error");
      },
    );

    return () => {
      cancelled = true;
      loader.unloadManifest(manifestUrl);
    };
  }, [loader, manifestUrl]);

  return status;
}
