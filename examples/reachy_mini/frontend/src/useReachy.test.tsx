import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { WebSocketLike } from "@app-framework/core-ui";

import { useReachy, SNAPSHOT_SIZE } from "./useReachy";

// ─── FakeWebSocket ────────────────────────────────────────────────────────────
// Mirrors the pattern used by framework-core-ui's own widget tests
// (e.g. ParameterController.test.tsx) for simulating server-pushed messages.

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
  /** Simulate the backend delivering a message, in ws_bridge's wire format. */
  deliver(channel: string, payload: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify({
        channel,
        headers: { message_id: `msg-${channel}-${Date.now()}`, timestamp: Date.now() },
        payload,
      }),
    } as MessageEvent);
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────────

function Harness() {
  const { state, frame, telemetryHistory, safetyHistory, params, publishControl } =
    useReachy();

  return (
    <div>
      <div data-testid="phase">{state?.phase ?? "none"}</div>
      <div data-testid="frame">{frame?.image ?? "none"}</div>
      <div data-testid="telemetry-count">{telemetryHistory.length}</div>
      <div data-testid="safety-count">{safetyHistory.length}</div>
      <div data-testid="params">{JSON.stringify(params)}</div>
      <button onClick={() => publishControl({ command: "start" })}>start</button>
    </div>
  );
}

async function renderHarness() {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <Harness />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useReachy", () => {
  it("starts with the aggressive preset before any control event arrives", async () => {
    await renderHarness();

    const text = await page.getByTestId("params").element().textContent;
    expect(JSON.parse(text ?? "{}")).toMatchObject({ roll_amplitude_deg: 42 });
  });

  it("reflects state events on the reachy/state channel", async () => {
    const { socket } = await renderHarness();

    act(() =>
      socket.deliver("reachy/state", { phase: "running", verdict: "", message: "go" }),
    );

    await expect.element(page.getByTestId("phase")).toHaveTextContent("running");
  });

  it("exposes the latest rendered frame from the reachy/frame channel", async () => {
    const { socket } = await renderHarness();

    await expect.element(page.getByTestId("frame")).toHaveTextContent("none");

    act(() =>
      socket.deliver("reachy/frame", {
        step: 0,
        loop: 0,
        image: "data:image/jpeg;base64,AAAA",
      }),
    );

    await expect
      .element(page.getByTestId("frame"))
      .toHaveTextContent("data:image/jpeg;base64,AAAA");
  });

  it("merges a preset control event into params", async () => {
    const { socket } = await renderHarness();

    act(() => socket.deliver("reachy/control", { preset: "safe" }));

    const text = await page.getByTestId("params").element().textContent;
    expect(JSON.parse(text ?? "{}")).toMatchObject({ roll_amplitude_deg: 15 });
  });

  it("applies individual field overrides on top of a preset", async () => {
    const { socket } = await renderHarness();

    act(() =>
      socket.deliver("reachy/control", { preset: "safe", roll_amplitude_deg: 20 }),
    );

    const text = await page.getByTestId("params").element().textContent;
    const parsed = JSON.parse(text ?? "{}");
    expect(parsed.roll_amplitude_deg).toBe(20);
    expect(parsed.step_duration_s).toBe(1); // unaffected field still from preset
  });

  it("applies a bare field update without a preset", async () => {
    const { socket } = await renderHarness();

    act(() => socket.deliver("reachy/control", { num_loops: 5 }));

    const text = await page.getByTestId("params").element().textContent;
    expect(JSON.parse(text ?? "{}")).toMatchObject({ num_loops: 5 });
  });

  it("publishControl sends the payload over the socket", async () => {
    const { socket } = await renderHarness();

    await page.getByRole("button", { name: "start" }).click();

    const sent = socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    const publishMsg = sent.find(
      (m) => m.action === "publish" && m.channel === "reachy/control",
    );
    expect(publishMsg).toMatchObject({
      action: "publish",
      channel: "reachy/control",
      payload: { command: "start" },
    });
  });

  it(`caps telemetry history at ${SNAPSHOT_SIZE} entries, dropping the oldest`, async () => {
    const { socket } = await renderHarness();

    for (let i = 0; i < SNAPSHOT_SIZE + 5; i++) {
      act(() =>
        socket.deliver("reachy/telemetry", {
          step: i,
          loop: 0,
          roll_deg: i,
          z_mm: 0,
          antenna_l: 0,
          antenna_r: 0,
          duration_s: 1,
        }),
      );
    }

    await expect
      .element(page.getByTestId("telemetry-count"))
      .toHaveTextContent(String(SNAPSHOT_SIZE));
  });

  it("caps safety history independently of telemetry history", async () => {
    const { socket } = await renderHarness();

    for (let i = 0; i < SNAPSHOT_SIZE + 3; i++) {
      act(() =>
        socket.deliver("reachy/safety", {
          step: i,
          loop: 0,
          roll_margin_deg: 1,
          z_margin_mm: 1,
          duration_margin_s: 1,
          status: "ok",
          violated_axes: [],
          warning_axes: [],
        }),
      );
    }

    await expect
      .element(page.getByTestId("safety-count"))
      .toHaveTextContent(String(SNAPSHOT_SIZE));
  });
});
