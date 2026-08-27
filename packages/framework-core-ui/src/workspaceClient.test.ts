import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkspaceApiUrl,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  WorkspaceApiError,
} from "./workspaceClient";
import type { Workspace } from "./workspaceClient";

const LOCATION = { protocol: "http:", host: "localhost:5173" };

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: () => Promise.resolve(body),
    }),
  );
}

const WORKSPACE: Workspace = {
  id: "w1",
  name: "Drone survey",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
  goal: null,
  layout_snapshot: null,
  metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildWorkspaceApiUrl", () => {
  it("builds an http URL from a non-https location", () => {
    expect(buildWorkspaceApiUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
      "http://localhost:5173/workspaces",
    );
  });

  it("builds an https URL from an https location", () => {
    expect(buildWorkspaceApiUrl({ protocol: "https:", host: "app.example.com" })).toBe(
      "https://app.example.com/workspaces",
    );
  });
});

describe("listWorkspaces", () => {
  it("returns the parsed summary list on success", async () => {
    mockFetchOnce(200, [WORKSPACE]);

    const result = await listWorkspaces(LOCATION);

    expect(result).toEqual([WORKSPACE]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces");
  });

  it("throws WorkspaceApiError with the parsed detail on failure", async () => {
    mockFetchOnce(500, { detail: "boom" });

    await expect(listWorkspaces(LOCATION)).rejects.toMatchObject({
      name: "WorkspaceApiError",
      status: 500,
      message: "boom",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new Error("not json")),
      }),
    );

    await expect(listWorkspaces(LOCATION)).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });
});

describe("createWorkspace", () => {
  it("POSTs name and goal and returns the created workspace", async () => {
    mockFetchOnce(201, WORKSPACE);

    const result = await createWorkspace({ name: "Drone survey" }, LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:5173/workspaces",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Drone survey" }),
      }),
    );
  });
});

describe("getWorkspace", () => {
  it("returns the workspace on success", async () => {
    mockFetchOnce(200, WORKSPACE);

    const result = await getWorkspace("w1", LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces/w1");
  });

  it("throws WorkspaceApiError with status 404 when missing", async () => {
    mockFetchOnce(404, { detail: "Workspace 'w1' not found" });

    await expect(getWorkspace("w1", LOCATION)).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateWorkspace", () => {
  it("PUTs the full record and returns the saved workspace", async () => {
    mockFetchOnce(200, WORKSPACE);

    const result = await updateWorkspace("w1", WORKSPACE, LOCATION);

    expect(result).toEqual(WORKSPACE);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:5173/workspaces/w1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(WORKSPACE) }),
    );
  });
});

describe("deleteWorkspace", () => {
  it("DELETEs and resolves on success", async () => {
    mockFetchOnce(204, undefined);

    await expect(deleteWorkspace("w1", LOCATION)).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:5173/workspaces/w1", {
      method: "DELETE",
    });
  });

  it("throws WorkspaceApiError on failure", async () => {
    mockFetchOnce(404, { detail: "not found" });

    await expect(deleteWorkspace("w1", LOCATION)).rejects.toBeInstanceOf(WorkspaceApiError);
  });
});
