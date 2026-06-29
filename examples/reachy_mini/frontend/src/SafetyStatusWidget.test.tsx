import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { ComponentType } from "react";
import type { WebSocketLike } from "@app-framework/core-ui";

import { SAFETY_STATUS } from "./SafetyStatusWidget";

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

const SafetyStatus = SAFETY_STATUS.factory({ parameters: {} }) as ComponentType;

async function renderWidget() {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <SafetyStatus />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

describe("SafetyStatus widget", () => {
  it("is registered for the main region", () => {
    expect(SAFETY_STATUS.name).toBe("SafetyStatus");
    expect(SAFETY_STATUS.defaultRegion).toBe("main");
  });

  it("shows an idle placeholder before any safety event", async () => {
    await renderWidget();
    await expect
      .element(page.getByText(/start a run to begin checking/i))
      .toBeInTheDocument();
  });

  it("announces a violation with the offending axes", async () => {
    const { socket } = await renderWidget();

    act(() =>
      socket.deliver("reachy/safety", {
        step: 0,
        loop: 1,
        roll_margin_deg: -2,
        z_margin_mm: 5,
        duration_margin_s: 0.1,
        status: "violation",
        violated_axes: ["roll", "z"],
        warning_axes: [],
      }),
    );

    await expect.element(page.getByText("SAFETY VIOLATION")).toBeInTheDocument();
    await expect.element(page.getByText(/roll and z/)).toBeInTheDocument();
  });

  it("shows the safe state when all limits pass", async () => {
    const { socket } = await renderWidget();

    act(() =>
      socket.deliver("reachy/safety", {
        step: 0,
        loop: 1,
        roll_margin_deg: 20,
        z_margin_mm: 15,
        duration_margin_s: 0.7,
        status: "ok",
        violated_axes: [],
        warning_axes: [],
      }),
    );

    await expect
      .element(page.getByText("All steps within safe limits"))
      .toBeInTheDocument();
  });
});
