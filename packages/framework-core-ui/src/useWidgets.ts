import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./EventBusContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Resolves widgets for an incoming message using channel-first then mimeType
 * refinement. Re-renders whenever the registry changes.
 *
 * Resolution order:
 * 1. Channel match — widgets whose `channelPattern` glob matches `channel`.
 * 2. mimeType refinement — if `mimeType` is provided, further filter to widgets
 *    whose `consumes` list includes it.
 * 3. Sort by `priority` descending.
 *
 * @param channel Concrete EventBus channel, e.g. `"log/app"`.
 * @param mimeType Optional MIME type from message headers, e.g. `"text/plain"`.
 * @returns Resolved, sorted array of matching {@link WidgetDefinition} objects.
 */
export function useWidgets(channel: string, mimeType?: string): WidgetDefinition[] {
  const registry = useWidgetRegistryInstance();
  const [widgets, setWidgets] = useState<WidgetDefinition[]>(() =>
    registry.resolveWidgets(channel, mimeType),
  );

  useEffect(() => {
    setWidgets(registry.resolveWidgets(channel, mimeType));
    const handle = registry.onChange(() => {
      setWidgets(registry.resolveWidgets(channel, mimeType));
    });
    return () => handle.dispose();
  }, [registry, channel, mimeType]);

  return widgets;
}
