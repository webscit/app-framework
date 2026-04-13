import React from "react";
import ReactDOM from "react-dom/client";
import { useSimulation } from "./useSimulation";

function toWebSocketUrl(): string {
  const backend = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";
  const normalized = backend.replace(/\/$/, "");
  return normalized.replace(/^http/, "ws") + "/ws";
}

function App() {
  const { channels, logs, status } = useSimulation(toWebSocketUrl());
  const latestSine = channels["sine.output"]?.at(-1);

  return (
    <div>
      <h1>UI shell placeholder</h1>
      <p>Status: {status}</p>
      <p>Latest sine.output: {latestSine?.toFixed(4) ?? "n/a"}</p>
      <p>Logs: {logs.length}</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
