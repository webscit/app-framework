import React from "react";
import ReactDOM from "react-dom/client";
import {
  ApplicationShell,
  AppRoot,
  WidgetRegistry,
  PARAMETER_CONTROLLER,
  CHART,
  LOG_VIEWER,
  DATA_TABLE,
  createDefaultShellLayout,
} from "@app-framework/core-ui";
import type { ShellLayout } from "@app-framework/core-ui";
import "./shell.css";
import "@/globals.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);
registry.register(LOG_VIEWER);
registry.register(DATA_TABLE);

const initialLayout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    main: {
      visible: true,
      items: [
        {
          id: "sine-chart",
          type: "Chart",
          props: {
            title: "Sine Wave",
            maxPoints: 300,
            yDomain: [-2.1, 2.1],
            yLabel: "Amplitude",
            xLabel: "Elapsed time (s)",
            series: [
              {
                channel: "data/sine",
                field: "value",
                label: "sin(t)",
                color: "var(--chart-1)",
              },
            ],
          },
          order: 0,
        },
        {
          id: "results-table",
          type: "DataTable",
          props: {
            channel: "table/results",
            title: "Solver Results",
            pageSize: 20,
            maxRows: 500,
            columns: [
              { key: "step", header: "Step", type: "number" },
              { key: "time_s", header: "Time (s)", type: "number" },
              { key: "residual", header: "Residual", type: "number" },
              { key: "status", header: "Status", type: "string" },
            ],
          },
          order: 1,
        },
      ],
    },
    "sidebar-left": {
      visible: true,
      items: [
        {
          id: "sim-params",
          type: "ParameterController",
          props: {
            channel: "params/control",
            debounceMs: 300,
            parameters: {
              frequency: {
                title: "Frequency (Hz)",
                type: "number",
                minimum: 0.1,
                maximum: 10.0,
                multipleOf: 0.1,
                default: 1.0,
                "x-options": { widget: "slider" },
              },
              amplitude: {
                title: "Amplitude",
                type: "number",
                minimum: 0.1,
                maximum: 2.0,
                multipleOf: 0.1,
                default: 1.0,
                "x-options": { widget: "slider" },
              },
              time_step: {
                title: "Time Step",
                type: "number",
                minimum: 0.01,
                maximum: 0.5,
                multipleOf: 0.01,
                default: 0.1,
                "x-options": { widget: "slider" },
              },
            },
          },
          order: 0,
        },
      ],
    },
  },
};

/**
 * The whole app: providers via {@link AppRoot}, and an {@link ApplicationShell}
 * that loads the widget manifest and hosts the layout-only AI assistant. All
 * widgets live in the shell so the AI can rearrange them.
 */
function App() {
  return (
    <AppRoot registry={registry} webSocketPath="/ws">
      <ApplicationShell
        initialLayout={initialLayout}
        manifestUrl="/sct-manifest.json"
        ai={{ apiUrl: "/ai/layout" }}
      />
    </AppRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
