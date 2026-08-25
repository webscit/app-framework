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
import { useDrone } from "./useDrone";
import { TRAJECTORY_VIEW } from "./TrajectoryViewWidget";
import { RUN_CONTROLS } from "./RunControlsWidget";
import { STABILITY_STATUS } from "./StabilityStatusWidget";
import { CONNECTION_STATUS } from "./ConnectionStatusWidget";
// globals.css first so the example's shell.css :root brand overrides win.
import "@/globals.css";
import "./shell.css";

const registry = new WidgetRegistry();
registry.register(PARAMETER_CONTROLLER);
registry.register(CHART);
registry.register(LOG_VIEWER);
registry.register(DATA_TABLE);
registry.register(TRAJECTORY_VIEW);
registry.register(RUN_CONTROLS);
registry.register(STABILITY_STATUS);
registry.register(CONNECTION_STATUS);

/** Manoeuvre parameter sliders, published to ``drone/control``. */
const DRONE_PARAMETERS: Record<string, ParameterConfig> = {
  setpoint_step_m: {
    title: "Setpoint Step (m)",
    type: "number",
    minimum: 1,
    maximum: 15,
    multipleOf: 0.5,
    default: 12,
    "x-options": { widget: "slider" },
  },
  change_frequency_hz: {
    title: "Change Frequency (Hz)",
    type: "number",
    minimum: 0.1,
    maximum: 3.0,
    multipleOf: 0.1,
    default: 1.5,
    "x-options": { widget: "slider" },
  },
  num_segments: {
    title: "Segments",
    type: "number",
    minimum: 1,
    maximum: 10,
    multipleOf: 1,
    default: 6,
    "x-options": { widget: "input" },
  },
};

// Domain guidance for the AI assistant. The framework's /ai/layout endpoint is
// domain-agnostic — it forwards this text and the context data verbatim — so
// all drone-specific knowledge (limits, parameter meanings) lives here in the
// example, not in the framework.
const AI_INSTRUCTIONS = `
This is a quadcopter Flight Manoeuvre Stability Validator.

context.telemetry: recent flight samples per simulation step — position [x,y,z] (m),
  attitude [roll,pitch,yaw] (deg), velocity [vx,vy,vz] (m/s), prop_w (4 propeller
  speeds, rad/s), and the commanded target [x,y,z] (m).
context.stability: per-segment assessment. status is "ok" | "warning" | "violation";
  *_margin_* fields are distance to the limit (negative = exceeded); violated /
  warnings name the offending metrics.
context.parameters: the current manoeuvre parameters.

The manoeuvre is a square-wave on the North (x) axis: each segment RAMPS the
setpoint out by setpoint_step_m and back, holding 1/change_frequency_hz seconds,
for num_segments segments. The key quantity is the setpoint RATE =
setpoint_step_m × change_frequency_hz (m/s): the position controller can track a
ramp up to about 1 m/s. Beyond that it cannot keep up, tilts hard, and loses
control (divergence) — the run is aborted on the first violated segment.

Stability limits: peak tilt warns above 20° and violates at 35° (past ~35° lift
drops sharply → flip); settling time warns above 3 s and violates at 6 s;
overshoot warns above 20% and violates at 50% of the step; runaway tilt/position
is divergence (loss of control).

suggested_params may change setpoint_step_m, change_frequency_hz, or
num_segments. To fix a violation, lower the setpoint rate — a smaller step
and/or lower frequency so setpoint_step_m × change_frequency_hz stays
comfortably under 1 m/s (e.g. the Gentle preset: 1.5 m × 0.5 Hz = 0.75 m/s).
`.trim();

// Every visual is a widget inside the shell, so the AI assistant (or a future
// no-code editor) can rearrange all of them. Run controls live in the header;
// the trajectory view and parameter sliders in the left sidebar; the
// stability-status card, attitude chart, and per-segment table in main; log in
// the bottom.
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
        // Three orthogonal projections — top-down (North × East) plus two side
        // views (North × Altitude, East × Altitude) — so horizontal drift and
        // altitude are all visible and the sidebar space is filled.
        {
          id: "trajectory-top",
          type: "TrajectoryView",
          props: { plane: "xy" },
          order: 0,
        },
        {
          id: "trajectory-side-x",
          type: "TrajectoryView",
          props: { plane: "xz" },
          order: 1,
        },
        {
          id: "trajectory-side-y",
          type: "TrajectoryView",
          props: { plane: "yz" },
          order: 2,
        },
        {
          id: "manoeuvre-params",
          type: "ParameterController",
          props: {
            channel: "drone/control",
            debounceMs: 300,
            parameters: DRONE_PARAMETERS,
          },
          order: 3,
        },
      ],
    },
    main: {
      visible: true,
      items: [
        {
          id: "stability-status",
          type: "StabilityStatus",
          props: {},
          order: 0,
          // Compact banner: keep this slim so the chart starts right below it.
          size: 12,
        },
        {
          id: "attitude-chart",
          type: "Chart",
          props: {
            title: "Attitude & Altitude",
            maxPoints: 400,
            yLabel: "deg / m",
            xLabel: "Sim time (s)",
            series: [
              {
                channel: "drone/telemetry",
                field: "attitude.0",
                label: "Roll (°)",
                color: "var(--chart-1)",
              },
              {
                channel: "drone/telemetry",
                field: "attitude.1",
                label: "Pitch (°)",
                color: "var(--chart-2)",
              },
              {
                channel: "drone/telemetry",
                field: "position.2",
                label: "Altitude (m)",
                color: "var(--chart-3)",
              },
            ],
          },
          order: 1,
          size: 54,
        },
        {
          id: "stability-table",
          type: "DataTable",
          props: {
            channel: "drone/stability",
            title: "Per-Segment Stability",
            pageSize: 10,
            maxRows: 200,
            // Highlight failing rows: the backend's `status` field drives the
            // row colour (event-driven — the criteria live in the backend).
            statusKey: "status",
            statusVariants: { violation: "error", warning: "warning", ok: "success" },
            columns: [
              { key: "segment", header: "Segment", type: "number" },
              { key: "status", header: "Status", type: "string" },
              { key: "peak_tilt_deg", header: "Peak Tilt (°)", type: "number" },
              { key: "settling_time_s", header: "Settling (s)", type: "number" },
              { key: "overshoot_pct", header: "Overshoot (%)", type: "number" },
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
          id: "drone-log",
          type: "LogViewer",
          props: {
            channel: "drone/log",
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
 * (via {@link useDrone}) that feed the AI assistant's context snapshot; it
 * renders no chrome of its own.
 */
function DroneDashboard() {
  const { telemetryHistory, stabilityHistory, params, publishControl } = useDrone();

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
            stability: stabilityHistory,
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
      <DroneDashboard />
    </AppRoot>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
