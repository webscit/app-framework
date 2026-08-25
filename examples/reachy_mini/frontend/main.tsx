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
import { useReachy } from "./useReachy";
import { ROBOT_VIEW } from "./RobotViewWidget";
import { RUN_CONTROLS } from "./RunControlsWidget";
import { SAFETY_STATUS } from "./SafetyStatusWidget";
import { CONNECTION_STATUS } from "./ConnectionStatusWidget";
import { CHOREOGRAPHY_FLOW } from "./ChoreographyFlowWidget";
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
registry.register(CHOREOGRAPHY_FLOW);

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

Each choreography step carries absolute values, used directly (there is no
separate amplitude): roll_factor is the head roll in degrees, z_factor the head
height in mm, antenna_factor the antenna position, and duration_s the step's
own duration in seconds.

Safety limits: head roll warns above ±30° and violates at ±40°; head height (z)
warns above 25 mm and violates at 35 mm; step duration warns below 0.5 s and
violates at/below 0.3 s.

The choreography is defined by per-step values (roll_factor / z_factor /
duration_s on each step), edited in the ChoreographyFlow widget — there are no
tunable scalar parameters. So when the run is VIOLATING and the user asks you to
fix it, return exactly this as suggested_params so they can approve a one-click
fix:

  "suggested_params": { "preset": "safe" }

Approving that loads the known-safe choreography, so the next run passes;
rejecting changes nothing. In your explanation, also say which step is unsafe
and what value would fix it (e.g. "step 0 roll is 42°, past the 40° limit —
approve to load the Safe preset, or reduce it to ~25° in the widget"). Only
propose the safe preset when the run is actually violating; for an "ok" run,
return no suggested_params.
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
    // The robot render and the amplitude parameters now live inside the
    // ChoreographyFlow widget in the main region, so the left sidebar is hidden
    // to keep the UI uncluttered.
    "sidebar-left": {
      visible: false,
      items: [],
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
          size: 10,
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
          size: 30,
        },
        {
          id: "choreography-flow",
          type: "ChoreographyFlow",
          props: {
            channel: "reachy/control",
            // Mirrors the backend's DEFAULT_SEQUENCE (absolute per-step values in
            // degrees / mm / seconds) so the canvas opens on the dance the robot
            // performs.
            defaultSequence: [
              { label: "tilt_right", roll_factor: 40, duration_s: 0.25 },
              { label: "tilt_left", roll_factor: -40, duration_s: 0.25 },
              {
                label: "raise_tilt_wiggle",
                roll_factor: 20,
                z_factor: 35,
                antenna_factor: 0.6,
                duration_s: 0.25,
              },
              { label: "home", duration_s: 0.25 },
            ],
          },
          order: 2,
          size: 36,
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
          order: 3,
          size: 24,
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
