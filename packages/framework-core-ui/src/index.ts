export {
  EventBusProvider,
  buildWebSocketUrl,
  useEventBusClient,
  type EventBusProviderProps,
} from "./EventBusContext";
export {
  WidgetRegistryContext,
  useWidgetRegistryInstance,
} from "./WidgetRegistryContext";
export { useChannel, toPayloadWithHeaders } from "./useChannel";
export { usePublish } from "./usePublish";
export { useEventBusStatus } from "./useEventBusStatus";
export { useWidgetRegistry } from "./useWidgetRegistry";
export { useWidgets } from "./useWidgets";
export { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";
export type { IDisposable } from "./disposable";
export {
  type WidgetDefinition,
  type ComponentOptions,
  type WidgetChangeEvent,
  type ChangeListener,
  WidgetRegistry,
} from "./widgetRegistry";
export {
  ApplicationShell,
  ShellLayoutContext,
  type ApplicationShellProps,
  type ShellClassNames,
} from "./ApplicationShell";
export { useShellLayout } from "./useShellLayout";
export {
  createDefaultShellLayout,
  type RegionId,
  type RegionItem,
  type RegionSetter,
  type RegionState,
  type ShellLayout,
  type ShellLayoutContextValue,
} from "./shellTypes";
export type {
  ConnectionStatus,
  EventHeaders,
  WireEvent,
  WebSocketFactory,
} from "./client";

/**
 * Base interface for all event payloads returned by {@link useChannel}.
 *
 * Consumer interfaces should extend this so that ``message_id`` and
 * ``timestamp`` are typed at the call site:
 *
 * ```ts
 * interface TemperatureReading extends BaseEvent {
 *   value: number;
 *   unit: string;
 * }
 * ```
 *
 * These fields are merged from the wire envelope's ``headers`` by
 * {@link toPayloadWithHeaders} inside {@link useChannel}.
 */
export interface BaseEvent {
  message_id: string;
  /** Milliseconds since Unix epoch. */
  timestamp: number;
}
