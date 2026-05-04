import { useState, useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { ChartComponent, getFieldValue, type SeriesConfig } from "./Chart";

// ---------------------------------------------------------------------------
// Mock useChannel to match its real signature: useChannel<T>(channel): T | null
//
// vi.mock factory must be synchronous — no await allowed inside it.
// We import React at the top of the file and reference it directly.
// ---------------------------------------------------------------------------

type PayloadMap = Map<string, unknown>;

let payloads: PayloadMap = new Map();
const listeners = new Map<string, Set<() => void>>();

function setPayload(channel: string, value: unknown) {
  payloads.set(channel, value);
  listeners.get(channel)?.forEach((cb) => cb());
}

vi.mock("../../useChannel", () => ({
  useChannel: (channel: string) => {
    const [value, setValue] = useState<unknown>(() => payloads.get(channel) ?? null);

    useEffect(() => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      const notify = () => setValue(payloads.get(channel) ?? null);
      listeners.get(channel)!.add(notify);
      return () => {
        listeners.get(channel)!.delete(notify);
      };
    }, [channel]);

    return value ?? null;
  },
  toPayloadWithHeaders: vi.fn((p: unknown) => p),
}));

beforeEach(() => {
  payloads = new Map();
  listeners.clear();

  // Force ResponsiveContainer to see a real size in tests.
  // Recharts uses ResizeObserver internally; if the observed entry
  // has zero dimensions it skips rendering children entirely.
  globalThis.ResizeObserver = class ResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});

// ---------------------------------------------------------------------------
// getFieldValue unit tests
// ---------------------------------------------------------------------------

describe("getFieldValue", () => {
  it("extracts a top-level field", () => {
    expect(getFieldValue({ value: 3.14 }, "value")).toBe(3.14);
  });

  it("extracts a nested field using dot-notation", () => {
    expect(getFieldValue({ data: { residual: 0.003 } }, "data.residual")).toBe(0.003);
  });

  it("returns undefined for a missing field", () => {
    expect(getFieldValue({}, "value")).toBeUndefined();
  });

  it("returns undefined for a non-numeric field", () => {
    expect(getFieldValue({ value: "hello" }, "value")).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(getFieldValue({ value: NaN }, "value")).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(getFieldValue({ value: Infinity }, "value")).toBeUndefined();
  });

  it("defaults field to 'value' when not provided", () => {
    expect(getFieldValue({ value: 42 })).toBe(42);
  });

  it("returns undefined when an intermediate path segment is missing", () => {
    expect(getFieldValue({ data: null }, "data.residual")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ChartComponent integration tests
// ---------------------------------------------------------------------------

const defaultSeries: SeriesConfig[] = [
  { channel: "data/sine", field: "value", label: "sin(t)" },
];

describe("ChartComponent", () => {
  it("renders empty placeholder when no data received", async () => {
    const screen = await render(<ChartComponent series={defaultSeries} />);
    await expect
      .element(screen.getByText(/Waiting for data on data\/sine/i))
      .toBeInTheDocument();
  });

  it("appends a data point when a matching channel event arrives", async () => {
    const screen = await render(<ChartComponent series={defaultSeries} />);
    setPayload("data/sine", { value: 0.84 });
    await expect.element(screen.getByText(/Waiting for data/i)).not.toBeInTheDocument();
  });

  it("drops non-numeric field values silently", async () => {
    const screen = await render(<ChartComponent series={defaultSeries} />);
    setPayload("data/sine", { value: "not-a-number" });
    await expect.element(screen.getByText(/Waiting for data/i)).toBeInTheDocument();
  });

  it("drops NaN values silently", async () => {
    const screen = await render(<ChartComponent series={defaultSeries} />);
    setPayload("data/sine", { value: NaN });
    await expect.element(screen.getByText(/Waiting for data/i)).toBeInTheDocument();
  });

  it("enforces maxPoints rolling buffer without crashing", async () => {
    const screen = await render(
      <ChartComponent series={defaultSeries} maxPoints={3} />,
    );
    for (let i = 0; i < 10; i++) {
      setPayload("data/sine", { value: i });
    }
    await expect.element(screen.getByText(/Waiting for data/i)).not.toBeInTheDocument();
  });

  it("renders one Line per series config entry", async () => {
    const multiSeries: SeriesConfig[] = [
      { channel: "data/a", field: "value", label: "A" },
      { channel: "data/b", field: "value", label: "B" },
    ];
    const screen = await render(<ChartComponent series={multiSeries} />);
    setPayload("data/a", { value: 1 });
    setPayload("data/b", { value: 2 });
    await expect.element(screen.getByText(/Waiting for data/i)).not.toBeInTheDocument();
  });

  it("supports dot-notation field path extraction", async () => {
    const nestedSeries: SeriesConfig[] = [
      { channel: "data/nested", field: "metrics.loss", label: "loss" },
    ];
    const screen = await render(<ChartComponent series={nestedSeries} />);
    setPayload("data/nested", { metrics: { loss: 0.12 } });
    await expect.element(screen.getByText(/Waiting for data/i)).not.toBeInTheDocument();
  });

  it("unmounts without throwing", async () => {
    const { unmount } = await render(<ChartComponent series={defaultSeries} />);
    expect(() => unmount()).not.toThrow();
  });

  it("renders the chart title when provided", async () => {
    const screen = await render(
      <ChartComponent series={defaultSeries} title="My Chart" />,
    );
    await expect.element(screen.getByText("My Chart")).toBeInTheDocument();
  });

  it("renders xLabel on the X axis when provided", async () => {
    const screen = await render(
      <ChartComponent series={defaultSeries} xLabel="Time (s)" />,
    );
    setPayload("data/sine", { value: 1 });
    await expect.element(screen.getByText("Time (s)")).toBeInTheDocument();
  });

  it("renders yLabel on the Y axis when provided", async () => {
    const screen = await render(
      <ChartComponent series={defaultSeries} yLabel="Amplitude" />,
    );
    setPayload("data/sine", { value: 1 });
    await expect.element(screen.getByText("Amplitude")).toBeInTheDocument();
  });
});
