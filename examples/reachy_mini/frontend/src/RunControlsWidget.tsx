import { useEffect, useState } from "react";
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
  const control = useChannel<ReachyControlPayload>("reachy/control");
  const publish = usePublish();
  const send = (payload: ReachyControlPayload) => publish("reachy/control", payload);

  const phase = state?.phase ?? "idle";
  const verdict = state?.verdict;
  // A run is in-flight while the backend reports the "running" phase; the other
  // phases (idle/done/violation/warning) are settled states.
  const isRunning = phase === "running";

  // Track the active preset from echoed control events so the matching button
  // can be highlighted. The backend starts in the aggressive preset by design.
  const [activePreset, setActivePreset] = useState<"safe" | "aggressive">("aggressive");
  useEffect(() => {
    if (control?.preset) setActivePreset(control.preset);
  }, [control]);

  return (
    <div className="reachy-runctl">
      <strong className="reachy-runctl-title">Reachy Mini — Safety Validator</strong>

      <span
        className="reachy-runctl-phase"
        // Phase colour is data-driven; expose it as a CSS variable the rule reads.
        style={{ "--phase-color": phaseColor(phase) } as React.CSSProperties}
      >
        <span aria-hidden className="reachy-runctl-dot" />
        {PHASE_LABELS[phase] ?? phase}
        {verdict ? ` (${verdict})` : ""}
      </span>

      <div className="reachy-runctl-actions">
        <button
          className="reachy-btn"
          aria-pressed={activePreset === "safe"}
          onClick={() => send({ preset: "safe" })}
          aria-label="Apply safe preset"
        >
          Safe Preset
        </button>
        <button
          className="reachy-btn"
          aria-pressed={activePreset === "aggressive"}
          onClick={() => send({ preset: "aggressive" })}
          aria-label="Apply aggressive preset"
        >
          Aggressive Preset
        </button>
        <button
          className="reachy-btn reachy-btn--primary"
          onClick={() => send({ command: "start" })}
          disabled={isRunning}
          aria-label="Start choreography run"
        >
          Start
        </button>
        <button
          className="reachy-btn"
          onClick={() => send({ command: "stop" })}
          disabled={!isRunning}
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
