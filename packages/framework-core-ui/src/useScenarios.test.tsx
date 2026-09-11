import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "./workspaceClient";
import * as workspaceClient from "./workspaceClient";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useScenarios } from "./useScenarios";

vi.mock("./workspaceClient", async () => {
  const actual =
    await vi.importActual<typeof import("./workspaceClient")>("./workspaceClient");
  return { ...actual, updateWorkspace: vi.fn() };
});

const WORKSPACE: Workspace = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
  goal: null,
  layout_snapshot: null,
  metadata: {},
};

function seedActiveWorkspace(workspace: Workspace | null): void {
  useWorkspaceStore.setState({
    activeWorkspaceId: workspace?.id ?? null,
    activeWorkspace: workspace,
  });
}

/** Exercises every useScenarios() action behind accessible buttons. */
function Harness() {
  const { scenarios, add, update, remove, setScenarios } = useScenarios();
  return (
    <div>
      <button onClick={() => add("Scenario A", { speed: 1 })}>Add A</button>
      <button onClick={() => add("Scenario B", { speed: 2 })}>Add B</button>
      <button onClick={() => update(scenarios[0]?.id ?? "", { name: "Renamed" })}>
        Update First
      </button>
      <button onClick={() => update("missing-id", { name: "Should not appear" })}>
        Update Missing
      </button>
      <button onClick={() => remove(scenarios[0]?.id ?? "")}>Remove First</button>
      <button onClick={() => remove("missing-id")}>Remove Missing</button>
      <button
        onClick={() =>
          setScenarios([
            { id: "fixed-1", name: "Bulk One", data: null },
            { id: "fixed-2", name: "Bulk Two", data: null },
          ])
        }
      >
        Bulk Set
      </button>
      <ul>
        {scenarios.map((s) => (
          <li key={s.id}>{s.name}</li>
        ))}
      </ul>
    </div>
  );
}

beforeEach(() => {
  seedActiveWorkspace(WORKSPACE);
  vi.mocked(workspaceClient.updateWorkspace).mockReset();
});

afterEach(() => {
  seedActiveWorkspace(null);
});

describe("useScenarios", () => {
  it("add appends a scenario with a generated id to an empty list", async () => {
    await render(<Harness />);

    await page.getByRole("button", { name: "Add A" }).click();

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Scenario A");
    const scenarios = useWorkspaceStore.getState().activeWorkspace?.metadata
      .scenarios as { id: string }[];
    expect(scenarios).toHaveLength(1);
    expect(typeof scenarios[0].id).toBe("string");
    expect(scenarios[0].id.length).toBeGreaterThan(0);
  });

  it("add generates distinct ids across calls", async () => {
    await render(<Harness />);

    await page.getByRole("button", { name: "Add A" }).click();
    await page.getByRole("button", { name: "Add B" }).click();

    const scenarios = useWorkspaceStore.getState().activeWorkspace?.metadata
      .scenarios as { id: string }[];
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].id).not.toBe(scenarios[1].id);
  });

  it("update patches an existing scenario by id", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Add A" }).click();

    await page.getByRole("button", { name: "Update First" }).click();

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Renamed");
  });

  it("update no-ops for an unknown id", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Add A" }).click();

    await page.getByRole("button", { name: "Update Missing" }).click();

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Scenario A");
    await expect.element(page.getByText("Should not appear")).not.toBeInTheDocument();
  });

  it("remove filters an existing scenario by id", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Add A" }).click();

    await page.getByRole("button", { name: "Remove First" }).click();

    await expect.element(page.getByRole("list")).not.toHaveTextContent("Scenario A");
    const scenarios = useWorkspaceStore.getState().activeWorkspace?.metadata.scenarios;
    expect(scenarios).toEqual([]);
  });

  it("remove no-ops for an unknown id", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Add A" }).click();

    await page.getByRole("button", { name: "Remove Missing" }).click();

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Scenario A");
  });

  it("update/remove on missing id does not create metadata.scenarios key", async () => {
    await render(<Harness />);

    // Call remove on a missing id without ever adding a scenario
    // This should not create metadata.scenarios if the workspace starts with empty metadata
    await page.getByRole("button", { name: "Remove Missing" }).click();

    expect(useWorkspaceStore.getState().activeWorkspace?.metadata).not.toHaveProperty(
      "scenarios",
    );
  });

  it("setScenarios replaces the list wholesale", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Add A" }).click();

    await page.getByRole("button", { name: "Bulk Set" }).click();

    const items = page.getByRole("listitem");
    await expect.element(items.nth(0)).toHaveTextContent("Bulk One");
    await expect.element(items.nth(1)).toHaveTextContent("Bulk Two");
    const scenarios = useWorkspaceStore.getState().activeWorkspace?.metadata.scenarios;
    expect(scenarios).toEqual([
      { id: "fixed-1", name: "Bulk One", data: null },
      { id: "fixed-2", name: "Bulk Two", data: null },
    ]);
  });

  it("reads as an empty list and no-ops all mutators when no workspace is active", async () => {
    seedActiveWorkspace(null);
    await render(<Harness />);

    await expect.element(page.getByRole("list")).toBeEmptyDOMElement();

    await page.getByRole("button", { name: "Add A" }).click();

    await expect.element(page.getByRole("list")).toBeEmptyDOMElement();
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
  });

  it("falls back to an empty list when metadata.scenarios is not an array", async () => {
    seedActiveWorkspace({
      ...WORKSPACE,
      metadata: { scenarios: "not-an-array" },
    });
    await render(<Harness />);

    await expect.element(page.getByRole("list")).toBeEmptyDOMElement();

    await page.getByRole("button", { name: "Add A" }).click();

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Scenario A");
  });

  it("reads pre-existing scenarios from metadata", async () => {
    seedActiveWorkspace({
      ...WORKSPACE,
      metadata: {
        scenarios: [{ id: "seed-1", name: "Preexisting", data: null }],
      },
    });
    await render(<Harness />);

    await expect.element(page.getByRole("listitem")).toHaveTextContent("Preexisting");
  });

  it("does not call the backend on mutation, but persists to backend via save()", async () => {
    vi.mocked(workspaceClient.updateWorkspace).mockImplementation(async (id, ws) => ws);

    await render(<Harness />);

    await page.getByRole("button", { name: "Add A" }).click();
    await page.getByRole("button", { name: "Add B" }).click();
    await page.getByRole("button", { name: "Update First" }).click();

    // Mutations do not call the backend directly
    expect(workspaceClient.updateWorkspace).not.toHaveBeenCalled();

    // But save() persists the mutated scenarios to the backend
    await useWorkspaceStore.getState().save();

    expect(workspaceClient.updateWorkspace).toHaveBeenCalledOnce();
    const call = vi.mocked(workspaceClient.updateWorkspace).mock.calls[0];
    const workspaceArg = call[1];
    const scenarios = workspaceArg.metadata.scenarios as { id: string; name: string }[];
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].name).toBe("Renamed");
    expect(scenarios[1].name).toBe("Scenario B");
  });
});
