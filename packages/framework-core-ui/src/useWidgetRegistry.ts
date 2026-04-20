import { useEffect, useState } from "react";

import { useWidgetRegistryInstance } from "./WidgetRegistryContext";
import type { WidgetDefinition } from "./widgetRegistry";

/**
 * Returns a live list of all widgets currently in the registry.
 *
 * Re-renders whenever the registry changes (widget added or disposed).
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
    const handle = registry.onChange(() => {
      setWidgets(registry.list());
    });
    return () => handle.dispose();
  }, [registry]);

  return widgets;
}
