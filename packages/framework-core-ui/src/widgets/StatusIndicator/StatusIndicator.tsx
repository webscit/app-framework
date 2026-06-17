import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { useEventBusClient } from "../../EventBusContext";
import type { WireEvent } from "../../client";
import "./StatusIndicator.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Source - https://stackoverflow.com/a/62900613
// Posted by Guido Dizioli
// Retrieved 2026-06-09, License - CC BY-SA 4.0
const VALID_STATUSES = ["running", "paused", "converged", "failed"] as const;

/**
 * The four valid statuses the backend can publish to a control channel.
 */
export type SimulationStatus = (typeof VALID_STATUSES)[number];

/** Internal display state, extending {@link SimulationStatus} with `"unknown"`. */
type DisplayStatus = SimulationStatus | "unknown";

/** Expected shape of the event payload on the control channel. */
interface ControlPayload {
  /** One of the four {@link SimulationStatus} values. */
  status: SimulationStatus;
  /** Optional free-form message, e.g. `"Iteration 42"`. */
  message?: string;
}

/**
 * Props for the {@link StatusIndicatorComponent}.
 *
 * All props correspond to the `parameters` schema declared in `STATUS_INDICATOR`.
 */
export interface StatusIndicatorProps {
  /**
   * EventBus channel to subscribe to. Supports glob patterns.
   * Default: `"control/*"`
   */
  channel?: string;
  /**
   * Human-readable label rendered beside the status badge.
   * Default: `"Simulation Status"`
   */
  label?: string;
  /**
   * Show the `"Last seen: <relative time>"` line below the badge.
   * Default: `true`
   */
  showLastSeen?: boolean;
  /**
   * Milliseconds of channel silence after which the widget enters the stale
   * (`"unknown"`) state. Set to `0` to disable staleness detection.
   * Default: `5000`
   */
  staleAfterMs?: number;
}

const STATUS_INDICATOR_PREFIX = "sct-StatusIndicator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidStatus(value: unknown): value is SimulationStatus {
  return (
    typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value)
  );
}

function formatRelativeTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function statusLabel(status: DisplayStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays the live run state of a simulation as a colour-coded pill badge.
 *
 * Subscribes to `channel` via {@link useEventBusClient} and renders one of
 * four statuses — `running`, `paused`, `converged`, `failed` — or `unknown`
 * when no event has arrived yet or the channel has gone silent for longer than
 * `staleAfterMs`.
 *
 * A single 1000 ms interval handles both staleness detection and the
 * last-seen string refresh. The interval and subscription are cleared on
 * unmount. When `channel` changes, state resets to `unknown`.
 *
 * Styles use CSS class names prefixed with `sct-StatusIndicator-`, defined in
 * `StatusIndicator.css`.
 *
 * @param props Component props — see {@link StatusIndicatorProps}.
 * @returns A status badge element.
 * @example
 * ```tsx
 * <StatusIndicatorComponent
 *   channel="control/sim"
 *   label="Simulation Status"
 *   showLastSeen
 *   staleAfterMs={5000}
 * />
 * ```
 */
export const StatusIndicatorComponent: ComponentType<StatusIndicatorProps> = ({
  channel = "control/*",
  label = "Simulation Status",
  showLastSeen = true,
  staleAfterMs = 5000,
}) => {
  const client = useEventBusClient();
  const [displayStatus, setDisplayStatus] = useState<DisplayStatus>("unknown");
  const [lastSeenMs, setLastSeenMs] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  /**
   * Mirrors `staleAfterMs` so the interval callback reads the latest value
   * without it being a subscription dependency.
   */
  const staleAfterMsRef = useRef(staleAfterMs);
  useEffect(() => {
    staleAfterMsRef.current = staleAfterMs;
  }, [staleAfterMs]);

  /**
   * Mirrors `lastSeenMs` so the interval reads the latest timestamp without
   * it being a dependency that would restart the interval on every event.
   */
  const lastSeenMsRef = useRef<number | null>(null);

  /**
   * Subscribe on mount; reset all state on each (re)subscription so stale
   * data from a previous channel is not shown. Resubscribes when `channel`
   * or `client` changes.
   */
  useEffect(() => {
    setDisplayStatus("unknown");
    setLastSeenMs(null);
    lastSeenMsRef.current = null;
    setMessage(null);

    return client.subscribe(channel, (event: WireEvent) => {
      const payload = event.payload as ControlPayload;
      if (!payload || typeof payload !== "object" || !isValidStatus(payload.status)) {
        console.warn(
          `[StatusIndicator] Ignored event on "${channel}": invalid status value`,
          payload?.status,
        );
        return;
      }
      const ts = event.headers.timestamp;
      setDisplayStatus(payload.status);
      setLastSeenMs(ts);
      lastSeenMsRef.current = ts;
      setMessage(payload.message ?? null);
    });
  }, [channel, client]);

  /**
   * Single interval started once on mount: checks staleness and refreshes
   * the last-seen relative time string. Only started when staleAfterMs > 0.
   * Cleared on unmount.
   */
  useEffect(() => {
    if (staleAfterMs <= 0) return;
    const id = setInterval(() => {
      if (
        lastSeenMsRef.current !== null &&
        Date.now() - lastSeenMsRef.current > staleAfterMsRef.current
      ) {
        setDisplayStatus("unknown");
      }
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []); // staleAfterMs and lastSeenMs intentionally excluded — use refs instead

  let lastSeenText: string | null = null;
  if (showLastSeen) {
    lastSeenText = lastSeenMs === null ? "Never" : formatRelativeTime(now - lastSeenMs);
  }

  return (
    <div className={`${STATUS_INDICATOR_PREFIX}-container`}>
      <div className={`${STATUS_INDICATOR_PREFIX}-row`}>
        {label && <span className={`${STATUS_INDICATOR_PREFIX}-label`}>{label}</span>}
        <span
          className={`${STATUS_INDICATOR_PREFIX}-badge ${STATUS_INDICATOR_PREFIX}-badge--${displayStatus}`}
        >
          ● {statusLabel(displayStatus)}
        </span>
      </div>
      {message && <div className={`${STATUS_INDICATOR_PREFIX}-message`}>{message}</div>}
      {showLastSeen && (
        <div className={`${STATUS_INDICATOR_PREFIX}-last-seen`}>
          Last seen: {lastSeenText}
        </div>
      )}
    </div>
  );
};
