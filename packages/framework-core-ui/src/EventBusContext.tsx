import { createContext, useContext, useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";

import { RealtimeEventBusClient, type WebSocketFactory } from "./client";
import { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";
import { type WidgetDefinition, WidgetRegistry } from "./widgetRegistry";

const EventBusContext = createContext<RealtimeEventBusClient | null>(null);
const WidgetRegistryContext = createContext<WidgetRegistry | null>(null);

/**
 * Props for {@link EventBusProvider}.
 */
export interface EventBusProviderProps extends PropsWithChildren {
  /** Backend WebSocket path (for example, `/ws`). */
  path: string;
  /** Reconnect delay in milliseconds for socket reconnect attempts. */
  reconnectDelayMs?: number;
  /** Optional custom factory, useful for tests. */
  webSocketFactory?: WebSocketFactory;
  /** Optional custom fetch function, useful for tests. */
  fetchFn?: typeof fetch;
}

interface LocationLike {
  protocol: string;
  host: string;
}

/**
 * Builds a full websocket URL from a path and browser location-like object.
 *
 * @param path WebSocket endpoint path.
 * @param locationLike Current location containing protocol and host.
 * @returns Absolute `ws://` or `wss://` URL for the websocket connection.
 * @example
 * ```ts
 * const url = buildWebSocketUrl("/ws", window.location);
 * // ws://localhost:5173/ws
 * ```
 */
export function buildWebSocketUrl(path: string, locationLike: LocationLike): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const scheme = locationLike.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${locationLike.host}${normalizedPath}`;
}

/**
 * Provides a shared realtime event bus client and widget registry to
 * descendant hooks/components.
 *
 * On WebSocket connect the provider fetches ``GET /api/widgets`` and
 * hydrates the local registry with any widgets not already registered,
 * keeping the frontend catalog in sync with the server.
 *
 * @param props Provider configuration and children.
 * @param props.path WebSocket endpoint path.
 * @param props.reconnectDelayMs Reconnect delay in milliseconds.
 * @param props.webSocketFactory Optional websocket factory for tests.
 * @param props.fetchFn Optional fetch function override for tests.
 * @param props.children Child React nodes.
 * @returns A context provider wrapping the children.
 * @example
 * ```tsx
 * <EventBusProvider path="/ws">
 *   <Dashboard />
 * </EventBusProvider>
 * ```
 */
export function EventBusProvider({
  path,
  reconnectDelayMs,
  webSocketFactory,
  fetchFn,
  children,
}: EventBusProviderProps): JSX.Element {
  const client = useMemo(() => {
    if (typeof window === "undefined") {
      throw new Error("EventBusProvider requires a browser environment.");
    }

    const url = buildWebSocketUrl(path, window.location);
    return new RealtimeEventBusClient(url, { reconnectDelayMs, webSocketFactory });
  }, [path, reconnectDelayMs, webSocketFactory]);

  const registry = useMemo(() => {
    const reg = new WidgetRegistry();
    reg.register(LOG_VIEWER);
    reg.register(STATUS_INDICATOR);
    return reg;
  }, []);

  useEffect(() => {
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    const doFetch = fetchFn ?? fetch;
    return client.onStatusChange((status) => {
      if (status !== "connected") {
        return;
      }
      const base = `${window.location.protocol}//${window.location.host}`;
      doFetch(`${base}/api/widgets`)
        .then((r) => r.json() as Promise<WidgetDefinition[]>)
        .then((widgets) => {
          for (const widget of widgets) {
            if (!registry.get(widget.name)) {
              registry.register(widget);
            }
          }
        })
        .catch(() => {
          // Silently ignore hydration errors — defaults are already registered.
        });
    });
  }, [client, registry, fetchFn]);

  return (
    <EventBusContext.Provider value={client}>
      <WidgetRegistryContext.Provider value={registry}>
        {children}
      </WidgetRegistryContext.Provider>
    </EventBusContext.Provider>
  );
}

/**
 * Returns the current realtime event bus client from context.
 *
 * @returns Shared {@link RealtimeEventBusClient} instance.
 * @throws Error If used outside {@link EventBusProvider}.
 * @example
 * ```ts
 * const client = useEventBusClient();
 * const status = client.getStatus();
 * ```
 */
export function useEventBusClient(): RealtimeEventBusClient {
  const client = useContext(EventBusContext);
  if (!client) {
    throw new Error("EventBus hooks must be used inside EventBusProvider.");
  }
  return client;
}

/**
 * Returns the shared {@link WidgetRegistry} instance from context.
 *
 * @returns Shared registry instance.
 * @throws Error If used outside {@link EventBusProvider}.
 */
export function useWidgetRegistryInstance(): WidgetRegistry {
  const registry = useContext(WidgetRegistryContext);
  if (!registry) {
    throw new Error("Widget hooks must be used inside EventBusProvider.");
  }
  return registry;
}
