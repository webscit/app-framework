import type { WidgetDefinition } from "./widgetRegistry";

/** Built-in widget that displays live log stream from simulation stdout/stderr. */
export const LOG_VIEWER: WidgetDefinition = {
  name: "LogViewer",
  description: "Displays live log stream from simulation stdout/stderr",
  stream: "log",
  consumes: "text/plain",
  capabilities: ["log-viewer", "scrollable", "searchable"],
  parameters: {
    maxLines: { type: "integer", default: 1000, minimum: 100, maximum: 10000 },
    showTimestamps: { type: "boolean", default: true },
    wrapLines: { type: "boolean", default: false },
  },
  component: "./src/widgets/LogViewer.tsx",
};

/** Built-in widget that displays heartbeat and run status from the control stream. */
export const STATUS_INDICATOR: WidgetDefinition = {
  name: "StatusIndicator",
  description: "Displays heartbeat and run status from control stream",
  stream: "control",
  consumes: "application/x-control+json",
  capabilities: ["status", "heartbeat", "run-status"],
  parameters: {
    label: { type: "string", default: "Simulation Status" },
    showLastSeen: { type: "boolean", default: true },
  },
  component: "./src/widgets/StatusIndicator.tsx",
};
