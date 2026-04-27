import React, { useEffect } from "react";
import { render, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "./EventBusContext";
import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";
import type { WebSocketLike } from "./client";
import { useWidgetRegistry } from "./useWidgetRegistry";
import { useWidgets } from "./useWidgets";
import { type WidgetDefinition, WidgetRegistry } from "./widgetRegistry";

function makeWidget(name: string, channelPattern = "data/*"): WidgetDefinition {
  return {
    name,
    description: `Test widget ${name}`,
    channelPattern,
    consumes: ["text/plain"],
    priority: 10,
    parameters: { maxItems: { type: "integer", default: 50 } },
    factory: () => () => null,
  };
}

class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState = FakeWebSocket.OPEN;
  public readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({} as CloseEvent);
  }
  open(): void {
    this.onopen?.({} as Event);
  }
  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// ─── WidgetRegistry unit tests ────────────────────────────────────────────────

describe("WidgetRegistry", () => {
  it("register then get returns the widget", () => {
    const registry = new WidgetRegistry();
    const w = makeWidget("Alpha");
    registry.register(w);
    expect(registry.get("Alpha")).toEqual(w);
  });

  it("register duplicate name throws Error", () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("Alpha"));
    expect(() => registry.register(makeWidget("Alpha"))).toThrow(
      "Widget 'Alpha' is already registered",
    );
  });

  it("dispose handle removes the widget", () => {
    const registry = new WidgetRegistry();
    const handle = registry.register(makeWidget("Alpha"));
    handle.dispose();
    expect(registry.get("Alpha")).toBeUndefined();
  });

  it("disposing twice is idempotent", () => {
    const registry = new WidgetRegistry();
    const handle = registry.register(makeWidget("Alpha"));
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(registry.list()).toEqual([]);
  });

  it("list returns all registered widgets", () => {
    const registry = new WidgetRegistry();
    const a = makeWidget("Alpha");
    const b = makeWidget("Beta");
    registry.register(a);
    registry.register(b);
    const result = registry.list();
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(b);
  });

  it("list returns [] when empty", () => {
    expect(new WidgetRegistry().list()).toEqual([]);
  });

  it("findByMime returns matching widgets and [] when no match", () => {
    const registry = new WidgetRegistry();
    const w1: WidgetDefinition = { ...makeWidget("W1"), consumes: ["text/plain"] };
    const w2: WidgetDefinition = {
      ...makeWidget("W2"),
      consumes: ["application/x-control+json"],
    };
    registry.register(w1);
    registry.register(w2);
    expect(registry.findByMime("text/plain")).toContainEqual(w1);
    expect(registry.findByMime("text/plain")).not.toContainEqual(w2);
    expect(registry.findByMime("model/gltf+json")).toEqual([]);
  });

  it("findByChannel returns matching widgets and [] when no match", () => {
    const registry = new WidgetRegistry();
    const logW: WidgetDefinition = { ...makeWidget("LogW"), channelPattern: "log/*" };
    const dataW: WidgetDefinition = {
      ...makeWidget("DataW"),
      channelPattern: "data/*",
    };
    registry.register(logW);
    registry.register(dataW);
    expect(registry.findByChannel("log/app")).toContainEqual(logW);
    expect(registry.findByChannel("log/app")).not.toContainEqual(dataW);
    expect(registry.findByChannel("control/status")).toEqual([]);
  });

  it("resolveWidgets: channel match first, mimeType refines", () => {
    const registry = new WidgetRegistry();
    const logText: WidgetDefinition = {
      ...makeWidget("LogText"),
      channelPattern: "log/*",
      consumes: ["text/plain"],
    };
    const logJson: WidgetDefinition = {
      ...makeWidget("LogJson"),
      channelPattern: "log/*",
      consumes: ["application/json"],
    };
    const dataWidget: WidgetDefinition = {
      ...makeWidget("Data"),
      channelPattern: "data/*",
      consumes: ["text/plain"],
    };
    registry.register(logText);
    registry.register(logJson);
    registry.register(dataWidget);

    const allLog = registry.resolveWidgets("log/app");
    expect(allLog.map((w) => w.name)).toContain("LogText");
    expect(allLog.map((w) => w.name)).toContain("LogJson");
    expect(allLog.map((w) => w.name)).not.toContain("Data");

    const refined = registry.resolveWidgets("log/app", "text/plain");
    expect(refined.map((w) => w.name)).toContain("LogText");
    expect(refined.map((w) => w.name)).not.toContain("LogJson");
    expect(refined.map((w) => w.name)).not.toContain("Data");
  });

  it("resolveWidgets: returns [] when mimeType provided but no channel-match has it", () => {
    const registry = new WidgetRegistry();
    const logJson: WidgetDefinition = {
      ...makeWidget("LogJson"),
      channelPattern: "log/*",
      consumes: ["application/json"],
    };
    registry.register(logJson);
    expect(registry.resolveWidgets("log/app", "text/plain")).toEqual([]);
  });
});

// ─── React hook tests ─────────────────────────────────────────────────────────

describe("widget hooks", () => {
  it("useWidgetRegistry returns all registered widgets", () => {
    const registry = new WidgetRegistry();
    registry.register(LOG_VIEWER);
    registry.register(STATUS_INDICATOR);
    const socket = new FakeWebSocket();
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgetRegistry();
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    render(
      <WidgetRegistryContext.Provider value={registry}>
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>
      </WidgetRegistryContext.Provider>,
    );

    const latest = seen.at(-1)!;
    expect(latest.map((w) => w.name)).toContain("LogViewer");
    expect(latest.map((w) => w.name)).toContain("StatusIndicator");
  });

  it("useWidgets resolves widgets by channel", () => {
    const registry = new WidgetRegistry();
    registry.register(LOG_VIEWER);
    registry.register(STATUS_INDICATOR);
    const socket = new FakeWebSocket();
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgets("log/app");
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    render(
      <WidgetRegistryContext.Provider value={registry}>
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>
      </WidgetRegistryContext.Provider>,
    );

    const latest = seen.at(-1)!;
    expect(latest.map((w) => w.name)).toContain("LogViewer");
    expect(latest.map((w) => w.name)).not.toContain("StatusIndicator");
  });

  it("useWidgets re-renders when a widget is registered after mount", () => {
    const registry = new WidgetRegistry();
    const socket = new FakeWebSocket();
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgets("log/app");
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    render(
      <WidgetRegistryContext.Provider value={registry}>
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>
      </WidgetRegistryContext.Provider>,
    );

    expect(seen.at(-1)).toEqual([]);

    act(() => {
      registry.register(LOG_VIEWER);
    });

    expect(seen.at(-1)!.map((w) => w.name)).toContain("LogViewer");
  });

  it("useWidgets refines by mimeType when provided", () => {
    const registry = new WidgetRegistry();
    registry.register(LOG_VIEWER);
    registry.register(STATUS_INDICATOR);
    const socket = new FakeWebSocket();
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgets("log/app", "text/plain");
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    render(
      <WidgetRegistryContext.Provider value={registry}>
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>
      </WidgetRegistryContext.Provider>,
    );

    const latest = seen.at(-1)!;
    expect(latest.map((w) => w.name)).toContain("LogViewer");
    expect(latest.map((w) => w.name)).not.toContain("StatusIndicator");
  });
});
