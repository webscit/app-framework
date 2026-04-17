import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./EventBusContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Returns all widgets whose `consumes` list includes *mimeType*, sorted by
 * `priority` descending.
 *
 * Re-renders whenever the registry changes (widget added or disposed).
 *
 * MIME matching is the primary resolution layer — prefer this hook over
 * {@link useWidgetsByChannel} when a `mimeType` is available in the message
 * headers.
 *
 * @param mimeType MIME type to match, e.g. `"text/plain"`.
 * @returns Filtered, sorted array of matching {@link WidgetDefinition} objects.
 * @example
 * ```tsx
 * const widgets = useWidgetsByMime("text/plain");
 * return <ul>{widgets.map(w => <li key={w.name}>{w.name}</li>)}</ul>;
 * ```
 */
export function useWidgetsByMime(mimeType: string): WidgetDefinition[] {
  const registry = useWidgetRegistryInstance();
  const [widgets, setWidgets] = useState<WidgetDefinition[]>(() =>
    registry.findByMime(mimeType),
  );

  useEffect(() => {
    const handle = registry.onChange(() => {
      setWidgets(registry.findByMime(mimeType));
    });
    return () => handle.dispose();
  }, [registry, mimeType]);

  return widgets;
}
