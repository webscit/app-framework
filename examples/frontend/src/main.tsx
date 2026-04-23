import React from "react";
import ReactDOM from "react-dom/client";

import {
  ApplicationShell,
  EventBusProvider,
  WidgetRegistry,
  WidgetRegistryContext,
} from "@app-framework/core-ui";

import "./shell.css";

const registry = new WidgetRegistry();

function App() {
  return (
    <EventBusProvider path="/ws">
      <WidgetRegistryContext.Provider value={registry}>
        <ApplicationShell />
      </WidgetRegistryContext.Provider>
    </EventBusProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
