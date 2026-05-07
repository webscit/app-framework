import React, { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { LogViewerComponent } from "./LogViewer";
import type { WebSocketLike } from "../../client";

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

describe("LogViewerComponent", () => {
  it('renders "No logs yet" when no events have arrived', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText("No logs yet")).toBeInTheDocument();
  });

  it("displays log lines when channel emits events", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "hello world", "msg-1");
    });

    await expect.element(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("trims oldest lines when maxLines is exceeded", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" maxLines={2} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "line-one", "msg-1");
      sendLogEvent(socket, "log/app", "line-two", "msg-2");
      sendLogEvent(socket, "log/app", "line-three", "msg-3");
    });

    await expect.element(screen.getByText("line-two")).toBeInTheDocument();
    await expect.element(screen.getByText("line-three")).toBeInTheDocument();
    await expect.element(screen.getByText("line-one")).not.toBeInTheDocument();
  });

  it("shows timestamps when showTimestamps is true", async () => {
    const socket = new FakeWebSocket();
    const knownTimestamp = 0;

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" showTimestamps={true} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "with-ts", "msg-1", knownTimestamp);
    });

    await expect
      .element(screen.getByText(/1970-01-01T00:00:00\.000Z/))
      .toBeInTheDocument();
  });

  it("hides timestamps when showTimestamps is false", async () => {
    const socket = new FakeWebSocket();
    const knownTimestamp = 0;

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" showTimestamps={false} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "no-ts", "msg-1", knownTimestamp);
    });

    await expect.element(screen.getByText("no-ts")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/1970-01-01T00:00:00\.000Z/))
      .not.toBeInTheDocument();
  });

  it("uses pre-wrap style when wrapLines is true", async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" wrapLines={true} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "a long line that might wrap", "msg-1");
    });

    expect(document.querySelector(".sct-LogViewer-line--wrap")).not.toBeNull();
  });

  it("uses pre (no-wrap) style when wrapLines is false", async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <LogViewerComponent channel="log/app" wrapLines={false} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendLogEvent(socket, "log/app", "a long line", "msg-1");
    });

    expect(document.querySelector(".sct-LogViewer-line--wrap")).toBeNull();
  });
});
