import { useEffect, useState } from "react";
import { useEventBusClient } from "./EventBusContext";
import type { ConnectionStatus } from "./client";

/**
 * Returns the current websocket connection state for the shared event bus.
 *
 * @returns One of `"connecting"`, `"connected"`, or `"disconnected"`.
 * @example
 * ```tsx
 * const status = useEventBusStatus();
 * return <span>Bus: {status}</span>;
 * ```
 */
export function useEventBusStatus(): ConnectionStatus {
  const client = useEventBusClient();
  const [status, setStatus] = useState<ConnectionStatus>(client.getStatus());

  useEffect(() => {
    return client.onStatusChange(setStatus);
  }, [client]);

  return status;
}
