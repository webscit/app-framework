import React, { useState } from "react";
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
  LOG_VIEWER,
  createDefaultShellLayout,
  LayoutDiffViewer,
  AIChatPanel,
  useShellLayoutStore,
} from "@app-framework/core-ui";
import type { ShellLayout } from "@app-framework/core-ui";
import { useSimulation } from "./useSimulation";
import "./shell.css";
import "@/globals.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);
registry.register(LOG_VIEWER);

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

const demoProposed: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    "sidebar-left": {
      visible: true,
      items: [{ id: "pc-1", type: "ParameterController", props: {} }],
    },
    main: {
      visible: true,
      items: [{ id: "chart-1", type: "Chart", props: {} }],
    },
    "sidebar-right": {
      visible: true,
      items: [{ id: "log-1", type: "LogViewer", props: {} }],
    },
  },
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #555",
  background: "#1e1e1e",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const { layout, setLayout } = useShellLayoutStore();

  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws">
        <WidgetLoaderProvider>
          <AppShell />

          {/* Floating controls — hidden while AI chat panel is open to avoid z-index overlap */}
          {!chatOpen && (
            <div
              style={{
                position: "fixed",
                bottom: 16,
                right: 16,
                zIndex: 40,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
              <button style={buttonStyle} onClick={() => setChatOpen(true)}>
                AI Layout
              </button>
              <button style={buttonStyle} onClick={() => setShowDemo((v) => !v)}>
                {showDemo ? "Hide" : "Show"} LayoutDiffViewer demo
              </button>
              {showDemo && (
                <div
                  style={{
                    width: 520,
                    background: "var(--card, #fff)",
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                  }}
                >
                  <LayoutDiffViewer
                    current={initialLayout}
                    proposed={demoProposed}
                    explanation="Added a ParameterController to the left sidebar, a Chart to main, and a LogViewer to the right sidebar."
                    onApprove={() => alert("Approved!")}
                    onReject={() => setShowDemo(false)}
                  />
                </div>
              )}
            </div>
          )}

          <AIChatPanel
            open={chatOpen}
            onOpenChange={setChatOpen}
            currentLayout={layout}
            onApplyLayout={(proposed) => setLayout(() => proposed)}
            registry={registry}
            apiUrl="/ai/layout"
          />
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
