import { createContext, useContext } from "react";

import type { WidgetRegistry } from "./widgetRegistry";

export const WidgetRegistryContext = createContext<WidgetRegistry | null>(null);

/**
 * Returns the {@link WidgetRegistry} instance from the nearest
 * `WidgetRegistryContext.Provider`.
 *
 * @returns Shared {@link WidgetRegistry} instance.
 * @throws Error if called outside of a `WidgetRegistryContext.Provider`.
 */
export function useWidgetRegistryInstance(): WidgetRegistry {
  const registry = useContext(WidgetRegistryContext);
  if (!registry) {
    throw new Error(
      "Widget hooks must be used inside a WidgetRegistryContext.Provider.",
    );
  }
  return registry;
}
