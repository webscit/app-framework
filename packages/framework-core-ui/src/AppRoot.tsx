import type { ReactNode } from "react";

import { EventBusProvider } from "./EventBusContext";
import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetLoaderProvider } from "./WidgetLoaderContext";
import type { WidgetRegistry } from "./widgetRegistry";
import type { WebSocketFactory } from "./client";

/**
 * Props for {@link AppRoot}.
 */
export interface AppRootProps {
  /** Widget registry shared with the shell and the AI assistant. */
  registry: WidgetRegistry;
  /** Backend WebSocket path. Defaults to `"/ws"`. */
  webSocketPath?: string;
  /** Reconnect delay in milliseconds, forwarded to the EventBus client. */
  reconnectDelayMs?: number;
  /** Optional WebSocket factory — used in tests to inject a fake socket. */
  webSocketFactory?: WebSocketFactory;
  /** Application content, rendered inside all framework providers. */
  children: ReactNode;
}

/**
 * Top-level provider wrapper for a framework app.
 *
 * Bundles the three context providers every app needs — the widget registry,
 * the {@link EventBusProvider}, and the {@link WidgetLoaderProvider} — into a
 * single component so consumers don't repeat the nesting boilerplate. Render
 * an {@link ApplicationShell} (and any EventBus-dependent app chrome) as its
 * children.
 *
 * @param props - {@link AppRootProps}
 * @returns The children wrapped in the framework's context providers.
 * @example
 * ```tsx
 * <AppRoot registry={registry} webSocketPath="/ws">
 *   <ApplicationShell initialLayout={layout} manifestUrl="/sct-manifest.json" />
 * </AppRoot>
 * ```
 */
export function AppRoot({
  registry,
  webSocketPath = "/ws",
  reconnectDelayMs,
  webSocketFactory,
  children,
}: AppRootProps): React.ReactElement {
  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider
        path={webSocketPath}
        reconnectDelayMs={reconnectDelayMs}
        webSocketFactory={webSocketFactory}
      >
        <WidgetLoaderProvider>{children}</WidgetLoaderProvider>
      </EventBusProvider>
    </WidgetRegistryContext.Provider>
  );
}
