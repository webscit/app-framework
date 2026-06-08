import { act, useState } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { StatusIndicatorComponent } from "./StatusIndicator";
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

function sendControlEvent(
  socket: FakeWebSocket,
  channel: string,
  status: string,
  id = "msg-1",
  timestamp = 1_000_000,
  message?: string,
): void {
  socket.receive(
    JSON.stringify({
      channel,
      headers: { message_id: id, timestamp },
      payload: message !== undefined ? { status, message } : { status },
    }),
  );
}

describe("StatusIndicatorComponent", () => {
  it('renders "Unknown" badge when no event has arrived', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it('renders "Running" badge with running modifier when status is "running"', async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "running", "msg-1");
    });

    expect(
      document.querySelector(".sct-StatusIndicator-badge--running"),
    ).not.toBeNull();
    expect(
      document.querySelector(".sct-StatusIndicator-badge--running")?.textContent,
    ).toContain("Running");
  });

  it('renders "Paused" badge with paused modifier when status is "paused"', async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "paused", "msg-1");
    });

    expect(document.querySelector(".sct-StatusIndicator-badge--paused")).not.toBeNull();
  });

  it('renders "Converged" badge with converged modifier when status is "converged"', async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "converged", "msg-1");
    });

    expect(
      document.querySelector(".sct-StatusIndicator-badge--converged"),
    ).not.toBeNull();
  });

  it('renders "Failed" badge with failed modifier when status is "failed"', async () => {
    const socket = new FakeWebSocket();

    await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "failed", "msg-1");
    });

    expect(document.querySelector(".sct-StatusIndicator-badge--failed")).not.toBeNull();
  });

  it("updates badge when a second event arrives with a different status", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "running", "msg-1");
    });

    await expect.element(screen.getByText(/Running/)).toBeInTheDocument();

    await act(async () => {
      sendControlEvent(socket, "control/sim", "converged", "msg-2");
    });

    await expect.element(screen.getByText(/Converged/)).toBeInTheDocument();
  });

  it("ignores event with invalid status value and logs a console warning", async () => {
    const socket = new FakeWebSocket();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "invalid-status", "msg-1");
    });

    await expect.element(screen.getByText(/Unknown/)).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("renders label text when label prop is provided", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent
          channel="control/sim"
          label="My Simulation"
          staleAfterMs={0}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText("My Simulation")).toBeInTheDocument();
  });

  it('shows "Last seen: Never" when showLastSeen is true and no event has arrived', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent
          channel="control/sim"
          showLastSeen={true}
          staleAfterMs={0}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText(/Last seen: Never/)).toBeInTheDocument();
  });

  it("shows last-seen timestamp after first event when showLastSeen is true", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent
          channel="control/sim"
          showLastSeen={true}
          staleAfterMs={0}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "running", "msg-1", Date.now() - 2000);
    });

    await expect.element(screen.getByText(/Last seen: \d+s ago/)).toBeInTheDocument();
  });

  it("hides last-seen line when showLastSeen is false", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent
          channel="control/sim"
          showLastSeen={false}
          staleAfterMs={0}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "running", "msg-1");
    });

    await expect.element(screen.getByText(/Last seen/)).not.toBeInTheDocument();
  });

  it("renders optional message text from event payload", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendControlEvent(
        socket,
        "control/sim",
        "running",
        "msg-1",
        1_000_000,
        "Iteration 42",
      );
    });

    await expect.element(screen.getByText("Iteration 42")).toBeInTheDocument();
  });

  describe("staleness detection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('transitions to "Unknown" after staleAfterMs elapses with no new event', async () => {
      vi.setSystemTime(1_000_000);
      const socket = new FakeWebSocket();

      const screen = await render(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <StatusIndicatorComponent channel="control/sim" staleAfterMs={3000} />
        </EventBusProvider>,
      );

      await act(async () => {
        socket.open();
        sendControlEvent(socket, "control/sim", "running", "msg-1", 1_000_000);
      });

      await expect.element(screen.getByText(/Running/)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });

      await expect.element(screen.getByText(/Unknown/)).toBeInTheDocument();
    });

    it("does not transition to Unknown when staleAfterMs is 0", async () => {
      vi.setSystemTime(1_000_000);
      const socket = new FakeWebSocket();

      const screen = await render(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <StatusIndicatorComponent channel="control/sim" staleAfterMs={0} />
        </EventBusProvider>,
      );

      await act(async () => {
        socket.open();
        sendControlEvent(socket, "control/sim", "running", "msg-1", 1_000_000);
      });

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      await expect.element(screen.getByText(/Running/)).toBeInTheDocument();
    });
  });

  it("resets to Unknown when channel prop changes", async () => {
    const socket = new FakeWebSocket();

    function Wrapper() {
      const [channel, setChannel] = useState("control/sim");
      return (
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <button onClick={() => setChannel("control/other")}>switch</button>
          <StatusIndicatorComponent channel={channel} staleAfterMs={0} />
        </EventBusProvider>
      );
    }

    const screen = await render(<Wrapper />);

    await act(async () => {
      socket.open();
      sendControlEvent(socket, "control/sim", "running", "msg-1");
    });

    await expect.element(screen.getByText(/Running/)).toBeInTheDocument();

    await screen.getByRole("button", { name: "switch" }).click();

    await expect.element(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  describe("unmount cleanup", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("unsubscribes and clears interval on unmount", async () => {
      const socket = new FakeWebSocket();

      const screen = await render(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <StatusIndicatorComponent channel="control/sim" staleAfterMs={3000} />
        </EventBusProvider>,
      );

      await act(async () => {
        socket.open();
        sendControlEvent(socket, "control/sim", "running", "msg-1", 1_000_000);
      });

      screen.unmount();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
    });
  });
});
