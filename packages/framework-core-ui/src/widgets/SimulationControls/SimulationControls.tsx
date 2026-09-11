import type { ComponentType } from "react";

import { useChannel } from "../../useChannel";
import { usePublish } from "../../usePublish";
import "./SimulationControls.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the event payload read from `stateChannel` via {@link useChannel}.
 *
 * Deliberately does not extend `BaseEvent` (defined in `src/index.ts`) to
 * avoid a circular import between this widget and the package root.
 */
export interface SimulationStatePayload {
  /** Current lifecycle phase reported by the backend, e.g. `"idle"`, `"running"`. */
  phase: string;
  /** Optional human-readable detail about the current phase. */
  message?: string;
}

/**
 * Props for the {@link SimulationControlsComponent}.
 *
 * All props correspond to the `parameters` schema declared in `SIMULATION_CONTROLS`.
 */
export interface SimulationControlsProps {
  /**
   * Channel to read simulation state (`{ phase, message }`) from.
   * Default: `"sim/state"`
   */
  stateChannel?: string;
  /**
   * Channel to publish `{ command: "start" | "stop" }` to.
   * Default: `"sim/control"`
   */
  controlChannel?: string;
  /**
   * Value of `phase` that means "a run is in flight".
   * Default: `"running"`
   */
  runningPhase?: string;
  /** Title shown above the controls. Omit to render no title. */
  title?: string;
}

const PREFIX = "sct-SimulationControls";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Generic start/stop controls for a start/stop-shaped simulation run.
 *
 * Subscribes to `stateChannel` via {@link useChannel} for `{ phase, message }`
 * and publishes `{ command: "start" }` / `{ command: "stop" }` to
 * `controlChannel` via {@link usePublish}. The Start button is disabled while
 * `phase === runningPhase`; the Stop button is disabled otherwise. Does not
 * render `phase`/`message` itself — pair with `StatusIndicator` for status
 * display.
 *
 * @param props Component props — see {@link SimulationControlsProps}.
 * @returns A Start/Stop control pair, with an optional title.
 * @example
 * ```tsx
 * <SimulationControlsComponent
 *   stateChannel="sim/state"
 *   controlChannel="sim/control"
 *   runningPhase="running"
 *   title="Simulation Controls"
 * />
 * ```
 */
export const SimulationControlsComponent: ComponentType<SimulationControlsProps> = ({
  stateChannel = "sim/state",
  controlChannel = "sim/control",
  runningPhase = "running",
  title,
}) => {
  const state = useChannel<SimulationStatePayload>(stateChannel);
  const publish = usePublish();

  const isRunning = state?.phase === runningPhase;

  return (
    <div className={`${PREFIX}-container`}>
      {title && <div className={`${PREFIX}-title`}>{title}</div>}
      <div className={`${PREFIX}-row`}>
        <button
          type="button"
          aria-label="Start simulation"
          className={`${PREFIX}-button`}
          disabled={isRunning}
          onClick={() => publish(controlChannel, { command: "start" })}
        >
          Start
        </button>
        <button
          type="button"
          aria-label="Stop simulation"
          className={`${PREFIX}-button`}
          disabled={!isRunning}
          onClick={() => publish(controlChannel, { command: "stop" })}
        >
          Stop
        </button>
      </div>
    </div>
  );
};
