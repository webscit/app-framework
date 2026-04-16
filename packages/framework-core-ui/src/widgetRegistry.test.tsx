import React, { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBusProvider } from "./EventBusContext";
import type { WebSocketLike } from "./client";
import { useWidgetRegistry } from "./useWidgetRegistry";
import { useWidgetsByStream } from "./useWidgetsByStream";
import { type WidgetDefinition, WidgetRegistry } from "./widgetRegistry";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWidget(name: string, stream = "data"): WidgetDefinition {
  return {
    name,
    description: `Test widget ${name}`,
    stream,
    consumes: "text/plain",
    capabilities: ["test", "scrollable"],
    parameters: { maxItems: { type: "integer", default: 50 } },
    component: `./src/widgets/${name}.tsx`,
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

  it("unregister existing widget removes it", () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("Alpha"));
    registry.unregister("Alpha");
    expect(registry.get("Alpha")).toBeUndefined();
  });

  it("unregister missing name throws Error", () => {
    const registry = new WidgetRegistry();
    expect(() => registry.unregister("NonExistent")).toThrow(
      "Widget 'NonExistent' is not registered",
    );
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

  it("findByCapability returns matching widgets and [] when no match", () => {
    const registry = new WidgetRegistry();
    const w1: WidgetDefinition = {
      ...makeWidget("W1"),
      capabilities: ["log-viewer", "scrollable"],
    };
    const w2: WidgetDefinition = {
      ...makeWidget("W2"),
      capabilities: ["chart"],
    };
    registry.register(w1);
    registry.register(w2);
    expect(registry.findByCapability("log-viewer")).toContainEqual(w1);
    expect(registry.findByCapability("log-viewer")).not.toContainEqual(w2);
    expect(registry.findByCapability("missing-tag")).toEqual([]);
  });

  it("findByStream returns matching widgets and [] when no match", () => {
    const registry = new WidgetRegistry();
    const logW = makeWidget("LogW", "log");
    const dataW = makeWidget("DataW", "data");
    registry.register(logW);
    registry.register(dataW);
    expect(registry.findByStream("log")).toContainEqual(logW);
    expect(registry.findByStream("log")).not.toContainEqual(dataW);
    expect(registry.findByStream("control")).toEqual([]);
  });

  it("findByMime returns matching widgets and [] when no match", () => {
    const registry = new WidgetRegistry();
    const w1: WidgetDefinition = { ...makeWidget("W1"), consumes: "text/plain" };
    const w2: WidgetDefinition = {
      ...makeWidget("W2"),
      consumes: "application/x-control+json",
    };
    registry.register(w1);
    registry.register(w2);
    expect(registry.findByMime("text/plain")).toContainEqual(w1);
    expect(registry.findByMime("text/plain")).not.toContainEqual(w2);
    expect(registry.findByMime("model/gltf+json")).toEqual([]);
  });
});

// ─── React hook tests ─────────────────────────────────────────────────────────

describe("widget hooks", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:5173" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useWidgetRegistry returns all registered widgets", () => {
    const socket = new FakeWebSocket();
    const noFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgetRegistry();
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket} fetchFn={noFetch}>
          <Probe />
        </EventBusProvider>,
      );
    });

    // Defaults are registered on init — seen should already have them.
    const latest = seen.at(-1)!;
    expect(latest.map((w) => w.name)).toContain("LogViewer");
    expect(latest.map((w) => w.name)).toContain("StatusIndicator");
  });

  it("useWidgetsByStream returns widgets filtered by stream", () => {
    const socket = new FakeWebSocket();
    const noFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgetsByStream("log");
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket} fetchFn={noFetch}>
          <Probe />
        </EventBusProvider>,
      );
    });

    const latest = seen.at(-1)!;
    // LogViewer has stream="log"; StatusIndicator has stream="control".
    expect(latest.map((w) => w.name)).toContain("LogViewer");
    expect(latest.map((w) => w.name)).not.toContain("StatusIndicator");
  });

  it("EventBusProvider hydrates registry from GET /api/widgets on connect", async () => {
    const socket = new FakeWebSocket();
    const extra = makeWidget("ExtraWidget", "data");
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([extra]),
    });

    const seen: WidgetDefinition[][] = [];

    function Probe(): JSX.Element | null {
      const widgets = useWidgetRegistry();
      useEffect(() => {
        seen.push(widgets);
      }, [widgets]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider
          path="/ws"
          webSocketFactory={() => socket}
          fetchFn={mockFetch}
        >
          <Probe />
        </EventBusProvider>,
      );
    });

    // Trigger connect → should fire fetch
    await act(async () => {
      socket.open();
      // Flush promise microtasks for the fetch chain
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:5173/api/widgets");
    const latest = seen.at(-1)!;
    expect(latest.map((w) => w.name)).toContain("ExtraWidget");
  });
});
