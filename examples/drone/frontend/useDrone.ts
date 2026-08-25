import { useEffect, useRef, useState } from "react";
import {
  toPayloadWithHeaders,
  useChannel,
  useEventBusClient,
  useEventBusStatus,
  usePublish,
} from "@app-framework/core-ui";
import type { BaseEvent } from "@app-framework/core-ui";

/**
 * Live flight sample published to ``drone/telemetry`` after each simulation
 * step by ``examples/drone/backend/fmu_runner.py``.
 */
export interface DroneTelemetry extends BaseEvent {
  /** Simulation time of this sample (seconds). */
  t: number;
  /** Manoeuvre segment this sample belongs to (0-based). */
  segment: number;
  /** Body position ``[x, y, z]`` (metres). */
  position: number[];
  /** Body attitude ``[roll, pitch, yaw]`` (degrees). */
  attitude: number[];
  /** Body velocity ``[vx, vy, vz]`` (metres/second). */
  velocity: number[];
  /** The four propeller angular speeds (rad/s). */
  prop_w: number[];
  /** Commanded setpoint ``[x, y, z]`` active at this sample (metres). */
  target: number[];
}

/** Per-segment stability assessment published to ``drone/stability``. */
export interface DroneStability extends BaseEvent {
  /** Assessed segment index (0-based). */
  segment: number;
  /** Largest absolute tilt seen in the segment (degrees). */
  peak_tilt_deg: number;
  /** Time to settle within ±5% of the step (seconds). */
  settling_time_s: number;
  /** Peak overshoot beyond the target (% of the step). */
  overshoot_pct: number;
  /** Degrees to the tilt limit (negative = exceeded). */
  tilt_margin_deg: number;
  /** Seconds to the settling limit (negative = too slow). */
  settling_margin_s: number;
  /** Overall status. */
  status: "ok" | "warning" | "violation";
  /** Metrics past a violation threshold. */
  violated: string[];
  /** Metrics approaching but not past their limit. */
  warnings: string[];
}

/** Run phase transition published to ``drone/state``. */
export interface DroneState extends BaseEvent {
  /** Current run phase. */
  phase: "idle" | "running" | "warning" | "violation" | "done";
  /** Run verdict once a run ends. */
  verdict: "" | "PASS" | "FAIL";
  /** Human-readable description of the transition. */
  message: string;
}

/** Human-readable log entry published to ``drone/log``. */
export interface DroneLog extends BaseEvent {
  /** Log level. */
  level: "info" | "warning" | "error";
  /** Log message text. */
  message: string;
}

/**
 * Manoeuvre update or lifecycle command accepted on ``drone/control``.
 *
 * All fields are optional — only fields that should change need be present.
 * ``preset`` is applied first, then individual fields override it.
 */
export interface DroneControlPayload {
  /** Magnitude of each commanded position step (metres). */
  setpoint_step_m?: number;
  /** How often the setpoint changes (Hz). */
  change_frequency_hz?: number;
  /** How many segments the manoeuvre contains. */
  num_segments?: number;
  /** Apply a named preset. */
  preset?: "gentle" | "aggressive";
  /** Lifecycle command. */
  command?: "start" | "stop" | "reset";
}

/** Current manoeuvre parameters, mirroring the backend's ManoeuvreParams. */
export interface ManoeuvreParams {
  /** Magnitude of each commanded position step (metres). */
  setpoint_step_m: number;
  /** How often the setpoint changes (Hz). */
  change_frequency_hz: number;
  /** How many segments the manoeuvre contains. */
  num_segments: number;
}

/** Number of recent telemetry/stability events buffered for the AI snapshot. */
export const SNAPSHOT_SIZE = 20;

/**
 * Mirrors `GENTLE_PRESET` / `AGGRESSIVE_PRESET` in
 * `examples/drone/backend/manoeuvre.py`, for optimistic local display only —
 * the backend is the source of truth and applies the same values when it
 * receives `{ preset: "gentle" | "aggressive" }`.
 */
const GENTLE_PRESET: ManoeuvreParams = {
  setpoint_step_m: 1.5,
  change_frequency_hz: 0.5,
  num_segments: 4,
};

const AGGRESSIVE_PRESET: ManoeuvreParams = {
  setpoint_step_m: 12.0,
  change_frequency_hz: 1.5,
  num_segments: 6,
};

/**
 * Buffers the last `max` merged messages on a channel, oldest first. Lives here
 * (not in `@app-framework/core-ui`) because only the example needs a rolling
 * window — `useChannel` (latest value only) covers the framework's other uses.
 */
function useChannelHistory<T>(channel: string, max: number): T[] {
  const client = useEventBusClient();
  const [history, setHistory] = useState<T[]>([]);

  useEffect(() => {
    setHistory([]);
    return client.subscribe(channel, (event) => {
      setHistory((prev) => {
        const next = [...prev, toPayloadWithHeaders<T>(event)];
        return next.length > max ? next.slice(next.length - max) : next;
      });
    });
  }, [channel, client, max]);

  return history;
}

/**
 * Example-app hook wiring up the drone stability-validator channels.
 *
 * Lives in `examples/` — not part of the framework. Tracks the current run
 * state/log, buffers the last `SNAPSHOT_SIZE` telemetry and stability events for
 * the AI chat panel's snapshot, derives the live `ManoeuvreParams` from the
 * `drone/control` echo (the ws_bridge fans every publish out to all subscribers,
 * including the publisher), and exposes `publishControl`.
 *
 * On first connection it publishes `{ command: "start" }` so the demo opens
 * directly into the running (Aggressive-preset, visibly broken) state — the
 * engineer arrives at a FAIL to diagnose, exactly as the spec intends.
 *
 * @returns Live run state, buffered telemetry/stability, params, and a
 *   `publishControl` sender.
 */
export function useDrone() {
  const state = useChannel<DroneState>("drone/state");
  const log = useChannel<DroneLog>("drone/log");
  const control = useChannel<DroneControlPayload>("drone/control");
  const status = useEventBusStatus();
  const telemetryHistory = useChannelHistory<DroneTelemetry>(
    "drone/telemetry",
    SNAPSHOT_SIZE,
  );
  const stabilityHistory = useChannelHistory<DroneStability>(
    "drone/stability",
    SNAPSHOT_SIZE,
  );

  // The backend starts in the aggressive preset by design (the broken-state
  // demo) — mirror that here so displayed params match on first render.
  const [params, setParams] = useState<ManoeuvreParams>(AGGRESSIVE_PRESET);
  const publish = usePublish();

  useEffect(() => {
    if (!control) return;
    setParams((prev) => {
      const base =
        control.preset === "gentle"
          ? GENTLE_PRESET
          : control.preset === "aggressive"
            ? AGGRESSIVE_PRESET
            : prev;
      return { ...base, ...stripNonParamFields(control) };
    });
  }, [control]);

  // Auto-start once, on first connect, so the demo opens into a running FAIL.
  const startedRef = useRef(false);
  useEffect(() => {
    if (status === "connected" && !startedRef.current) {
      startedRef.current = true;
      publish("drone/control", { command: "start" });
    }
  }, [status, publish]);

  function publishControl(payload: DroneControlPayload): void {
    publish("drone/control", payload);
  }

  return { state, log, telemetryHistory, stabilityHistory, params, publishControl };
}

/** Drop non-numeric-param fields before merging a control update into params. */
function stripNonParamFields(payload: DroneControlPayload): Partial<ManoeuvreParams> {
  const { command: _command, preset: _preset, ...rest } = payload;
  return rest;
}
