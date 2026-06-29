import { useEffect, useState } from "react";
import {
  toPayloadWithHeaders,
  useChannel,
  useEventBusClient,
  usePublish,
} from "@app-framework/core-ui";
import type { BaseEvent } from "@app-framework/core-ui";

/**
 * Live head pose sample published to ``reachy/telemetry`` after each
 * ``goto_target()`` call by ``examples/reachy_mini/backend/producers.py``.
 */
export interface ReachyTelemetry extends BaseEvent {
  step: number;
  loop: number;
  roll_deg: number;
  z_mm: number;
  antenna_l: number;
  antenna_r: number;
  duration_s: number;
}

/** Safety margin assessment for a single movement step, on ``reachy/safety``. */
export interface ReachySafety extends BaseEvent {
  step: number;
  loop: number;
  roll_margin_deg: number;
  z_margin_mm: number;
  duration_margin_s: number;
  status: "ok" | "warning" | "violation";
  violated_axes: string[];
  warning_axes: string[];
}

/** Simulation phase transition published to ``reachy/state``. */
export interface ReachyState extends BaseEvent {
  phase: "idle" | "running" | "warning" | "violation" | "done";
  verdict: "" | "PASS" | "FAIL";
  message: string;
}

/** Human-readable log entry published to ``reachy/log``. */
export interface ReachyLog extends BaseEvent {
  level: "info" | "warning" | "error";
  message: string;
}

/** A rendered robot frame published to ``reachy/frame`` after each executed step. */
export interface ReachyFrame extends BaseEvent {
  step: number;
  loop: number;
  /** ``data:image/jpeg;base64,...`` URL of the studio_close camera render. */
  image: string;
}

/** A single choreography step expressed as amplitude factors. */
export interface StepSpecPayload {
  label: string;
  roll_factor?: number;
  z_factor?: number;
  antenna_factor?: number;
}

/**
 * Parameter update or lifecycle command accepted on ``reachy/control``.
 *
 * All fields are optional — only the fields that should change need to be
 * present. ``preset`` is applied first, then individual fields override it.
 */
export interface ReachyControlPayload {
  roll_amplitude_deg?: number;
  z_amplitude_mm?: number;
  step_duration_s?: number;
  antenna_amplitude?: number;
  num_loops?: number;
  sequence?: StepSpecPayload[];
  preset?: "safe" | "aggressive";
  command?: "start" | "stop" | "reset";
}

/** Current choreography parameters, mirroring the backend's ChoreographyParams. */
export interface ChoreographyParams {
  roll_amplitude_deg: number;
  z_amplitude_mm: number;
  step_duration_s: number;
  antenna_amplitude: number;
  num_loops: number;
}

/** Number of recent telemetry/safety events buffered for the AI snapshot. */
export const SNAPSHOT_SIZE = 20;

/**
 * Mirrors `SAFE_PRESET` / `AGGRESSIVE_PRESET` in
 * `examples/reachy_mini/backend/producers.py`, for optimistic local display
 * only — the backend is the source of truth and applies the same values
 * when it receives `{ preset: "safe" | "aggressive" }`.
 */
const SAFE_PRESET: ChoreographyParams = {
  roll_amplitude_deg: 15.0,
  z_amplitude_mm: 15.0,
  step_duration_s: 1.0,
  antenna_amplitude: 0.4,
  num_loops: 2,
};

const AGGRESSIVE_PRESET: ChoreographyParams = {
  roll_amplitude_deg: 42.0,
  z_amplitude_mm: 36.0,
  step_duration_s: 0.25,
  antenna_amplitude: 0.6,
  num_loops: 2,
};

/**
 * Buffers the last `max` merged messages on a channel, oldest first.
 *
 * Lives here rather than in `@app-framework/core-ui` because no other
 * example currently needs a rolling window — `useChannel` (latest value
 * only) covers every other use case in the framework today.
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
 * Example-app hook that wires up the Reachy Mini choreography channels.
 *
 * Lives in `examples/` — not part of the framework itself. Tracks the
 * current run state/log, buffers the last `SNAPSHOT_SIZE` telemetry and
 * safety events for the AI chat panel's snapshot, derives the live
 * `ChoreographyParams` from the `reachy/control` channel itself (the
 * ws_bridge fans every publish out to all subscribers, including the
 * publisher — see `_mount_ws_bridge` — so this stays correct regardless of
 * whether a `ParameterController` widget or a button published the
 * update), and exposes `publishControl` for sending commands/param updates.
 */
export function useReachy() {
  const state = useChannel<ReachyState>("reachy/state");
  const log = useChannel<ReachyLog>("reachy/log");
  const control = useChannel<ReachyControlPayload>("reachy/control");
  const frame = useChannel<ReachyFrame>("reachy/frame");
  const telemetryHistory = useChannelHistory<ReachyTelemetry>(
    "reachy/telemetry",
    SNAPSHOT_SIZE,
  );
  const safetyHistory = useChannelHistory<ReachySafety>("reachy/safety", SNAPSHOT_SIZE);

  // The backend starts in the aggressive preset by design (the broken-state
  // demo) — mirror that here so the displayed params match on first render,
  // before any control event has arrived.
  const [params, setParams] = useState<ChoreographyParams>(AGGRESSIVE_PRESET);
  const publish = usePublish();

  useEffect(() => {
    if (!control) return;
    setParams((prev) => {
      const base =
        control.preset === "safe"
          ? SAFE_PRESET
          : control.preset === "aggressive"
            ? AGGRESSIVE_PRESET
            : prev;
      return { ...base, ...stripNonParamFields(control) };
    });
  }, [control]);

  function publishControl(payload: ReachyControlPayload): void {
    publish("reachy/control", payload);
  }

  return { state, log, frame, telemetryHistory, safetyHistory, params, publishControl };
}

/** Drop non-numeric-param fields before merging a control update into params. */
function stripNonParamFields(
  payload: ReachyControlPayload,
): Partial<ChoreographyParams> {
  const { command: _command, sequence: _sequence, preset: _preset, ...rest } = payload;
  return rest;
}
