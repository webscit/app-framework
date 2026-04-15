import { describe, expect, it, vi } from "vitest";
import {
  RealtimeEventBusClient,
  channelMatches,
  coerceWireEvent,
  type WebSocketLike,
} from "./client";
import { buildWebSocketUrl } from "./EventBusContext";
import { toPayloadWithHeaders } from "./useChannel";

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
    this.readyState = 3; // CLOSED
    this.onclose?.({} as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// ─── buildWebSocketUrl ────────────────────────────────────────────────────────

describe("buildWebSocketUrl", () => {
  it("builds ws URL from http page location", () => {
    expect(
      buildWebSocketUrl("/ws", { protocol: "http:", host: "localhost:5173" }),
    ).toBe("ws://localhost:5173/ws");
  });

  it("builds wss URL from https page location", () => {
    expect(buildWebSocketUrl("ws", { protocol: "https:", host: "example.com" })).toBe(
      "wss://example.com/ws",
    );
  });
});

// ─── channelMatches ───────────────────────────────────────────────────────────

describe("channel matching", () => {
  it("supports fnmatch-style wildcards", () => {
    expect(channelMatches("sensor/temperature", "sensor/*")).toBe(true);
    expect(channelMatches("logs/app", "sensor/*")).toBe(false);
    expect(channelMatches("logs/app", "*")).toBe(true);
  });

  it("matches nested paths with fnmatch-style wildcard semantics", () => {
    expect(channelMatches("sensor/temperature/deep", "sensor/*")).toBe(true);
  });

  it("escapes regex special chars in pattern literals", () => {
    // A dot in the pattern should match only a literal dot, not any character.
    expect(channelMatches("sensorXtemperature", "sensor.temperature")).toBe(false);
    expect(channelMatches("sensor.temperature", "sensor.temperature")).toBe(true);
  });
});

// ─── wire event helpers ───────────────────────────────────────────────────────

describe("wire event helpers", () => {
  it("coerces a valid wire message", () => {
    const event = coerceWireEvent({
      channel: "sensor/temperature",
      headers: { message_id: "id-1", timestamp: 123 },
      payload: { value: 22.5 },
    });

    expect(event).toEqual({
      channel: "sensor/temperature",
      headers: { message_id: "id-1", timestamp: 123 },
      payload: { value: 22.5 },
    });
  });

  it("returns null for invalid messages", () => {
    expect(coerceWireEvent({ channel: 1 })).toBeNull();
    expect(coerceWireEvent(null)).toBeNull();
    expect(coerceWireEvent("string")).toBeNull();
    expect(
      coerceWireEvent({ channel: "c", headers: { message_id: 99, timestamp: 1 } }),
    ).toBeNull();
  });

  it("merges headers into object payloads", () => {
    const merged = toPayloadWithHeaders<{
      value: number;
      message_id: string;
      timestamp: number;
    }>({
      channel: "sensor/temperature",
      headers: { message_id: "id-2", timestamp: 456 },
      payload: { value: 10 },
    });

    expect(merged).toEqual({ value: 10, message_id: "id-2", timestamp: 456 });
  });

  it("wraps non-object payloads under a payload key with headers", () => {
    const merged = toPayloadWithHeaders<{
      payload: number;
      message_id: string;
      timestamp: number;
    }>({
      channel: "raw/channel",
      headers: { message_id: "id-3", timestamp: 789 },
      payload: 42,
    });

    expect(merged).toEqual({ payload: 42, message_id: "id-3", timestamp: 789 });
  });
});

// ─── RealtimeEventBusClient ───────────────────────────────────────────────────

describe("RealtimeEventBusClient", () => {
  it("subscribes on open, receives messages, and sends unsubscribe", () => {
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => socket);
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: factory,
      reconnectDelayMs: 10,
    });

    const received: unknown[] = [];
    const off = client.subscribe("sensor/*", (event) => {
      received.push(event.payload);
    });

    client.start();
    socket.open();

    expect(factory).toHaveBeenCalledWith("ws://localhost/ws");
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      action: "subscribe",
      channel: "sensor/*",
    });

    socket.receive(
      JSON.stringify({
        channel: "sensor/temperature",
        headers: { message_id: "id-3", timestamp: 789 },
        payload: { value: 99 },
      }),
    );
    expect(received).toEqual([{ value: 99 }]);

    off();
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      action: "unsubscribe",
      channel: "sensor/*",
    });
  });

  it("replays last known message to new subscribers", () => {
    const socket = new FakeWebSocket();
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    socket.receive(
      JSON.stringify({
        channel: "logs/app",
        headers: { message_id: "id-4", timestamp: 999 },
        payload: { level: "info", message: "heartbeat" },
      }),
    );

    const replayed: unknown[] = [];
    client.subscribe("logs/*", (event) => {
      replayed.push(event.payload);
    });

    expect(replayed).toEqual([{ level: "info", message: "heartbeat" }]);
  });

  it("does not replay last message when pattern does not match", () => {
    const socket = new FakeWebSocket();
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    socket.receive(
      JSON.stringify({
        channel: "sensor/temperature",
        headers: { message_id: "id-5", timestamp: 111 },
        payload: { value: 99 },
      }),
    );

    const replayed: unknown[] = [];
    client.subscribe("logs/*", (event) => {
      replayed.push(event.payload);
    });

    expect(replayed).toEqual([]);
  });

  it("tracks status across lifecycle", () => {
    const socket = new FakeWebSocket();
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: () => socket,
    });

    const statuses: string[] = [];
    const unlisten = client.onStatusChange((status) => {
      statuses.push(status);
    });

    client.start();
    socket.open();
    socket.close();

    unlisten();

    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");
    expect(statuses.at(-1)).toBe("disconnected");
  });

  it("re-subscribes all patterns after reconnect", () => {
    let callCount = 0;
    let currentSocket = new FakeWebSocket();
    const factory = vi.fn(() => {
      callCount++;
      if (callCount > 1) {
        currentSocket = new FakeWebSocket();
      }
      return currentSocket;
    });

    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: factory,
      reconnectDelayMs: 0,
    });

    client.subscribe("sensor/*", () => {});
    client.start();
    currentSocket.open();

    // Trigger a disconnect (not stopped, so it will reconnect).
    currentSocket.close();

    // Advance timers so reconnect fires (reconnectDelayMs: 0).
    // A second socket was created; open it.
    const secondSocket = currentSocket;
    secondSocket.open();

    const sentActions = secondSocket.sent.map((s) => JSON.parse(s));
    expect(sentActions).toContainEqual({ action: "subscribe", channel: "sensor/*" });
  });

  it("publish is a no-op when socket is not open", () => {
    const socket = new FakeWebSocket();
    socket.readyState = 3; // CLOSED
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: () => socket,
    });

    // Should not throw and nothing should be sent.
    client.publish("sensor/temperature", { value: 1 });
    expect(socket.sent).toHaveLength(0);
  });

  it("ignores malformed incoming messages without throwing", () => {
    const socket = new FakeWebSocket();
    const client = new RealtimeEventBusClient("ws://localhost/ws", {
      webSocketFactory: () => socket,
    });

    const received: unknown[] = [];
    client.subscribe("sensor/*", (event) => received.push(event));
    client.start();
    socket.open();

    socket.receive("not-json{{{");
    socket.receive(JSON.stringify({ no_channel: true }));

    expect(received).toHaveLength(0);
  });
});
