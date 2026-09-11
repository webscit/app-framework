import { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { SimulationControlsComponent } from "./SimulationControls";
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

function sendStateEvent(
  socket: FakeWebSocket,
  channel: string,
  phase: string,
  id = "msg-1",
): void {
  socket.receive(
    JSON.stringify({
      channel,
      headers: { message_id: id, timestamp: 1_000_000 },
      payload: { phase },
    }),
  );
}

describe("SimulationControlsComponent", () => {
  it("Start enabled and Stop disabled when no state event has arrived", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeDisabled();
  });

  it("Start disabled and Stop enabled when phase equals runningPhase", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "running");
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeEnabled();
  });

  it("Start stays enabled when phase differs from runningPhase", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "idle");
    });

    await expect
      .element(screen.getByRole("button", { name: "Start simulation" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Stop simulation" }))
      .toBeDisabled();
  });

  it('clicking Start publishes { command: "start" } to controlChannel', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await screen.getByRole("button", { name: "Start simulation" }).click();

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent).toEqual({
      action: "publish",
      channel: "sim/control",
      payload: { command: "start" },
    });
  });

  it('clicking Stop publishes { command: "stop" } to controlChannel', async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendStateEvent(socket, "sim/state", "running");
    });

    await screen.getByRole("button", { name: "Stop simulation" }).click();

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent).toEqual({
      action: "publish",
      channel: "sim/control",
      payload: { command: "stop" },
    });
  });

  it("renders title when provided", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <SimulationControlsComponent
          stateChannel="sim/state"
          controlChannel="sim/control"
          runningPhase="running"
          title="Drone Run"
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect.element(screen.getByText("Drone Run")).toBeInTheDocument();
  });
});
