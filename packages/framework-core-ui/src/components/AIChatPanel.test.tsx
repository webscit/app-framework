import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";

import { AIChatPanel } from "./AIChatPanel";
import { WidgetRegistry } from "../widgetRegistry";
import type { ShellLayout } from "../shellTypes";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_LAYOUT: ShellLayout = {
  regions: {
    header: { visible: true, items: [] },
    "sidebar-left": { visible: true, items: [] },
    main: { visible: true, items: [] },
    "sidebar-right": { visible: false, items: [] },
    bottom: { visible: false, items: [] },
    "status-bar": { visible: true, items: [] },
  },
};

const PROPOSED_LAYOUT: ShellLayout = {
  regions: {
    header: { visible: true, items: [] },
    "sidebar-left": { visible: true, items: [] },
    main: {
      visible: true,
      items: [{ id: "chart-1", type: "Chart", props: {} }],
    },
    "sidebar-right": { visible: false, items: [] },
    bottom: { visible: false, items: [] },
    "status-bar": { visible: true, items: [] },
  },
};

const EXPLANATION = "Added a Chart widget to the main region.";

function makeRegistry(): WidgetRegistry {
  const r = new WidgetRegistry();
  r.register({
    name: "Chart",
    description: "Renders a time-series chart.",
    channelPattern: "data/*",
    consumes: ["application/x-timeseries+json"],
    priority: 10,
    defaultRegion: "main",
    parameters: {},
    factory: () => (() => <div />) as React.ComponentType,
  });
  return r;
}

function makeSuccessResponse() {
  return new Response(
    JSON.stringify({ layout: PROPOSED_LAYOUT, explanation: EXPLANATION }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const DIAGNOSIS_EXPLANATION = "Roll exceeded the violation threshold on step 0.";
const SUGGESTED_PARAMS = { roll_amplitude_deg: 18.0 };

/** A pure-diagnosis response: no layout key, only explanation + suggested_params. */
function makeDiagnosisResponse() {
  return new Response(
    JSON.stringify({
      layout: {},
      explanation: DIAGNOSIS_EXPLANATION,
      suggested_params: SUGGESTED_PARAMS,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A combined response: explanation + suggested_params + a real layout change. */
function makeCombinedResponse() {
  return new Response(
    JSON.stringify({
      layout: PROPOSED_LAYOUT,
      explanation: DIAGNOSIS_EXPLANATION,
      suggested_params: SUGGESTED_PARAMS,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Default props ─────────────────────────────────────────────────────────────

function defaultProps(overrides?: Partial<Parameters<typeof AIChatPanel>[0]>) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    currentLayout: BASE_LAYOUT,
    onApplyLayout: vi.fn(),
    registry: makeRegistry(),
    apiUrl: "/ai/layout",
    ...overrides,
  };
}

// ─── Click helpers ─────────────────────────────────────────────────────────────

/**
 * Fill the chat textarea and submit with Enter.
 *
 * The textarea lives inside the Sheet but is not covered by the base-ui
 * inert overlay, so key events reach React's synthetic handler reliably.
 */
async function fillAndSend(text: string): Promise<void> {
  const textarea = page.getByRole("textbox", { name: "Chat input" });
  await textarea.fill(text);
  // Dispatch keydown directly on the element so React's onKeyDown fires without
  // going through Playwright's pointer-events layer (blocked by base-ui inert overlay).
  (textarea.element() as HTMLTextAreaElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
}

/**
 * Click a button that renders inside the Sheet portal.
 *
 * Playwright's pointer-based click may be intercepted by the base-ui inert
 * overlay (data-base-ui-inert). Using the DOM's HTMLElement.click() avoids
 * the pointer-events layer and fires the event directly on the element,
 * which React's event delegation picks up normally.
 */
function domClick(name: string): void {
  (page.getByRole("button", { name }).element() as HTMLElement).click();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AIChatPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the sheet title when open", async () => {
    await render(<AIChatPanel {...defaultProps()} />);

    await expect
      .element(page.getByRole("heading", { name: "AI Layout Assistant" }))
      .toBeInTheDocument();
  });

  it("shows empty-state hint when no messages exist", async () => {
    await render(<AIChatPanel {...defaultProps()} />);

    await expect
      .element(page.getByText(/describe the dashboard layout/i))
      .toBeInTheDocument();
  });

  it("renders chat input and Send button", async () => {
    await render(<AIChatPanel {...defaultProps()} />);

    await expect
      .element(page.getByRole("textbox", { name: "Chat input" }))
      .toBeInTheDocument();

    await expect
      .element(page.getByRole("button", { name: "Send message" }))
      .toBeInTheDocument();
  });

  it("Send button is disabled when input is empty", async () => {
    await render(<AIChatPanel {...defaultProps()} />);

    await expect
      .element(page.getByRole("button", { name: "Send message" }))
      .toBeDisabled();
  });

  it("Send button is enabled when input has text", async () => {
    await render(<AIChatPanel {...defaultProps()} />);

    await page.getByRole("textbox", { name: "Chat input" }).fill("Add a chart");

    await expect
      .element(page.getByRole("button", { name: "Send message" }))
      .toBeEnabled();
  });

  it("shows user message bubble after submitting", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    // The bubble is a <p> inside the assistant chat area, distinct from the textarea
    await expect
      .element(page.getByRole("paragraph").filter({ hasText: "Add a chart" }))
      .toBeInTheDocument();
  });

  it("clears the input after sending", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    await expect
      .element(page.getByRole("textbox", { name: "Chat input" }))
      .toHaveValue("");
  });

  it("shows assistant message after successful API response", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    // EXPLANATION is rendered inside LayoutDiffViewer (bubble text is hidden while diff is showing)
    await expect.element(page.getByText(EXPLANATION).first()).toBeInTheDocument();
  });

  it("renders LayoutDiffViewer inside the assistant bubble when proposedLayout is present", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    // LayoutDiffViewer renders Approve and Reject buttons
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reject" }))
      .toBeInTheDocument();
  });

  it("calls onApplyLayout with the proposed layout when Approve is clicked", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());
    const onApplyLayout = vi.fn();

    await render(<AIChatPanel {...defaultProps({ onApplyLayout })} />);

    await fillAndSend("Add a chart");
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();
    domClick("Approve");

    expect(onApplyLayout).toHaveBeenCalledOnce();
    expect(onApplyLayout).toHaveBeenCalledWith(PROPOSED_LAYOUT);
  });

  it("does not call onApplyLayout when Reject is clicked", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());
    const onApplyLayout = vi.fn();

    await render(<AIChatPanel {...defaultProps({ onApplyLayout })} />);

    await fillAndSend("Add a chart");
    await expect
      .element(page.getByRole("button", { name: "Reject" }))
      .toBeInTheDocument();
    domClick("Reject");

    expect(onApplyLayout).not.toHaveBeenCalled();
  });

  it("hides the diff viewer after Approve and shows 'Layout applied.' status", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();
    domClick("Approve");

    await expect.element(page.getByText("Layout applied.")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .not.toBeInTheDocument();
  });

  it("hides the diff viewer after Reject and shows 'Layout rejected.' status", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");
    await expect
      .element(page.getByRole("button", { name: "Reject" }))
      .toBeInTheDocument();
    domClick("Reject");

    await expect.element(page.getByText("Layout rejected.")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reject" }))
      .not.toBeInTheDocument();
  });

  it("shows an error alert when the API call fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    await expect.element(page.getByText("Network error")).toBeInTheDocument();
  });

  it("shows an error alert for non-2xx API responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { errors: ["Widget 'Foo' not registered"] } }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Bad prompt");

    await expect.element(page.getByRole("alert")).toBeInTheDocument();
  });

  it("POSTs to apiUrl with the serialized registry and prompt", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);

    await fillAndSend("Add a chart");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/ai/layout");

    const body = JSON.parse(init.body as string) as {
      prompt: string;
      registry: unknown[];
      history: unknown[];
    };
    expect(body.prompt).toBe("Add a chart");
    expect(Array.isArray(body.registry)).toBe(true);
    expect(body.registry[0]).toMatchObject({ name: "Chart" });
    // factory must be stripped from the serialized registry
    expect((body.registry[0] as Record<string, unknown>).factory).toBeUndefined();
  });

  it("collapse button calls onOpenChange(false) when clicked", async () => {
    const onOpenChange = vi.fn();
    await render(<AIChatPanel {...defaultProps({ onOpenChange })} />);

    domClick("Collapse chat panel");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ─── Simulation snapshot + suggested_params ──────────────────────────────────

  it("does not attach snapshot fields when getSnapshot is not provided", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSuccessResponse());

    await render(<AIChatPanel {...defaultProps()} />);
    await fillAndSend("Add a chart");

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.telemetry_snapshot).toBeUndefined();
    expect(body.safety_snapshot).toBeUndefined();
    expect(body.current_params).toBeUndefined();
  });

  it("attaches the snapshot returned by getSnapshot to every request", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());
    const getSnapshot = vi.fn(() => ({
      telemetry_snapshot: [{ step: 0, roll_deg: 42.0 }],
      safety_snapshot: [{ step: 0, status: "violation" }],
      current_params: { roll_amplitude_deg: 42.0 },
    }));

    await render(
      <AIChatPanel {...defaultProps({ getSnapshot, onApproveParams: vi.fn() })} />,
    );
    await fillAndSend("What's wrong with this run?");

    expect(getSnapshot).toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.telemetry_snapshot).toEqual([{ step: 0, roll_deg: 42.0 }]);
    expect(body.safety_snapshot).toEqual([{ step: 0, status: "violation" }]);
    expect(body.current_params).toEqual({ roll_amplitude_deg: 42.0 });
  });

  it("renders ParamDiffViewer when the response includes suggested_params", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());

    await render(<AIChatPanel {...defaultProps({ onApproveParams: vi.fn() })} />);
    await fillAndSend("What's wrong with this run?");

    await expect
      .element(page.getByText(DIAGNOSIS_EXPLANATION).first())
      .toBeInTheDocument();
    await expect.element(page.getByText("roll_amplitude_deg")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();
  });

  it("does not render ParamDiffViewer when onApproveParams is not provided", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());

    await render(<AIChatPanel {...defaultProps()} />);
    await fillAndSend("What's wrong with this run?");

    // Explanation still shows as plain bubble text, but no diff/approve UI
    await expect
      .element(page.getByText(DIAGNOSIS_EXPLANATION).first())
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .not.toBeInTheDocument();
  });

  it("calls onApproveParams with the suggested params when Approve is clicked", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());
    const onApproveParams = vi.fn();

    await render(<AIChatPanel {...defaultProps({ onApproveParams })} />);
    await fillAndSend("What's wrong with this run?");

    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();
    domClick("Approve");

    expect(onApproveParams).toHaveBeenCalledWith(SUGGESTED_PARAMS);
    await expect.element(page.getByText("Parameters applied.")).toBeInTheDocument();
  });

  it("does not call onApproveParams when Reject is clicked", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());
    const onApproveParams = vi.fn();

    await render(<AIChatPanel {...defaultProps({ onApproveParams })} />);
    await fillAndSend("What's wrong with this run?");

    await expect
      .element(page.getByRole("button", { name: "Reject" }))
      .toBeInTheDocument();
    domClick("Reject");

    expect(onApproveParams).not.toHaveBeenCalled();
    await expect.element(page.getByText("Parameters rejected.")).toBeInTheDocument();
  });

  it("does not treat an empty layout object as a real layout proposal", async () => {
    vi.mocked(fetch).mockResolvedValue(makeDiagnosisResponse());
    const onApplyLayout = vi.fn();

    await render(
      <AIChatPanel {...defaultProps({ onApplyLayout, onApproveParams: vi.fn() })} />,
    );
    await fillAndSend("What's wrong with this run?");

    // Wait for the response to render before inspecting the DOM directly.
    await expect
      .element(page.getByRole("button", { name: "Approve" }))
      .toBeInTheDocument();

    // Only one Approve button — for params, not layout (layout was {} / omitted)
    const approveButtons = document.querySelectorAll(".sct-AIChatPanel-diff button");
    expect(document.querySelector(".sct-LayoutDiffViewer")).toBeNull();
    expect(approveButtons.length).toBeGreaterThan(0);
  });

  it("renders both LayoutDiffViewer and ParamDiffViewer for a combined response", async () => {
    vi.mocked(fetch).mockResolvedValue(makeCombinedResponse());

    await render(<AIChatPanel {...defaultProps({ onApproveParams: vi.fn() })} />);
    await fillAndSend("Fix it and show me the margin");

    await expect
      .element(page.getByText(DIAGNOSIS_EXPLANATION).first())
      .toBeInTheDocument();

    expect(document.querySelector(".sct-LayoutDiffViewer")).not.toBeNull();
    expect(document.querySelector(".sct-ParamDiffViewer")).not.toBeNull();
  });
});
