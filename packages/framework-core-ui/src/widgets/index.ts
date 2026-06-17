export { ChartComponent, getFieldValue } from "./Chart";
export type { ChartProps, SeriesConfig } from "./Chart";

export { LogViewerComponent } from "./LogViewer";

export {
  ParameterControllerComponent,
  type ParameterControllerProps,
  type ParameterConfig,
  type ParameterType,
  type ParameterWidget,
} from "./ParameterController";

export { DataTableComponent } from "./DataTable";
export type { DataTableProps, ColumnDef } from "./DataTable";

export { StatusIndicatorComponent } from "./StatusIndicator";
export type { StatusIndicatorProps, SimulationStatus } from "./StatusIndicator";

export {
  LOG_VIEWER,
  STATUS_INDICATOR,
  PARAMETER_CONTROLLER,
  CHART,
  DATA_TABLE,
} from "./defaultWidgets";
