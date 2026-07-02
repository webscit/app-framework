import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { EventBusProvider } from "@app-framework/core-ui";
import type { WebSocketLike } from "@app-framework/core-ui";

import { CHOREOGRAPHY_FLOW, ChoreographyFlowComponent } from "./ChoreographyFlowWidget";
import type { StepSpecPayload } from "./useReachy";

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
}

const SEQ: StepSpecPayload[] = [
  { label: "tilt_right", roll_factor: 1.0 },
  { label: "tilt_left" },
];

async function renderWidget(defaultSequence: StepSpecPayload[] = SEQ) {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <div style={{ width: 800, height: 600 }}>
        <ChoreographyFlowComponent
          channel="reachy/control"
          defaultSequence={defaultSequence}
        />
      </div>
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

/** Extract the `sequence` payloads published to reachy/control. */
function publishedSequences(socket: FakeWebSocket): StepSpecPayload[][] {
  return socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((m) => m.action === "publish" && m.channel === "reachy/control")
    .map((m) => m.payload as { sequence?: StepSpecPayload[] })
    .filter((p): p is { sequence: StepSpecPayload[] } => Array.isArray(p.sequence))
    .map((p) => p.sequence);
}

describe("ChoreographyFlow widget", () => {
  it("is registered for the main region", () => {
    expect(CHOREOGRAPHY_FLOW.name).toBe("ChoreographyFlow");
    expect(CHOREOGRAPHY_FLOW.defaultRegion).toBe("main");
  });

  it("renders the Add step and Send to robot controls", async () => {
    await renderWidget();
    await expect
      .element(page.getByRole("button", { name: "Add step" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Send to robot" }))
      .toBeInTheDocument();
  });

  it("publishes the default sequence to reachy/control on Send", async () => {
    const { socket } = await renderWidget();

    await page.getByRole("button", { name: "Send to robot" }).click();

    const sequences = publishedSequences(socket);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toEqual([
      { label: "tilt_right", roll_factor: 1, z_factor: 0, antenna_factor: 0 },
      { label: "tilt_left", roll_factor: 0, z_factor: 0, antenna_factor: 0 },
    ]);
  });

  it("adds a step so the published sequence grows by one", async () => {
    const { socket } = await renderWidget();

    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByRole("button", { name: "Send to robot" }).click();

    const sequences = publishedSequences(socket);
    expect(sequences[0]).toHaveLength(3);
  });

  it("does not publish on mount", async () => {
    const { socket } = await renderWidget();
    expect(publishedSequences(socket)).toHaveLength(0);
  });
});
