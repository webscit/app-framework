import { act } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { ParameterControllerComponent } from "./ParameterController";
import type { ParameterConfig } from "./ParameterController";
import type { WebSocketLike } from "../../client";

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
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SLIDER_PARAM: ParameterConfig = {
  title: "Time Step",
  type: "number",
  minimum: 0,
  maximum: 1,
  multipleOf: 0.01,
  default: 0.1,
  "x-options": { widget: "slider" },
};

const INPUT_PARAM: ParameterConfig = {
  title: "Max Iterations",
  type: "number",
  minimum: 1,
  maximum: 10000,
  multipleOf: 1,
  default: 500,
  "x-options": { widget: "input" },
};

const SELECT_PARAM: ParameterConfig = {
  title: "Solver",
  type: "string",
  enum: ["euler", "rk4", "adams"],
  default: "rk4",
  "x-options": { widget: "select" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function renderController(
  params?: Record<string, ParameterConfig>,
  channel = "params/control",
  debounceMs = 0,
) {
  const socket = new FakeWebSocket();
  await render(
    <EventBusProvider path="/ws" webSocketFactory={() => socket}>
      <ParameterControllerComponent
        channel={channel}
        parameters={params}
        debounceMs={debounceMs}
      />
    </EventBusProvider>,
  );
  act(() => socket.open());
  return { socket };
}

function getPublishedPayloads(socket: FakeWebSocket): Record<string, unknown>[] {
  return socket.sent
    .map((raw) => JSON.parse(raw))
    .filter((msg) => msg.channel === "params/control")
    .map((msg) => msg.payload as Record<string, unknown>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ParameterControllerComponent", () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  it("renders empty placeholder when parameters is undefined", async () => {
    await renderController(undefined);
    await expect.element(page.getByText("No parameters configured")).toBeVisible();
  });

  it("renders empty placeholder when parameters is {}", async () => {
    await renderController({});
    await expect.element(page.getByText("No parameters configured")).toBeVisible();
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it("renders slider for x-options widget: slider", async () => {
    await renderController({ timestep: SLIDER_PARAM });
    expect(page.getByRole("group", { name: "Time Step" }).query()).not.toBeNull();
  });

  it("renders number input for x-options widget: input", async () => {
    await renderController({ max_iterations: INPUT_PARAM });
    await expect.element(page.getByLabelText("Max Iterations")).toBeVisible();
  });

  it("renders select for x-options widget: select", async () => {
    await renderController({ solver: SELECT_PARAM });
    await expect.element(page.getByLabelText("Solver")).toBeVisible();
  });

  it("renders label for each parameter", async () => {
    await renderController({ timestep: SLIDER_PARAM });
    await expect.element(page.getByText("Time Step")).toBeVisible();
  });

  // ── Default values ──────────────────────────────────────────────────────────

  it("initialises number input with default value", async () => {
    await renderController({ max_iterations: INPUT_PARAM });
    await expect.element(page.getByLabelText("Max Iterations")).toHaveValue(500);
  });

  it("initialises select with default value", async () => {
    await renderController({ solver: SELECT_PARAM });
    await expect
      .element(page.getByRole("combobox", { name: "Solver" }))
      .toHaveTextContent("rk4");
  });

  it("displays default value for slider", async () => {
    await renderController({ timestep: SLIDER_PARAM });
    await expect.element(page.getByText("0.1")).toBeVisible();
  });

  // ── No publish on mount ──────────────────────────────────────────────────────

  it("does NOT publish on mount", async () => {
    const { socket } = await renderController({ timestep: SLIDER_PARAM });
    expect(getPublishedPayloads(socket)).toHaveLength(0);
  });

  // ── Publishing ──────────────────────────────────────────────────────────────

  it("publishes full state immediately on number input change", async () => {
    const { socket } = await renderController({
      max_iterations: INPUT_PARAM,
      solver: SELECT_PARAM,
    });

    await page.getByRole("spinbutton", { name: "Max Iterations" }).fill("200");

    const payloads = getPublishedPayloads(socket);
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[payloads.length - 1]).toMatchObject({ max_iterations: 200 });
  });

  it("published payload contains all current parameter values", async () => {
    const { socket } = await renderController({
      max_iterations: INPUT_PARAM,
      solver: SELECT_PARAM,
    });

    await page.getByRole("spinbutton", { name: "Max Iterations" }).fill("300");

    const payloads = getPublishedPayloads(socket);
    const last = payloads[payloads.length - 1];
    expect(last).toHaveProperty("max_iterations");
    expect(last).toHaveProperty("solver");
  });

  // ── Debounce ────────────────────────────────────────────────────────────────

  it("debounces publish on slider change", async () => {
    const { socket } = await renderController(
      { timestep: SLIDER_PARAM },
      "params/control",
      300,
    );

    // Base UI's SliderPrimitive.Thumb renders a visually-hidden <input type="range">
    // inside a <span role="slider">. The span has no CSS dimensions in headless tests
    // so Playwright's visibility check times out on both the group and the span.
    // The actual interactive element is the hidden <input type="range"> — we reach
    // it via querySelector on the group container and drive it with native DOM APIs
    // which bypass Playwright's visibility requirement entirely.
    const sliderGroup = page.getByRole("group", { name: "Time Step" });
    const rangeInput = sliderGroup
      .element()
      .querySelector('input[type="range"]') as HTMLInputElement | null;

    if (!rangeInput) throw new Error('Slider <input type="range"> not found in DOM');

    rangeInput.focus();
    rangeInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );

    // Debounce timer started — no publish yet
    expect(getPublishedPayloads(socket)).toHaveLength(0);

    // Wait for debounce (300ms) + buffer
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    expect(getPublishedPayloads(socket)).toHaveLength(1);
  });
});
