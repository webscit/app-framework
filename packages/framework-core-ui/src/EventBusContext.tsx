import { createContext, useContext, useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";

import { RealtimeEventBusClient, type WebSocketFactory } from "./client";
import { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";
import { WidgetRegistry } from "./widgetRegistry";

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
 * The widget registry is frontend-only — it is pre-populated with the
 * built-in {@link LOG_VIEWER} and {@link STATUS_INDICATOR} defaults.
 * Applications register additional widgets by calling
 * `registry.register(definition)` on the instance returned by
 * {@link useWidgetRegistryInstance}.
 *
 * @param props Provider configuration and children.
 * @param props.path WebSocket endpoint path.
 * @param props.reconnectDelayMs Reconnect delay in milliseconds.
 * @param props.webSocketFactory Optional websocket factory for tests.
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
