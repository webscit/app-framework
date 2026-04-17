import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./EventBusContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Returns all widgets whose `channelPattern` glob matches the given concrete
 * *channel*, sorted by `priority` descending.
 *
 * Re-renders whenever the registry changes (widget added or disposed).
 *
 * Use {@link useWidgetsByMime} when you have a MIME type available — MIME
 * matching is the primary (most specific) resolution layer.
 *
 * @param channel Concrete EventBus channel, e.g. `"log/app"`.
 * @returns Filtered, sorted array of matching {@link WidgetDefinition} objects.
 * @example
 * ```tsx
 * const widgets = useWidgetsByChannel("log/app");
 * return <ul>{widgets.map(w => <li key={w.name}>{w.name}</li>)}</ul>;
 * ```
 */
export function useWidgetsByChannel(channel: string): WidgetDefinition[] {
  const registry = useWidgetRegistryInstance();
  const [widgets, setWidgets] = useState<WidgetDefinition[]>(() =>
    registry.findByChannel(channel),
  );

  useEffect(() => {
    const handle = registry.onChange(() => {
      setWidgets(registry.findByChannel(channel));
    });
    return () => handle.dispose();
  }, [registry, channel]);

  return widgets;
}
