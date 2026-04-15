import React from "react";
import ReactDOM from "react-dom/client";

import { EventBusProvider, useEventBusStatus } from "@app-framework/core-ui";

import { useSimulation } from "./useSimulation";

function Dashboard() {
  const { sine, log } = useSimulation();
  const status = useEventBusStatus();

  return (
    <div>
      <h1>UI shell placeholder</h1>
      <p>Status: {status}</p>
      <p>Latest sine: {sine?.value?.toFixed(4) ?? "n/a"}</p>
      <p>Latest log: {log?.message ?? "n/a"}</p>
    </div>
  );
}

function App() {
  return (
    <EventBusProvider path="/ws">
      <Dashboard />
    </EventBusProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
