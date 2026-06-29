import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { ParamDiffViewer } from "./ParamDiffViewer";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const CURRENT = { roll_amplitude_deg: 42, z_amplitude_mm: 36 };
const SUGGESTED = { roll_amplitude_deg: 18 };
const EXPLANATION = "Roll exceeded the violation threshold on step 0.";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ParamDiffViewer", () => {
  it("renders the explanation text", async () => {
    await render(
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await expect.element(page.getByText(EXPLANATION)).toBeInTheDocument();
  });

  it("renders only fields present in suggested, not every current field", async () => {
    await render(
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    // One body row per suggested field (header row is in <thead>).
    const rows = document.querySelectorAll(".sct-ParamDiffViewer-table tbody tr");
    expect(rows.length).toBe(1);
    await expect.element(page.getByText("roll_amplitude_deg")).toBeInTheDocument();
  });

  it("renders a Parameter | Current | Suggested table header", async () => {
    await render(
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await expect
      .element(page.getByRole("columnheader", { name: "Parameter" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("columnheader", { name: "Current" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("columnheader", { name: "Suggested" }))
      .toBeInTheDocument();
  });

  it("shows the current and suggested values for each changed field", async () => {
    await render(
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await expect.element(page.getByText("42")).toBeInTheDocument();
    await expect.element(page.getByText("18")).toBeInTheDocument();
  });

  it("calls onApprove when Approve button is clicked", async () => {
    const onApprove = vi.fn();

    await render(
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
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
      <ParamDiffViewer
        current={CURRENT}
        suggested={SUGGESTED}
        explanation={EXPLANATION}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );

    await page.getByRole("button", { name: "Reject" }).click();

    expect(onReject).toHaveBeenCalledOnce();
  });

  it("falls back to an em-dash when current has no value for a suggested field", async () => {
    await render(
      <ParamDiffViewer
        current={{}}
        suggested={{ num_loops: 1 }}
        explanation="New field."
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await expect.element(page.getByText("—")).toBeInTheDocument();
  });
});
