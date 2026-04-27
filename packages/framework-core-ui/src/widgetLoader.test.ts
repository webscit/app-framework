import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WidgetLoader, type SctManifest } from "./widgetLoader";
import { WidgetRegistry } from "./widgetRegistry";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MANIFEST_A_URL = "/plugin-a/sct-manifest.json";
const MANIFEST_B_URL = "/plugin-b/sct-manifest.json";

const MANIFEST_A: SctManifest = {
  version: "1.0.0",
  widgets: [
    {
      name: "LogViewer",
      description: "Log viewer widget",
      channelPattern: "log/*",
      consumes: ["text/plain"],
      priority: 10,
      defaultRegion: "bottom",
      parameters: { maxLines: { type: "integer", default: 1000 } },
      module: "./LogViewer",
      export: "LogViewerComponent",
    },
    {
      name: "StatusIndicator",
      description: "Status indicator widget",
      channelPattern: "control/*",
      consumes: ["application/x-control+json"],
      priority: 10,
      defaultRegion: "status-bar",
      parameters: {},
      module: "./StatusIndicator",
      export: "StatusIndicatorComponent",
    },
  ],
};

const MANIFEST_B: SctManifest = {
  version: "1.0.0",
  widgets: [
    {
      name: "ChartWidget",
      description: "Chart widget",
      channelPattern: "data/*",
      consumes: ["application/json"],
      priority: 5,
      defaultRegion: "main",
      parameters: {},
      module: "./ChartWidget",
      export: "ChartWidgetComponent",
    },
  ],
};

/** Stub fetch to return different manifests based on URL. */
function mockFetchByUrl(map: Record<string, SctManifest>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const manifest = map[url];
      if (!manifest) return Promise.reject(new Error(`No mock for ${url}`));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
    }),
  );
}

function mockFetchManifest(manifest: SctManifest): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(manifest),
    }),
  );
}

function mockFetchFailure(message = "Network error"): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(message)));
}

function makeImportFn(exports: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue(exports);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WidgetLoader", () => {
  beforeEach(() => {
    vi.stubGlobal("console", {
      ...console,
      warn: vi.fn(),
      error: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Single manifest ───────────────────────────────────────────────────────

  it("loadManifest registers all declared widgets", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);

    expect(registry.get("LogViewer")).toBeDefined();
    expect(registry.get("StatusIndicator")).toBeDefined();
  });

  it("metadata fields are available immediately after loadManifest resolves", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);

    const lv = registry.get("LogViewer")!;
    expect(lv.name).toBe("LogViewer");
    expect(lv.description).toBe("Log viewer widget");
    expect(lv.channelPattern).toBe("log/*");
    expect(lv.defaultRegion).toBe("bottom");

    const si = registry.get("StatusIndicator")!;
    expect(si.defaultRegion).toBe("status-bar");
  });

  it("factory calls trigger dynamic import", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const FakeComponent = () => null;
    const importFn = makeImportFn({ LogViewerComponent: FakeComponent });
    const loader = new WidgetLoader(registry, importFn);

    await loader.loadManifest(MANIFEST_A_URL);

    const def = registry.get("LogViewer")!;
    expect(importFn).not.toHaveBeenCalled();

    await def.factory({ parameters: {} });
    expect(importFn).toHaveBeenCalledWith("./LogViewer");
  });

  it("factory is cached — second call reuses the first import promise", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const FakeComponent = () => null;
    const importFn = makeImportFn({ LogViewerComponent: FakeComponent });
    const loader = new WidgetLoader(registry, importFn);

    await loader.loadManifest(MANIFEST_A_URL);

    const def = registry.get("LogViewer")!;
    await def.factory({ parameters: {} });
    await def.factory({ parameters: {} });

    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it("duplicate widget name is skipped with console.warn and does not throw", async () => {
    const registry = new WidgetRegistry();
    registry.register({
      name: "LogViewer",
      description: "pre-existing",
      channelPattern: "log/*",
      consumes: ["text/plain"],
      priority: 5,
      parameters: {},
      factory: () => () => null,
    });

    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await expect(loader.loadManifest(MANIFEST_A_URL)).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("LogViewer"));
    expect(registry.get("StatusIndicator")).toBeDefined();
  });

  it("manifest fetch failure rejects loadManifest with descriptive error", async () => {
    const registry = new WidgetRegistry();
    mockFetchFailure("connection refused");
    const loader = new WidgetLoader(registry);

    await expect(loader.loadManifest(MANIFEST_A_URL)).rejects.toThrow(
      "connection refused",
    );
  });

  it("non-ok HTTP response rejects loadManifest with descriptive error", async () => {
    const registry = new WidgetRegistry();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }),
    );
    const loader = new WidgetLoader(registry);

    await expect(loader.loadManifest(MANIFEST_A_URL)).rejects.toThrow("404");
  });

  it("calling loadManifest twice with the same URL is a no-op — does not throw", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    // Second call should resolve without error and without re-fetching
    await expect(loader.loadManifest(MANIFEST_A_URL)).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls for the same URL coalesce into a single fetch", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await Promise.all([
      loader.loadManifest(MANIFEST_A_URL),
      loader.loadManifest(MANIFEST_A_URL),
      loader.loadManifest(MANIFEST_A_URL),
    ]);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(registry.get("LogViewer")).toBeDefined();
  });

  it("dispose unregisters all widgets across all loaded manifests", async () => {
    const registry = new WidgetRegistry();
    mockFetchByUrl({ [MANIFEST_A_URL]: MANIFEST_A, [MANIFEST_B_URL]: MANIFEST_B });
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    await loader.loadManifest(MANIFEST_B_URL);
    expect(registry.list()).toHaveLength(3);

    loader.dispose();
    expect(registry.list()).toHaveLength(0);
  });

  it("dispose after dispose is a no-op", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    loader.dispose();

    expect(() => loader.dispose()).not.toThrow();
    expect(registry.list()).toHaveLength(0);
  });

  // ─── Multiple manifests ────────────────────────────────────────────────────

  it("loads two manifests independently — widgets from both are registered", async () => {
    const registry = new WidgetRegistry();
    mockFetchByUrl({ [MANIFEST_A_URL]: MANIFEST_A, [MANIFEST_B_URL]: MANIFEST_B });
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    await loader.loadManifest(MANIFEST_B_URL);

    expect(registry.get("LogViewer")).toBeDefined();
    expect(registry.get("StatusIndicator")).toBeDefined();
    expect(registry.get("ChartWidget")).toBeDefined();
    expect(registry.list()).toHaveLength(3);
  });

  it("unloadManifest removes only widgets from that manifest", async () => {
    const registry = new WidgetRegistry();
    mockFetchByUrl({ [MANIFEST_A_URL]: MANIFEST_A, [MANIFEST_B_URL]: MANIFEST_B });
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    await loader.loadManifest(MANIFEST_B_URL);

    loader.unloadManifest(MANIFEST_A_URL);

    // Manifest A widgets gone
    expect(registry.get("LogViewer")).toBeUndefined();
    expect(registry.get("StatusIndicator")).toBeUndefined();
    // Manifest B widget still present
    expect(registry.get("ChartWidget")).toBeDefined();
  });

  it("unloadManifest on unknown URL is a no-op", () => {
    const registry = new WidgetRegistry();
    const loader = new WidgetLoader(registry);

    expect(() => loader.unloadManifest("/never-loaded.json")).not.toThrow();
  });

  it("after unloadManifest, the same URL can be reloaded", async () => {
    const registry = new WidgetRegistry();
    mockFetchManifest(MANIFEST_A);
    const loader = new WidgetLoader(registry);

    await loader.loadManifest(MANIFEST_A_URL);
    loader.unloadManifest(MANIFEST_A_URL);
    expect(registry.get("LogViewer")).toBeUndefined();

    await loader.loadManifest(MANIFEST_A_URL);
    expect(registry.get("LogViewer")).toBeDefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("two manifests can be loaded concurrently without interference", async () => {
    const registry = new WidgetRegistry();
    mockFetchByUrl({ [MANIFEST_A_URL]: MANIFEST_A, [MANIFEST_B_URL]: MANIFEST_B });
    const loader = new WidgetLoader(registry);

    await Promise.all([
      loader.loadManifest(MANIFEST_A_URL),
      loader.loadManifest(MANIFEST_B_URL),
    ]);

    expect(registry.list()).toHaveLength(3);
  });
});
