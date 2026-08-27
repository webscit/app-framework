import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { createDefaultShellLayout } from "../shellTypes";
import { useShellLayoutStore } from "../stores/shellStore";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  useWorkspaceStore,
} from "../stores/workspaceStore";
import * as workspaceClient from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { WorkspaceMenu } from "./WorkspaceMenu";

vi.mock("../workspaceClient", async () => {
  const actual =
    await vi.importActual<typeof import("../workspaceClient")>("../workspaceClient");
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  };
});

const SUMMARY: WorkspaceSummary = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const WORKSPACE: Workspace = {
  ...SUMMARY,
  goal: null,
  layout_snapshot: null,
  metadata: {},
};

beforeEach(() => {
  localStorage.clear();
  const layout = createDefaultShellLayout();
  useShellLayoutStore.setState({
    profiles: [{ id: "p1", name: "Default", layout }],
    activeProfileId: "p1",
    workingLayout: structuredClone(layout),
    defaultLayout: structuredClone(layout),
  });
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspace: null,
    status: "idle",
    error: null,
  });
  vi.mocked(workspaceClient.listWorkspaces).mockReset().mockResolvedValue([]);
  vi.mocked(workspaceClient.createWorkspace).mockReset();
  vi.mocked(workspaceClient.getWorkspace).mockReset();
  vi.mocked(workspaceClient.updateWorkspace).mockReset();
  vi.mocked(workspaceClient.deleteWorkspace).mockReset();
});

async function openMenu() {
  await page.getByRole("button", { name: /workspace/i }).click();
}

describe("WorkspaceMenu", () => {
  it("labels the trigger 'No workspace' before any workspace is active", async () => {
    await render(<WorkspaceMenu />);

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("No workspace");
  });

  it("lists every workspace as a menu item when opened", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([
      SUMMARY,
      { ...SUMMARY, id: "w2", name: "Bridge inspection" },
    ]);

    await render(<WorkspaceMenu />);
    await openMenu();

    await expect
      .element(page.getByRole("menuitemradio", { name: "Drone survey" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Bridge inspection" }))
      .toBeInTheDocument();
  });

  it("opens a workspace when selected from the list", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitemradio", { name: "Drone survey" }).click();

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("creates a workspace through the New workspace… form", async () => {
    vi.mocked(workspaceClient.createWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitem", { name: "New workspace…" }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill("Drone survey");
    await page.getByRole("button", { name: "Create workspace" }).click();

    expect(workspaceClient.createWorkspace).toHaveBeenCalledWith({
      name: "Drone survey",
      goal: undefined,
    });
    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("disables Save, Rename, Close, and Delete when no workspace is active", async () => {
    await render(<WorkspaceMenu />);
    await openMenu();

    await expect.element(page.getByRole("menuitem", { name: "Save" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Close" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });

  it("auto-opens the workspace named by localStorage on mount", async () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Drone survey");
  });

  it("clears a stale localStorage id without erroring when the workspace no longer exists", async () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "stale-id");
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);

    await render(<WorkspaceMenu />);

    expect(workspaceClient.getWorkspace).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull();
    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("No workspace");
  });

  it("shows an inline error message when an action fails", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockRejectedValue(
      new Error("network down"),
    );

    await render(<WorkspaceMenu />);
    await openMenu();

    await expect.element(page.getByRole("alert")).toHaveTextContent("network down");
  });

  it("does not clear a valid stored id when the initial fetch fails", async () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");
    vi.mocked(workspaceClient.listWorkspaces).mockRejectedValue(
      new Error("network down"),
    );

    await render(<WorkspaceMenu />);

    expect(workspaceClient.getWorkspace).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("w1");
  });

  it("renames the active workspace through the Rename form", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitemradio", { name: "Drone survey" }).click();
    await openMenu();
    await page.getByRole("menuitem", { name: "Rename" }).click();

    vi.mocked(workspaceClient.updateWorkspace).mockResolvedValue({
      ...WORKSPACE,
      name: "Renamed survey",
    });

    await page.getByRole("textbox", { name: "Workspace name" }).fill("Renamed survey");
    await page.getByRole("button", { name: "Save name" }).click();

    await expect
      .element(page.getByRole("button", { name: /workspace/i }))
      .toHaveTextContent("Renamed survey");
  });

  it("keeps the menu open and shows the error when Save fails", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);
    vi.mocked(workspaceClient.updateWorkspace).mockRejectedValue(
      new Error("save failed"),
    );

    await render(<WorkspaceMenu />);
    await openMenu();
    await page.getByRole("menuitemradio", { name: "Drone survey" }).click();
    await openMenu();
    await page.getByRole("menuitem", { name: "Save" }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent("save failed");
    await expect
      .element(page.getByRole("menuitem", { name: "Save" }))
      .toBeInTheDocument();
  });
});
