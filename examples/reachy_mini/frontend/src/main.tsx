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
import type { ParameterConfig, ShellLayout } from "@app-framework/core-ui";
import { useReachy } from "./useReachy";
import { ROBOT_VIEW } from "./RobotViewWidget";
import { RUN_CONTROLS } from "./RunControlsWidget";
import { SAFETY_STATUS } from "./SafetyStatusWidget";
import { CONNECTION_STATUS } from "./ConnectionStatusWidget";
// globals.css first so the example's shell.css :root brand overrides win.
import "@/globals.css";
import "./shell.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);
registry.register(LOG_VIEWER);
registry.register(DATA_TABLE);
registry.register(ROBOT_VIEW);
registry.register(RUN_CONTROLS);
registry.register(SAFETY_STATUS);
registry.register(CONNECTION_STATUS);

/** Choreography parameter sliders, published to ``reachy/control``. */
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

// Domain guidance for the AI assistant. The framework's /ai/layout endpoint is
// domain-agnostic — it forwards this text and the context data verbatim — so
// all Reachy-Mini-specific knowledge (limits, parameter meanings) lives here in
// the example, not in the framework.
const AI_INSTRUCTIONS = `
This is a Reachy Mini head-choreography safety validator.

context.telemetry: recent commanded head poses per step (roll_deg, z_mm, antennas, duration_s).
context.safety: per-step safety assessment. status is "ok" | "warning" | "violation";
  *_margin_* fields are distance to the limit (negative = exceeded); violated_axes
  / warning_axes name the offending axes.
context.parameters: the current choreography parameters.

Safety limits: head roll warns above ±30° and violates at ±40°; head height (z)
warns above 25 mm and violates at 35 mm; step duration warns below 0.5 s and
violates at/below 0.3 s.

suggested_params may change any of: roll_amplitude_deg, z_amplitude_mm,
step_duration_s, antenna_amplitude, num_loops. Propose values comfortably within
the safe range (not just at the threshold).
`.trim();

// Every visual is a widget inside the shell, so the AI assistant (or a future
// no-code editor) can rearrange all of them. The run controls live in the
// header; the robot render and parameter sliders in the left sidebar; the
// safety-status card, chart + safety table in main; log in the bottom.
const initialLayout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    header: {
      visible: true,
      items: [{ id: "run-controls", type: "RunControls", props: {}, order: 0 }],
    },
    "sidebar-left": {
      visible: true,
      items: [
        { id: "robot-view", type: "RobotView", props: {}, order: 0 },
        {
          id: "choreography-params",
          type: "ParameterController",
          props: {
            channel: "reachy/control",
            debounceMs: 300,
            parameters: CHOREOGRAPHY_PARAMETERS,
          },
          order: 1,
        },
      ],
    },
    main: {
      visible: true,
      items: [
        {
          id: "safety-status",
          type: "SafetyStatus",
          props: {},
          order: 0,
          // Compact banner: keep this slim so the chart starts right below it
          // instead of leaving dead space under the status card.
          size: 12,
        },
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
          order: 1,
          size: 54,
        },
        {
          id: "safety-table",
          type: "DataTable",
          props: {
            channel: "reachy/safety",
            title: "Safety Assessment",
            pageSize: 10,
            maxRows: 200,
            // Highlight failing rows: the backend's `status` field drives the
            // row colour (event-driven — the criteria live in the backend).
            statusKey: "status",
            statusVariants: { violation: "error", warning: "warning", ok: "success" },
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
          order: 2,
          size: 34,
        },
      ],
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
            title: "Logs",
          },
          order: 0,
        },
      ],
    },
    "status-bar": {
      visible: true,
      items: [
        { id: "connection-status", type: "ConnectionStatus", props: {}, order: 0 },
      ],
    },
  },
};

// ─── App ──────────────────────────────────────────────────────────────────────

/**
 * The whole example UI is the {@link ApplicationShell} — every visual is a
 * registered widget in its layout, so the AI/no-code editor can rearrange all
 * of them. This thin wrapper exists only to read the EventBus-backed buffers
 * (via {@link useReachy}) that feed the AI assistant's context snapshot; it
 * renders no chrome of its own.
 */
function ReachyDashboard() {
  const { telemetryHistory, safetyHistory, params, publishControl } = useReachy();

  return (
    <ApplicationShell
      initialLayout={initialLayout}
      manifestUrl="/sct-manifest.json"
      ai={{
        apiUrl: "/ai/layout",
        // The framework is domain-agnostic: this example supplies its own
        // context shape plus instructions describing what the data means and
        // which parameters the AI may change.
        getSnapshot: () => ({
          context: {
            telemetry: telemetryHistory,
            safety: safetyHistory,
            parameters: params,
          },
          instructions: AI_INSTRUCTIONS,
          currentParams: { ...params },
        }),
        onApproveParams: (approved) => publishControl(approved),
      }}
    />
  );
}

function App() {
  return (
    <AppRoot registry={registry} webSocketPath="/ws">
      <ReachyDashboard />
    </AppRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
