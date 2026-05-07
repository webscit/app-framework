import React from "react";
import ReactDOM from "react-dom/client";
import {
  ApplicationShell,
  EventBusProvider,
  WidgetRegistry,
  WidgetRegistryContext,
  WidgetLoaderProvider,
  useWidgetLoader,
  PARAMETER_CONTROLLER,
  CHART,
  createDefaultShellLayout,
} from "@app-framework/core-ui";
import type { ShellLayout } from "@app-framework/core-ui";
import { useSimulation } from "./useSimulation";
import "./shell.css";
import "@/globals.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);

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

function Dashboard() {
  const { sine, log } = useSimulation();

  return (
    <div
      data-testid="dashboard"
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid #333",
        fontFamily: "monospace",
        fontSize: 13,
        display: "flex",
        gap: 32,
        alignItems: "center",
      }}
    >
      <strong>Simulation Dashboard</strong>
      <span>
        Sine: <span data-testid="sine-value">{sine ? sine.value.toFixed(4) : "—"}</span>
      </span>
      <span>
        Last log:{" "}
        <span data-testid="last-log">
          {log ? `[${log.level}] ${log.message}` : "—"}
        </span>
      </span>
    </div>
  );
}

function AppShell() {
  const loaderStatus = useWidgetLoader("/sct-manifest.json");

  if (loaderStatus === "loading") return <p>Loading widgets…</p>;
  if (loaderStatus === "error") return <p>Failed to load widget manifest.</p>;

  return (
    <div
      data-testid="shell-layout"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <Dashboard />
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ApplicationShell initialLayout={initialLayout} />
      </div>
    </div>
  );
}

function App() {
  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws">
        <WidgetLoaderProvider>
          <AppShell />
        </WidgetLoaderProvider>
      </EventBusProvider>
    </WidgetRegistryContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
