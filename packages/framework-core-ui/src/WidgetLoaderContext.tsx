import { createContext, createElement, useContext, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";

import { useWidgetRegistryInstance } from "./WidgetRegistryContext";
import { WidgetLoader } from "./widgetLoader";

const WidgetLoaderContext = createContext<WidgetLoader | null>(null);

/**
 * Props for {@link WidgetLoaderProvider}.
 */
export interface WidgetLoaderProviderProps {
  children: ReactNode;
}

/**
 * Provides a single shared {@link WidgetLoader} instance to the React subtree.
 *
 * Must be rendered inside a `WidgetRegistryProvider` so that
 * `useWidgetRegistryInstance` can resolve the registry.
 *
 * The loader instance is stable for the lifetime of this provider — it is only
 * recreated if the registry instance changes. This means all
 * `useWidgetLoader` calls within the subtree share the same loader and
 * therefore the same set of registered widgets, which avoids duplicate
 * registrations across sibling components loading different manifests.
 *
 * @example
 * ```tsx
 * <WidgetRegistryProvider>
 *   <WidgetLoaderProvider>
 *     <App />
 *   </WidgetLoaderProvider>
 * </WidgetRegistryProvider>
 * ```
 */
export const WidgetLoaderProvider: ComponentType<WidgetLoaderProviderProps> = ({
  children,
}) => {
  const registry = useWidgetRegistryInstance();
  const loader = useMemo(() => new WidgetLoader(registry), [registry]);
  return createElement(WidgetLoaderContext.Provider, { value: loader }, children);
};

/**
 * Returns the shared {@link WidgetLoader} instance from the nearest
 * {@link WidgetLoaderProvider}.
 *
 * @throws Error if called outside of a `WidgetLoaderProvider`.
 */
export function useWidgetLoaderInstance(): WidgetLoader {
  const loader = useContext(WidgetLoaderContext);
  if (!loader) {
    throw new Error(
      "useWidgetLoaderInstance must be used within a WidgetLoaderProvider",
    );
  }
  return loader;
}
