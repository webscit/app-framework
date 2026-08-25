import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { WebSocketLike } from "@app-framework/core-ui";

import { useDrone } from "./useDrone";

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
  close(): void {}
  open(): void {
    this.onopen?.({} as Event);
  }
  deliver(channel: string, payload: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify({
        channel,
        headers: { message_id: "m", timestamp: Date.now() },
        payload,
      }),
    } as MessageEvent);
  }
}

/** Renders the hook's derived params so tests can read them from the DOM. */
function Probe() {
  const { params, state } = useDrone();
  return (
    <div>
      <span>step:{params.setpoint_step_m}</span>
      <span>phase:{state?.phase ?? "none"}</span>
    </div>
  );
}

async function renderHook() {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <Probe />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

function published(socket: FakeWebSocket): Record<string, unknown>[] {
  return socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((m) => m.action === "publish" && m.channel === "drone/control")
    .map((m) => m.payload as Record<string, unknown>);
}

describe("useDrone", () => {
  it("auto-publishes a start command once on connect", async () => {
    const { socket } = await renderHook();
    await expect.element(page.getByText("phase:none")).toBeInTheDocument();
    expect(published(socket)).toContainEqual({ command: "start" });
  });

  it("derives params from the drone/control echo", async () => {
    const { socket } = await renderHook();

    act(() => socket.deliver("drone/control", { preset: "gentle" }));

    // Gentle preset's setpoint step is 1.5 m.
    await expect.element(page.getByText("step:1.5")).toBeInTheDocument();
  });
});
