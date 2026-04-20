import type { ComponentType } from "react";

import type { WidgetDefinition } from "./widgetRegistry";

// Placeholder components — real implementations live in the application layer.
const LogViewerPlaceholder: ComponentType = () => null;
const StatusIndicatorPlaceholder: ComponentType = () => null;

/**
 * Built-in widget that displays live log entries arriving on log channels.
 *
 * Renders text/plain payloads from any channel matching `"log/*"`.
 */
export const LOG_VIEWER: WidgetDefinition = {
  name: "LogViewer",
  description:
    "Displays live log stream from simulation stdout/stderr. " +
    "Suitable for real-time monitoring of text-based output with a " +
    "scrollable, searchable interface.",
  channelPattern: "log/*",
  consumes: ["text/plain"],
  priority: 10,
  parameters: {
    maxLines: { type: "integer", default: 1000, minimum: 100, maximum: 10000 },
    showTimestamps: { type: "boolean", default: true },
    wrapLines: { type: "boolean", default: false },
  },
  factory: () => LogViewerPlaceholder,
};

/**
 * Built-in widget that displays heartbeat and run status from control channels.
 *
 * Renders `application/x-control+json` payloads from channels matching
 * `"control/*"`.
 */
export const STATUS_INDICATOR: WidgetDefinition = {
  name: "StatusIndicator",
  description:
    "Displays heartbeat and run status from the control channel. " +
    "Shows connection status, last heartbeat time, and simulation run state.",
  channelPattern: "control/*",
  consumes: ["application/x-control+json"],
  priority: 10,
  parameters: {
    label: { type: "string", default: "Simulation Status" },
    showLastSeen: { type: "boolean", default: true },
  },
  factory: () => StatusIndicatorPlaceholder,
};
