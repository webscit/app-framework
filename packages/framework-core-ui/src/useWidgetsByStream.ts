import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./EventBusContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Returns all widgets registered for the given *stream* type.
 *
 * Re-renders whenever the registry changes (widget registered or unregistered).
 *
 * @param stream Stream type to filter by (e.g. `"log"`, `"control"`, `"data"`).
 * @returns Filtered array of {@link WidgetDefinition} objects.
 * @example
 * ```tsx
 * const logWidgets = useWidgetsByStream("log");
 * return <ul>{logWidgets.map(w => <li key={w.name}>{w.name}</li>)}</ul>;
 * ```
 */
export function useWidgetsByStream(stream: string): WidgetDefinition[] {
  const registry = useWidgetRegistryInstance();
  const [widgets, setWidgets] = useState<WidgetDefinition[]>(() =>
    registry.findByStream(stream),
  );

  useEffect(() => {
    return registry.onChange(() => {
      setWidgets(registry.findByStream(stream));
    });
  }, [registry, stream]);

  return widgets;
}
