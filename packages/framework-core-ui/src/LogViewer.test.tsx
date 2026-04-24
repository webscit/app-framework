import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBusProvider } from "./EventBusContext";
import { LogViewerComponent } from "./LogViewer";
import type { WebSocketLike } from "./client";

// ─── FakeWebSocket ────────────────────────────────────────────────────────────

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

function sendLogEvent(
  socket: FakeWebSocket,
  channel: string,
  message: string,
  id: string,
  timestamp = 1_000_000,
): void {
  socket.receive(
    JSON.stringify({
      channel,
      headers: { message_id: id, timestamp },
      payload: message,
    }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTextContent(renderer: ReactTestRenderer): string {
  return renderer.toJSON() ? JSON.stringify(renderer.toJSON()) : "";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LogViewerComponent", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:5173" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "No logs yet" when no events have arrived', () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
    });

    const text = getTextContent(renderer!);
    expect(text).toContain("No logs yet");
  });

  it("displays log lines when channel emits events", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "hello world", "msg-1");
    });

    const text = getTextContent(renderer!);
    expect(text).toContain("hello world");
  });

  it("trims oldest lines when maxLines is exceeded", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" maxLines={2} />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "line-one", "msg-1");
      sendLogEvent(socket, "log/app", "line-two", "msg-2");
      sendLogEvent(socket, "log/app", "line-three", "msg-3");
    });

    const text = getTextContent(renderer!);
    expect(text).not.toContain("line-one");
    expect(text).toContain("line-two");
    expect(text).toContain("line-three");
  });

  it("shows timestamps when showTimestamps is true", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;
    // timestamp 0 → "1970-01-01T00:00:00.000Z"
    const knownTimestamp = 0;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" showTimestamps={true} />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "with-ts", "msg-1", knownTimestamp);
    });

    const text = getTextContent(renderer!);
    expect(text).toContain("1970-01-01T00:00:00.000Z");
  });

  it("hides timestamps when showTimestamps is false", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;
    const knownTimestamp = 0;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" showTimestamps={false} />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "no-ts", "msg-1", knownTimestamp);
    });

    const text = getTextContent(renderer!);
    expect(text).not.toContain("1970-01-01T00:00:00.000Z");
    expect(text).toContain("no-ts");
  });

  it("uses pre-wrap style when wrapLines is true", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" wrapLines={true} />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "a long line that might wrap", "msg-1");
    });

    const json = renderer!.toJSON();
    const text = JSON.stringify(json);
    expect(text).toContain("sct-LogViewer-line--wrap");
  });

  it("uses pre (no-wrap) style when wrapLines is false", () => {
    const socket = new FakeWebSocket();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <LogViewerComponent channel="log/app" wrapLines={false} />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      sendLogEvent(socket, "log/app", "a long line", "msg-1");
    });

    const json = renderer!.toJSON();
    const text = JSON.stringify(json);
    // pre is the nowrap style
    expect(text).not.toContain("sct-LogViewer-line--wrap");
  });
});
