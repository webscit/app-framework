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
  ParameterControllerComponent,
  PARAMETER_CONTROLLER,
  CHART,
  LOG_VIEWER,
  DATA_TABLE,
  createDefaultShellLayout,
  AIChatPanel,
  useShellLayoutStore,
} from "@app-framework/core-ui";
import type { ParameterConfig, ShellLayout } from "@app-framework/core-ui";
import { useReachy } from "./useReachy";
import "./shell.css";
import "@/globals.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);
registry.register(LOG_VIEWER);
registry.register(DATA_TABLE);

/**
 * Choreography parameter sliders. Rendered directly in the fixed left column
 * (not in the resizable shell sidebar) so the controls and their labels are
 * always visible at a readable width. Publishes to ``reachy/control``.
 */
const CHOREOGRAPHY_PARAMETERS: Record<string, ParameterConfig> = {
  roll_amplitude_deg: {
    title: "Roll Amplitude (°)",
    type: "number",
    minimum: 0,
    maximum: 60,
    multipleOf: 1,
    default: 42,
    "x-options": { widget: "slider" },
  },
  z_amplitude_mm: {
    title: "Z Amplitude (mm)",
    type: "number",
    minimum: 0,
    maximum: 50,
    multipleOf: 1,
    default: 36,
    "x-options": { widget: "slider" },
  },
  step_duration_s: {
    title: "Step Duration (s)",
    type: "number",
    minimum: 0.1,
    maximum: 2.0,
    multipleOf: 0.05,
    default: 0.25,
    "x-options": { widget: "slider" },
  },
  antenna_amplitude: {
    title: "Antenna Amplitude",
    type: "number",
    minimum: 0,
    maximum: 0.6,
    multipleOf: 0.05,
    default: 0.6,
    "x-options": { widget: "slider" },
  },
  num_loops: {
    title: "Loops",
    type: "number",
    minimum: 1,
    maximum: 10,
    multipleOf: 1,
    default: 2,
    "x-options": { widget: "input" },
  },
};

const initialLayout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    main: {
      visible: true,
      items: [
        {
          id: "telemetry-chart",
          type: "Chart",
          props: {
            title: "Head Pose",
            maxPoints: 200,
            yLabel: "Degrees / mm",
            xLabel: "Elapsed time (s)",
            series: [
              {
                channel: "reachy/telemetry",
                field: "roll_deg",
                label: "Roll (°)",
                color: "var(--chart-1)",
              },
              {
                channel: "reachy/telemetry",
                field: "z_mm",
                label: "Z (mm)",
                color: "var(--chart-2)",
              },
            ],
          },
          order: 0,
        },
        {
          id: "safety-table",
          type: "DataTable",
          props: {
            channel: "reachy/safety",
            title: "Safety Assessment",
            pageSize: 10,
            maxRows: 200,
            columns: [
              { key: "loop", header: "Loop", type: "number" },
              { key: "step", header: "Step", type: "number" },
              { key: "status", header: "Status", type: "string" },
              { key: "roll_margin_deg", header: "Roll Margin (°)", type: "number" },
              { key: "z_margin_mm", header: "Z Margin (mm)", type: "number" },
              {
                key: "duration_margin_s",
                header: "Duration Margin (s)",
                type: "number",
              },
            ],
          },
          order: 1,
        },
      ],
    },
    // Params live in the fixed left column (see LeftColumn), not the resizable
    // shell sidebar — so they stay visible at a readable width.
    "sidebar-left": {
      visible: false,
      items: [],
    },
    bottom: {
      visible: true,
      items: [
        {
          id: "reachy-log",
          type: "LogViewer",
          props: {
            channel: "reachy/log",
            maxLines: 500,
            showTimestamps: true,
          },
          order: 0,
        },
      ],
    },
  },
};

// ─── Run status bar ───────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  warning: "Warning",
  violation: "Violation",
  done: "Done",
};

interface DashboardProps {
  onOpenChat: () => void;
  state: ReturnType<typeof useReachy>["state"];
  log: ReturnType<typeof useReachy>["log"];
  publishControl: ReturnType<typeof useReachy>["publishControl"];
}

function Dashboard({ onOpenChat, state, log, publishControl }: DashboardProps) {
  const phase = state?.phase ?? "idle";
  const verdict = state?.verdict;

  return (
    <div
      data-testid="dashboard"
      style={{
        padding: "12px 16px",
        background: "var(--muted)",
        color: "var(--foreground)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "monospace",
        fontSize: 13,
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <strong>Reachy Mini — Safety Validator</strong>

      <span data-testid="run-phase" style={{ color: phaseColor(phase) }}>
        {PHASE_LABELS[phase] ?? phase}
        {verdict ? ` (${verdict})` : ""}
      </span>

      <span
        style={{
          flex: "1 1 240px",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Last log:{" "}
        <span data-testid="last-log">
          {log ? `[${log.level}] ${log.message}` : "—"}
        </span>
      </span>

      <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
        <button
          style={buttonStyle}
          onClick={() => publishControl({ preset: "safe" })}
          aria-label="Apply safe preset"
        >
          Safe Preset
        </button>
        <button
          style={buttonStyle}
          onClick={() => publishControl({ preset: "aggressive" })}
          aria-label="Apply aggressive preset"
        >
          Aggressive Preset
        </button>
        <button
          style={buttonStyle}
          onClick={() => publishControl({ command: "start" })}
          aria-label="Start choreography run"
        >
          Start
        </button>
        <button
          style={buttonStyle}
          onClick={() => publishControl({ command: "stop" })}
          aria-label="Stop choreography run"
        >
          Stop
        </button>
        <button
          style={buttonStyle}
          onClick={() => publishControl({ command: "reset", preset: "aggressive" })}
          aria-label="Reset to default parameters"
        >
          {/* The backend always resets to the aggressive preset regardless of
              the `preset` field — it's included here so the echoed
              reachy/control message tells useReachy which values to display;
              otherwise the sliders would stay at whatever was last sent. */}
          Reset
        </button>
        <button style={buttonStyle} onClick={onOpenChat} aria-label="Open AI assistant">
          AI Assistant
        </button>
      </div>
    </div>
  );
}

function phaseColor(phase: string): string {
  switch (phase) {
    case "violation":
      return "#ef4444";
    case "warning":
      return "#f59e0b";
    case "done":
      return "#10b981";
    default:
      return "inherit";
  }
}

interface RobotViewProps {
  frame: ReturnType<typeof useReachy>["frame"];
}

/**
 * Live render of the robot's body, streamed from the backend's in-process
 * MuJoCo simulation on the ``reachy/frame`` channel. Shows a placeholder
 * until the first frame arrives.
 */
function RobotView({ frame }: RobotViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#aaa" }}>
        Robot (MuJoCo studio camera)
      </span>
      {frame ? (
        <img
          src={frame.image}
          alt="Live render of the Reachy Mini robot"
          style={{
            width: "100%",
            borderRadius: 6,
            background: "#000",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            borderRadius: 6,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
            fontFamily: "monospace",
            fontSize: 13,
            textAlign: "center",
            padding: 16,
          }}
        >
          Press Start to run a choreography — the robot will appear here.
        </div>
      )}
    </div>
  );
}

interface LeftColumnProps {
  frame: ReturnType<typeof useReachy>["frame"];
}

/**
 * Fixed-width left column holding the robot view and the parameter sliders.
 *
 * Rendered outside the resizable {@link ApplicationShell} so both stay visible
 * at a readable, non-collapsing width — the shell's percentage-sized sidebar
 * would otherwise squeeze the slider labels when the robot view is present.
 */
function LeftColumn({ frame }: LeftColumnProps) {
  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        height: "100%",
        overflowY: "auto",
        background: "#1a1a1a",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <RobotView frame={frame} />
      <div
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
          borderRadius: 8,
          padding: 4,
        }}
      >
        <ParameterControllerComponent
          channel="reachy/control"
          parameters={CHOREOGRAPHY_PARAMETERS}
          debounceMs={300}
        />
      </div>
    </div>
  );
}

interface AppShellProps extends DashboardProps {
  frame: ReturnType<typeof useReachy>["frame"];
}

function AppShell({ onOpenChat, state, log, frame, publishControl }: AppShellProps) {
  const loaderStatus = useWidgetLoader("/sct-manifest.json");

  if (loaderStatus === "loading") return <p>Loading widgets…</p>;
  if (loaderStatus === "error") return <p>Failed to load widget manifest.</p>;

  return (
    <div
      data-testid="shell-layout"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <Dashboard
        onOpenChat={onOpenChat}
        state={state}
        log={log}
        publishControl={publishControl}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftColumn frame={frame} />
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ApplicationShell initialLayout={initialLayout} />
        </div>
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

/**
 * Renders inside `EventBusProvider` — `useReachy` needs the EventBus client
 * from context, which is only available to descendants of the provider, not
 * to `App` itself (the component that creates the provider element).
 */
function Root() {
  const [chatOpen, setChatOpen] = useState(false);
  const { layout, setLayout } = useShellLayoutStore();
  const { state, log, frame, telemetryHistory, safetyHistory, params, publishControl } =
    useReachy();

  return (
    <>
      <AppShell
        onOpenChat={() => setChatOpen((v) => !v)}
        state={state}
        log={log}
        frame={frame}
        publishControl={publishControl}
      />

      {/* Right-edge tab — stays visible when the panel is collapsed so the
          user can expand it again without navigating back to the Dashboard bar */}
      {!chatOpen && (
        <button
          style={expandTabStyle}
          onClick={() => setChatOpen(true)}
          aria-label="Open AI assistant"
        >
          AI Assistant
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
        getSnapshot={() => ({
          telemetry_snapshot: telemetryHistory,
          safety_snapshot: safetyHistory,
          current_params: { ...params },
        })}
        onApproveParams={(approved) => publishControl(approved)}
      />
    </>
  );
}

function App() {
  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws">
        <WidgetLoaderProvider>
          <Root />
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
