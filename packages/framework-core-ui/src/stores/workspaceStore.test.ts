import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultShellLayout } from "../shellTypes";
import * as workspaceClient from "../workspaceClient";
import type { Workspace, WorkspaceSummary } from "../workspaceClient";
import { useShellLayoutStore } from "./shellStore";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  useWorkspaceStore,
} from "./workspaceStore";

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

function resetShellLayout(): void {
  const layout = createDefaultShellLayout();
  useShellLayoutStore.setState({
    profiles: [{ id: "p1", name: "Default", layout }],
    activeProfileId: "p1",
    workingLayout: structuredClone(layout),
    defaultLayout: structuredClone(layout),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetShellLayout();
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspace: null,
    status: "idle",
    error: null,
  });
  vi.mocked(workspaceClient.listWorkspaces).mockReset();
  vi.mocked(workspaceClient.createWorkspace).mockReset();
  vi.mocked(workspaceClient.getWorkspace).mockReset();
  vi.mocked(workspaceClient.updateWorkspace).mockReset();
  vi.mocked(workspaceClient.deleteWorkspace).mockReset();
});

describe("useWorkspaceStore", () => {
  it("refreshList populates workspaces from the API", async () => {
    vi.mocked(workspaceClient.listWorkspaces).mockResolvedValue([SUMMARY]);

    await useWorkspaceStore.getState().refreshList();

    expect(useWorkspaceStore.getState().workspaces).toEqual([SUMMARY]);
    expect(useWorkspaceStore.getState().status).toBe("idle");
  });

  it("createWorkspace adds the workspace and makes it active", async () => {
    vi.mocked(workspaceClient.createWorkspace).mockResolvedValue(WORKSPACE);

    await useWorkspaceStore.getState().createWorkspace("Drone survey");

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("w1");
    expect(state.workspaces).toEqual([SUMMARY]);
    expect(readStoredActiveWorkspaceId()).toBe("w1");
  });

  it("openWorkspace applies layout_snapshot to the shell layout store", async () => {
    const layout = createDefaultShellLayout();
    layout.regions.header.visible = false;
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue({
      ...WORKSPACE,
      layout_snapshot: layout,
    });

    await useWorkspaceStore.getState().openWorkspace("w1");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w1");
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(
      false,
    );
  });

  it("openWorkspace leaves the shell layout untouched when layout_snapshot is null", async () => {
    vi.mocked(workspaceClient.getWorkspace).mockResolvedValue(WORKSPACE);
    const before = useShellLayoutStore.getState().workingLayout;

    await useWorkspaceStore.getState().openWorkspace("w1");

    expect(useShellLayoutStore.getState().workingLayout).toEqual(before);
  });

  it("save sends the current shell layout in the update request", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });
    const layout = useShellLayoutStore.getState().workingLayout;
    vi.mocked(workspaceClient.updateWorkspace).mockResolvedValue({
      ...WORKSPACE,
      layout_snapshot: layout,
    });

    await useWorkspaceStore.getState().save();

    expect(workspaceClient.updateWorkspace).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ layout_snapshot: layout }),
    );
  });

  it("close clears the active workspace and resets the shell layout", () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });

    useWorkspaceStore.getState().close();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(readStoredActiveWorkspaceId()).toBeNull();
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(
      true,
    );
  });

  it("deleteWorkspace on the active workspace clears it and resets the shell layout", async () => {
    useWorkspaceStore.setState({
      workspaces: [SUMMARY],
      activeWorkspaceId: "w1",
      activeWorkspace: WORKSPACE,
    });
    useShellLayoutStore.getState().setLayout((prev) => {
      prev.regions.header.visible = false;
      return prev;
    });
    vi.mocked(workspaceClient.deleteWorkspace).mockResolvedValue(undefined);

    await useWorkspaceStore.getState().deleteWorkspace("w1");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([]);
    expect(state.activeWorkspaceId).toBeNull();
    expect(useShellLayoutStore.getState().workingLayout.regions.header.visible).toBe(
      true,
    );
  });

  it("deleteWorkspace on an inactive workspace leaves the active one untouched", async () => {
    useWorkspaceStore.setState({
      workspaces: [SUMMARY, { ...SUMMARY, id: "w2", name: "Other" }],
      activeWorkspaceId: "w1",
      activeWorkspace: WORKSPACE,
    });
    vi.mocked(workspaceClient.deleteWorkspace).mockResolvedValue(undefined);

    await useWorkspaceStore.getState().deleteWorkspace("w2");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([SUMMARY]);
    expect(state.activeWorkspaceId).toBe("w1");
  });

  it("rename updates the active workspace's name", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });
    vi.mocked(workspaceClient.updateWorkspace).mockResolvedValue({
      ...WORKSPACE,
      name: "Renamed",
    });

    await useWorkspaceStore.getState().rename("Renamed");

    expect(useWorkspaceStore.getState().activeWorkspace?.name).toBe("Renamed");
    expect(workspaceClient.updateWorkspace).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ name: "Renamed" }),
    );
  });

  it("rename is a no-op when no workspace is active", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null, activeWorkspace: null });

    await useWorkspaceStore.getState().rename("New name");

    expect(workspaceClient.updateWorkspace).not.toHaveBeenCalled();
  });

  it("rename is a no-op when given a blank name", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", activeWorkspace: WORKSPACE });

    await useWorkspaceStore.getState().rename("   ");

    expect(workspaceClient.updateWorkspace).not.toHaveBeenCalled();
  });

  it("save is a no-op when no workspace is active", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null, activeWorkspace: null });

    await useWorkspaceStore.getState().save();

    expect(workspaceClient.updateWorkspace).not.toHaveBeenCalled();
  });

  it("clearStoredActiveWorkspaceId clears the stored key", () => {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "w1");

    clearStoredActiveWorkspaceId();

    expect(readStoredActiveWorkspaceId()).toBeNull();
  });

  it("a failed action sets status to error and leaves prior state intact", async () => {
    useWorkspaceStore.setState({ workspaces: [SUMMARY] });
    vi.mocked(workspaceClient.listWorkspaces).mockRejectedValue(
      new workspaceClient.WorkspaceApiError(500, "server exploded"),
    );

    await useWorkspaceStore.getState().refreshList();

    const state = useWorkspaceStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("server exploded");
    expect(state.workspaces).toEqual([SUMMARY]);
  });
});
