import { createContext, useContext } from "react";

import type { WidgetRegistry } from "./widgetRegistry";

export const WidgetRegistryContext = createContext<WidgetRegistry | null>(null);

export function useWidgetRegistryInstance(): WidgetRegistry {
  const registry = useContext(WidgetRegistryContext);
  if (!registry) {
    throw new Error(
      "Widget hooks must be used inside a WidgetRegistryContext.Provider.",
    );
  }
  return registry;
}
