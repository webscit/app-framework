import { useChannel, usePublish } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { ReachyControlPayload, ReachyState } from "./useReachy";

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  warning: "Warning",
  violation: "Violation",
  done: "Done",
};

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

/**
 * Widget body: run status (from ``reachy/state``) plus the preset and
 * lifecycle buttons (published to ``reachy/control``). Self-contained so it
 * needs no props — every control is a first-class, AI-rearrangeable widget.
 *
 * @returns The run-controls toolbar.
 */
function RunControlsComponent(): React.ReactElement {
  const state = useChannel<ReachyState>("reachy/state");
  const publish = usePublish();
  const send = (payload: ReachyControlPayload) => publish("reachy/control", payload);

  const phase = state?.phase ?? "idle";
  const verdict = state?.verdict;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        width: "100%",
        fontFamily: "monospace",
        fontSize: 13,
      }}
    >
      <strong style={{ letterSpacing: "0.02em" }}>
        Reachy Mini — Safety Validator
      </strong>

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.55)",
          border: `1px solid ${phaseColor(phase)}`,
          color: phaseColor(phase),
          fontWeight: 600,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: phaseColor(phase),
          }}
        />
        {PHASE_LABELS[phase] ?? phase}
        {verdict ? ` (${verdict})` : ""}
      </span>

      <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
        <button
          className="reachy-btn"
          onClick={() => send({ preset: "safe" })}
          aria-label="Apply safe preset"
        >
          Safe Preset
        </button>
        <button
          className="reachy-btn"
          onClick={() => send({ preset: "aggressive" })}
          aria-label="Apply aggressive preset"
        >
          Aggressive Preset
        </button>
        <button
          className="reachy-btn reachy-btn--primary"
          onClick={() => send({ command: "start" })}
          aria-label="Start choreography run"
        >
          Start
        </button>
        <button
          className="reachy-btn"
          onClick={() => send({ command: "stop" })}
          aria-label="Stop choreography run"
        >
          Stop
        </button>
        <button
          className="reachy-btn"
          // The backend always resets to the aggressive preset; the `preset`
          // field is echoed back so the sliders reflect the reset values.
          onClick={() => send({ command: "reset", preset: "aggressive" })}
          aria-label="Reset to default parameters"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/**
 * Example widget definition for the run-control toolbar. Registered into the
 * shell so the controls live in the (header) layout like every other widget.
 */
export const RUN_CONTROLS: WidgetDefinition = {
  name: "RunControls",
  description:
    "Choreography run controls: current status plus safe/aggressive presets " +
    "and start/stop/reset, published to reachy/control.",
  channelPattern: "reachy/state",
  consumes: [],
  priority: 10,
  defaultRegion: "header",
  parameters: {},
  factory: () => RunControlsComponent,
};
