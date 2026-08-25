import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { ComponentType } from "react";
import type { WebSocketLike } from "@app-framework/core-ui";

import { STABILITY_STATUS } from "./StabilityStatusWidget";

class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState = FakeWebSocket.OPEN;
  public readonly sent: string[] = [];

  send(): void {}
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

const StabilityStatus = STABILITY_STATUS.factory({ parameters: {} }) as ComponentType;

async function renderWidget() {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <StabilityStatus />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

describe("StabilityStatus widget", () => {
  it("is registered for the main region", () => {
    expect(STABILITY_STATUS.name).toBe("StabilityStatus");
    expect(STABILITY_STATUS.defaultRegion).toBe("main");
  });

  it("shows an idle placeholder before the first assessment", async () => {
    await renderWidget();
    await expect.element(page.getByText(/start a run to assess/i)).toBeInTheDocument();
  });

  it("reflects a violation from drone/stability", async () => {
    const { socket } = await renderWidget();

    act(() =>
      socket.deliver("drone/stability", {
        segment: 2,
        peak_tilt_deg: 41.2,
        settling_time_s: 7.0,
        overshoot_pct: 10,
        tilt_margin_deg: -6.2,
        settling_margin_s: -1.0,
        status: "violation",
        violated: ["tilt", "settling"],
        warnings: [],
      }),
    );

    await expect.element(page.getByText("STABILITY VIOLATION")).toBeInTheDocument();
    await expect.element(page.getByText(/tilt and settling/)).toBeInTheDocument();
  });
});
