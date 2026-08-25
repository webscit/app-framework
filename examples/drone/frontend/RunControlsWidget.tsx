import { useEffect, useState } from "react";
import { useChannel, usePublish } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { DroneControlPayload, DroneState } from "./useDrone";

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
 * Widget body: run status (from ``drone/state``) plus the preset and lifecycle
 * buttons (published to ``drone/control``). Self-contained so it needs no props
 * — every control is a first-class, AI-rearrangeable widget.
 *
 * @returns The run-controls toolbar.
 */
function RunControlsComponent(): React.ReactElement {
  const state = useChannel<DroneState>("drone/state");
  const control = useChannel<DroneControlPayload>("drone/control");
  const publish = usePublish();
  const send = (payload: DroneControlPayload) => publish("drone/control", payload);

  const phase = state?.phase ?? "idle";
  const verdict = state?.verdict;
  // A run is in-flight while the backend reports the "running" phase; the other
  // phases (idle/done/violation/warning) are settled states.
  const isRunning = phase === "running";

  // Track the active preset from echoed control events so the matching button
  // can be highlighted. The backend starts in the aggressive preset by design.
  const [activePreset, setActivePreset] = useState<"gentle" | "aggressive">(
    "aggressive",
  );
  useEffect(() => {
    if (control?.preset) setActivePreset(control.preset);
  }, [control]);

  return (
    <div className="drone-runctl">
      <strong className="drone-runctl-title">
        Drone — Flight Manoeuvre Stability Validator
      </strong>

      <span
        className="drone-runctl-phase"
        // Phase colour is data-driven; expose it as a CSS variable the rule reads.
        style={{ "--phase-color": phaseColor(phase) } as React.CSSProperties}
      >
        <span aria-hidden className="drone-runctl-dot" />
        {PHASE_LABELS[phase] ?? phase}
        {verdict ? ` (${verdict})` : ""}
      </span>

      <div className="drone-runctl-actions">
        <button
          className="drone-btn"
          aria-pressed={activePreset === "gentle"}
          onClick={() => send({ preset: "gentle" })}
          aria-label="Apply gentle preset"
        >
          Gentle Preset
        </button>
        <button
          className="drone-btn"
          aria-pressed={activePreset === "aggressive"}
          onClick={() => send({ preset: "aggressive" })}
          aria-label="Apply aggressive preset"
        >
          Aggressive Preset
        </button>
        <button
          className="drone-btn drone-btn--primary"
          onClick={() => send({ command: "start" })}
          disabled={isRunning}
          aria-label="Start manoeuvre run"
        >
          Start
        </button>
        <button
          className="drone-btn"
          onClick={() => send({ command: "stop" })}
          disabled={!isRunning}
          aria-label="Stop manoeuvre run"
        >
          Stop
        </button>
        <button
          className="drone-btn"
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
 * shell so the controls live in the header region like every other widget.
 */
export const RUN_CONTROLS: WidgetDefinition = {
  name: "RunControls",
  description:
    "Manoeuvre run controls: current status plus gentle/aggressive presets " +
    "and start/stop/reset, published to drone/control.",
  channelPattern: "drone/state",
  consumes: [],
  priority: 10,
  defaultRegion: "header",
  parameters: {},
  factory: () => RunControlsComponent,
};
