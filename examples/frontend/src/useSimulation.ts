import { useChannel } from "@app-framework/core-ui";
import type { BaseEvent } from "@app-framework/core-ui";

/**
 * Sine wave sample published to the ``data/sine`` channel every 100 ms
 * by ``examples/backend/producers.py``.
 */
interface SineReading extends BaseEvent {
  value: number;
}

/**
 * Heartbeat log entry published to the ``logs/app`` channel every second
 * by ``examples/backend/producers.py``.
 */
interface LogEntry extends BaseEvent {
  level: string;
  message: string;
}

/**
 * Example-app hook that wires up the two demo channels.
 *
 * Lives in ``examples/`` — not part of the framework itself.
 */
export function useSimulation() {
  const sine = useChannel<SineReading>("data/sine");
  const log = useChannel<LogEntry>("logs/app");

  return { sine, log };
}
