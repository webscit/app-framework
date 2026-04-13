import { useEffect, useRef, useState } from "react";

type DataMsg = { stream: "data"; channel: string; value: number; t: number };
type LogMsg = { stream: "log"; text: string };
type ControlMsg = { stream: "control"; event: string };
type WireMsg = DataMsg | LogMsg | ControlMsg;

export interface SimulationState {
  channels: Record<string, number[]>;
  logs: string[];
  status: "idle" | "running" | "stopped" | "error";
}

export function useSimulation(url: string): SimulationState {
  const [channels, setChannels] = useState<Record<string, number[]>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<SimulationState["status"]>("idle");
  const hasReceivedData = useRef(false);

  useEffect(() => {
    let ws: WebSocket;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setStatus((prev) => (prev === "error" ? "idle" : prev));
      };

      ws.onmessage = ({ data }) => {
        const msg: WireMsg = JSON.parse(data as string);
        console.debug("simulation-message", msg);

        if (msg.stream === "data") {
          hasReceivedData.current = true;
          setChannels((prev) => ({
            ...prev,
            [msg.channel]: [...(prev[msg.channel] ?? []).slice(-200), msg.value],
          }));
          setStatus("running");
        } else if (msg.stream === "log") {
          setLogs((prev) => [...prev.slice(-200), msg.text]);
        } else if (msg.stream === "control") {
          setStatus(msg.event === "run_started" ? "running" : "stopped");
        }
      };

      ws.onerror = () => {
        if (!hasReceivedData.current) {
          setStatus("error");
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // reconnect after 1 second
        setTimeout(connect, 1000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [url]);

  return { channels, logs, status };
}
