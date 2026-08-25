import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { ComponentType } from "react";
import type { WebSocketLike } from "@app-framework/core-ui";

import { RUN_CONTROLS } from "./RunControlsWidget";

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

const RunControls = RUN_CONTROLS.factory({ parameters: {} }) as ComponentType;

async function renderWidget() {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <RunControls />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

function published(socket: FakeWebSocket): Record<string, unknown>[] {
  return socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((m) => m.action === "publish" && m.channel === "reachy/control")
    .map((m) => m.payload as Record<string, unknown>);
}

describe("RunControls widget", () => {
  it("is registered for the header region", () => {
    expect(RUN_CONTROLS.name).toBe("RunControls");
    expect(RUN_CONTROLS.defaultRegion).toBe("header");
  });

  it("publishes a start command to reachy/control", async () => {
    const { socket } = await renderWidget();

    await page.getByRole("button", { name: "Start choreography run" }).click();

    expect(published(socket)).toContainEqual({ command: "start" });
  });

  it("publishes a preset selection to reachy/control", async () => {
    const { socket } = await renderWidget();

    await page.getByRole("button", { name: "Apply safe preset" }).click();

    expect(published(socket)).toContainEqual({ preset: "safe" });
  });

  it("reflects the run phase/verdict from reachy/state", async () => {
    const { socket } = await renderWidget();

    act(() =>
      socket.deliver("reachy/state", {
        phase: "done",
        verdict: "PASS",
        message: "ok",
      }),
    );

    await expect.element(page.getByText("Done (PASS)")).toBeInTheDocument();
  });
});
