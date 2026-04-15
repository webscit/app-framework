import { useCallback } from "react";
import { useEventBusClient } from "./EventBusContext";

/**
 * Returns a stable callback for publishing payloads to event-bus channels.
 *
 * @returns Function that publishes `(channel, payload)` over the shared websocket.
 * @example
 * ```tsx
 * const publish = usePublish();
 * publish("commands/reset", { target: "sensor-1" });
 * ```
 */
export function usePublish(): (channel: string, payload: unknown) => void {
  const client = useEventBusClient();

  return useCallback(
    (channel: string, payload: unknown) => {
      client.publish(channel, payload);
    },
    [client],
  );
}
