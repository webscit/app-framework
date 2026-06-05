import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { LayoutDiffViewer } from "./LayoutDiffViewer";
import type { ShellLayout } from "../shellTypes";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

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

/** Layout with Chart in main and ParameterController in sidebar-left. */
const PROPOSED_LAYOUT: ShellLayout = {
  regions: {
    header: { visible: true, items: [] },
    "sidebar-left": {
      visible: true,
      items: [{ id: "pc-1", type: "ParameterController", props: {} }],
    },
    main: {
      visible: true,
      items: [{ id: "chart-1", type: "Chart", props: {} }],
    },
    "sidebar-right": { visible: false, items: [] },
    bottom: { visible: false, items: [] },
    "status-bar": { visible: true, items: [] },
  },
};

const EXPLANATION =
  "Added a Chart to main and a ParameterController to the left sidebar.";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LayoutDiffViewer", () => {
  it("renders the explanation text", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await expect.element(page.getByText(EXPLANATION)).toBeInTheDocument();
  });

  it("calls onApprove when Approve button is clicked", async () => {
    const onApprove = vi.fn();

    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "Approve" }).click();

    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("calls onReject when Reject button is clicked", async () => {
    const onReject = vi.fn();

    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );

    await page.getByRole("button", { name: "Reject" }).click();

    expect(onReject).toHaveBeenCalledOnce();
  });

  it("highlights changed regions with accent CSS class", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    // sidebar-left and main differ between current and proposed
    const changedCells = document.querySelectorAll(
      ".sct-LayoutDiffViewer-cell--changed",
    );
    expect(changedCells.length).toBe(2);
  });

  it("does not highlight unchanged regions", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={BASE_LAYOUT}
        explanation="No changes."
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const changedCells = document.querySelectorAll(
      ".sct-LayoutDiffViewer-cell--changed",
    );
    expect(changedCells.length).toBe(0);
  });

  it("shows JSON block when Show JSON is clicked", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(document.querySelector(".sct-LayoutDiffViewer-json")).toBeNull();

    await page.getByRole("button", { name: "Show JSON" }).click();

    expect(document.querySelector(".sct-LayoutDiffViewer-json")).not.toBeNull();
  });

  it("hides JSON block when Hide JSON is clicked", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "Show JSON" }).click();
    await page.getByRole("button", { name: "Hide JSON" }).click();

    expect(document.querySelector(".sct-LayoutDiffViewer-json")).toBeNull();
  });

  it("renders widget names inside region cells", async () => {
    await render(
      <LayoutDiffViewer
        current={BASE_LAYOUT}
        proposed={PROPOSED_LAYOUT}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const cellWidgets = Array.from(
      document.querySelectorAll(".sct-LayoutDiffViewer-cell-widgets"),
    ).map((el) => el.textContent ?? "");

    expect(cellWidgets).toContain("Chart");
    expect(cellWidgets).toContain("ParameterController");
  });
});
