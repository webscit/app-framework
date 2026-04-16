import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./EventBusContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Returns a live list of all widgets currently in the registry.
 *
 * Re-renders whenever the registry changes (widget registered or unregistered).
 *
 * @returns Array of all registered {@link WidgetDefinition} objects.
 * @example
 * ```tsx
 * const widgets = useWidgetRegistry();
 * return <ul>{widgets.map(w => <li key={w.name}>{w.name}</li>)}</ul>;
 * ```
 */
export function useWidgetRegistry(): WidgetDefinition[] {
  const registry = useWidgetRegistryInstance();
  const [widgets, setWidgets] = useState<WidgetDefinition[]>(() => registry.list());

  useEffect(() => {
    return registry.onChange(() => {
      setWidgets(registry.list());
    });
  }, [registry]);

  return widgets;
}
