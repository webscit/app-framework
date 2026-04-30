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
export { WidgetLoaderProvider } from "./WidgetLoaderContext";
export { useChannel, toPayloadWithHeaders } from "./useChannel";
export { usePublish } from "./usePublish";
export { useEventBusStatus } from "./useEventBusStatus";
export { useWidgetRegistry } from "./useWidgetRegistry";
export { useWidgets } from "./useWidgets";
export {
  LOG_VIEWER,
  STATUS_INDICATOR,
  PARAMETER_CONTROLLER,
  CHART,
} from "./defaultWidgets";
export {
  ParameterControllerComponent,
  type ParameterControllerProps,
  type ParameterConfig,
  type ParameterType,
  type ParameterWidget,
} from "./ParameterController";
export { ChartComponent, getFieldValue } from "./Chart";
export type { ChartProps, SeriesConfig } from "./Chart";
export type { IDisposable } from "./disposable";
export {
  type WidgetDefinition,
  type ComponentOptions,
  type WidgetChangeEvent,
  type ChangeListener,
  WidgetRegistry,
} from "./widgetRegistry";
export { WidgetLoader, type SctManifest, type SctWidgetEntry } from "./widgetLoader";
export { useWidgetLoader } from "./useWidgetLoader";
export {
  ApplicationShell,
  type ApplicationShellProps,
  type ShellClassNames,
} from "./ApplicationShell";
export {
  useShellLayoutStore,
  clearPersistedLayout,
  type ShellLayoutStore,
} from "./stores/shellStore";
export {
  createDefaultShellLayout,
  SHELL_LAYOUT_STORAGE_VERSION,
  type RegionId,
  type RegionItem,
  type RegionSetter,
  type RegionState,
  type ShellLayout,
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
