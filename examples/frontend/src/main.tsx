import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ApplicationShell,
  applyNonTogglableCorrection,
  EventBusProvider,
  WidgetRegistry,
  WidgetRegistryContext,
  WidgetLoaderProvider,
  useWidgetLoader,
  PARAMETER_CONTROLLER,
  CHART,
  LOG_VIEWER,
  DATA_TABLE,
  createDefaultShellLayout,
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

interface DashboardProps {
  onOpenChat: () => void;
}

function Dashboard({ onOpenChat }: DashboardProps) {
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
      <button
        style={{ ...buttonStyle, marginLeft: "auto" }}
        onClick={onOpenChat}
        aria-label="Open AI layout chat"
      >
        AI Layout
      </button>
    </div>
  );
}

interface AppShellProps {
  onOpenChat: () => void;
}

function AppShell({ onOpenChat }: AppShellProps) {
  const loaderStatus = useWidgetLoader("/sct-manifest.json");

  if (loaderStatus === "loading") return <p>Loading widgets…</p>;
  if (loaderStatus === "error") return <p>Failed to load widget manifest.</p>;

  return (
    <div
      data-testid="shell-layout"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <Dashboard onOpenChat={onOpenChat} />
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ApplicationShell initialLayout={initialLayout} />
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #555",
  background: "#1e1e1e",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const expandTabStyle: React.CSSProperties = {
  position: "fixed",
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  padding: "14px 6px",
  background: "#1e1e1e",
  color: "#fff",
  border: "1px solid #555",
  borderRight: "none",
  borderRadius: "6px 0 0 6px",
  cursor: "pointer",
  writingMode: "vertical-rl",
  fontSize: 12,
  letterSpacing: "0.06em",
  zIndex: 40,
};

function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const { layout, setLayout } = useShellLayoutStore();

  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws">
        <WidgetLoaderProvider>
          <AppShell onOpenChat={() => setChatOpen((v) => !v)} />

          {/* Right-edge tab — stays visible when the panel is collapsed so the
              user can expand it again without navigating back to the Dashboard bar */}
          {!chatOpen && (
            <button
              style={expandTabStyle}
              onClick={() => setChatOpen(true)}
              aria-label="Open AI layout chat"
            >
              AI Layout
            </button>
          )}

          <AIChatPanel
            open={chatOpen}
            onOpenChange={setChatOpen}
            currentLayout={layout}
            onApplyLayout={(proposed) =>
              setLayout(() => applyNonTogglableCorrection(proposed))
            }
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
