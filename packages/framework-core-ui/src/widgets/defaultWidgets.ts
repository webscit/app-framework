import type { ComponentType } from "react";

import { LogViewerComponent } from "./LogViewer/LogViewer";
import type { WidgetDefinition } from "../widgetRegistry";
import { ParameterControllerComponent } from "./ParameterController/ParameterController";
import { ChartComponent } from "./Chart/Chart";
import { DataTableComponent } from "./DataTable/DataTable";
import { StatusIndicatorComponent } from "./StatusIndicator/StatusIndicator";

/**
 * Built-in widget that displays live log entries arriving on log channels.
 *
 * Renders text/plain payloads from any channel matching `"log/*"`.
 * Defaults to the `"bottom"` layout region.
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
  defaultRegion: "bottom",
  parameters: {
    maxLines: { type: "integer", default: 1000, minimum: 100, maximum: 10000 },
    showTimestamps: { type: "boolean", default: true },
    wrapLines: { type: "boolean", default: false },
  },
  factory: () => LogViewerComponent,
};

/**
 * Built-in widget that displays heartbeat and run status from control channels.
 *
 * Renders `application/x-control+json` payloads from channels matching
 * `"control/*"`. Defaults to the `"status-bar"` layout region.
 */
export const STATUS_INDICATOR: WidgetDefinition = {
  name: "StatusIndicator",
  description:
    "Displays heartbeat and run status from the control channel. " +
    "Shows connection status, last heartbeat time, and simulation run state.",
  channelPattern: "control/*",
  consumes: ["application/x-control+json"],
  priority: 10,
  defaultRegion: "status-bar",
  parameters: {
    channel: { type: "string", default: "control/*" },
    label: { type: "string", default: "Simulation Status" },
    showLastSeen: { type: "boolean", default: true },
    staleAfterMs: { type: "integer", default: 5000, minimum: 0, maximum: 60000 },
  },
  factory: () => StatusIndicatorComponent as ComponentType,
};

/**
 * Built-in widget that renders interactive parameter controls for runtime tuning.
 *
 * Publishes user-adjusted values as `application/x-params+json` payloads to
 * `"params/control"` (configurable). Defaults to the `"sidebar-left"` layout region.
 */
export const PARAMETER_CONTROLLER: WidgetDefinition = {
  name: "ParameterController",
  description:
    "Interactive control panel for tuning simulation parameters at runtime. " +
    "Publishes parameter updates to a configurable EventBus channel as " +
    "application/x-params+json payloads.",
  channelPattern: "params/*",
  consumes: [],
  priority: 10,
  defaultRegion: "sidebar-left",
  parameters: {
    channel: { type: "string", default: "params/control" },
    debounceMs: { type: "integer", default: 300, minimum: 0, maximum: 2000 },
  },
  factory: () => ParameterControllerComponent,
};

/**
 * Built-in widget that renders a live scrolling line chart.
 *
 * Subscribes to one or more EventBus channels and plots incoming scalar
 * values in a rolling time-series window. X and Y axis labels are
 * user-configurable via widget parameters.
 */
export const CHART: WidgetDefinition = {
  name: "Chart",
  description:
    "Live time-series line chart. Subscribes to one or more EventBus channels " +
    "and plots incoming scalar values in a scrolling window.",
  channelPattern: "data/*",
  consumes: ["application/x-scalar+json"],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    title: {
      type: "string",
      default: "",
      description: "Chart title displayed above the plot.",
    },
    maxPoints: {
      type: "integer",
      default: 200,
      minimum: 10,
      maximum: 2000,
      description: "Maximum number of data points to keep per series (rolling window).",
    },
    yDomain: {
      type: "string",
      default: "auto",
      description:
        'Y-axis domain. Use "auto" for automatic fitting, or a JSON array like [-1,1] for a fixed range.',
    },
    yLabel: {
      type: "string",
      default: "",
      description: "Label shown to the left of the Y axis.",
    },
    xLabel: {
      type: "string",
      default: "Elapsed time (s)",
      description: "Label shown below the X axis.",
    },
  },
  // ChartComponent has typed props; cast to ComponentType so the registry
  // accepts it — props are injected by the widget loader at runtime.
  factory: () => ChartComponent as ComponentType,
};

/**
 * Built-in widget that displays live tabular data streamed row-by-row from
 * the EventBus, with client-side sorting, pagination, column visibility
 * toggle, and search.
 *
 * Subscribes to channels matching `"table/*"` and accumulates incoming row
 * objects into a paginated, sortable, searchable table. Suitable for solver
 * iteration logs, parameter sweeps, and results grids.
 */
export const DATA_TABLE: WidgetDefinition = {
  name: "DataTable",
  description:
    "Live tabular data viewer. Subscribes to an EventBus channel and appends " +
    "incoming row objects into a paginated, sortable, searchable table. Rows " +
    "can be severity-highlighted via statusKey. " +
    "Suitable for solver iteration logs, parameter sweeps, and results grids.",
  channelPattern: "table/*",
  consumes: ["application/x-tabular+json"],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    title: {
      type: "string",
      default: "",
      description: "Title displayed above the toolbar.",
    },
    pageSize: {
      type: "integer",
      default: 20,
      minimum: 5,
      maximum: 100,
      description: "Number of rows shown per page.",
    },
    maxRows: {
      type: "integer",
      default: 1000,
      minimum: 100,
      maximum: 10000,
      description: "Maximum rows retained in the rolling buffer.",
    },
    statusKey: {
      type: "string",
      default: "",
      description:
        "Row field whose value classifies severity for per-row highlighting " +
        '(e.g. "status"). Pair with statusVariants in the layout JSON to map ' +
        "raw values to error/warning/success/info styles.",
    },
  },
  factory: () => DataTableComponent as ComponentType,
};
