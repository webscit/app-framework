import React, { act, useEffect } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { EventBusProvider } from "./EventBusContext";
import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetLoaderProvider } from "./WidgetLoaderContext";
import type { WebSocketLike } from "./client";
import { useWidgetLoader } from "./useWidgetLoader";
import { WidgetRegistry } from "./widgetRegistry";
import type { SctManifest } from "./widgetLoader";

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
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MANIFEST_A_URL = "/plugin-a/sct-manifest.json";
const MANIFEST_B_URL = "/plugin-b/sct-manifest.json";

const EMPTY_MANIFEST: SctManifest = { version: "1.0.0", widgets: [] };

const MANIFEST_WITH_WIDGET: SctManifest = {
  version: "1.0.0",
  widgets: [
    {
      name: "TestWidget",
      description: "test",
      channelPattern: "test/*",
      consumes: ["text/plain"],
      priority: 1,
      parameters: {},
      module: "./Test",
      export: "TestComponent",
    },
  ],
};

const MANIFEST_B_WITH_WIDGET: SctManifest = {
  version: "1.0.0",
  widgets: [
    {
      name: "ChartWidget",
      description: "chart",
      channelPattern: "data/*",
      consumes: ["application/json"],
      priority: 1,
      parameters: {},
      module: "./Chart",
      export: "ChartComponent",
    },
  ],
};

function mockFetchManifest(manifest: SctManifest): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(manifest),
    }),
  );
}

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

function mockFetchFailure(): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
}

// ─── Test harness ─────────────────────────────────────────────────────────────

type Status = "loading" | "ready" | "error";

function Probe({
  url,
  onStatus,
}: {
  url: string;
  onStatus: (s: Status) => void;
}): React.ReactElement | null {
  const status = useWidgetLoader(url);
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  return null;
}

function makeTree(
  registry: WidgetRegistry,
  probes: Array<{ url: string; onStatus: (s: Status) => void }>,
): React.ReactElement {
  const socket = new FakeWebSocket();
  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <WidgetLoaderProvider>
          {probes.map(({ url, onStatus }, index) => (
            <Probe key={`${url}-${index}`} url={url} onStatus={onStatus} />
          ))}
        </WidgetLoaderProvider>
      </EventBusProvider>
    </WidgetRegistryContext.Provider>
  );
}

function makeSingleTree(
  registry: WidgetRegistry,
  url: string,
  onStatus: (s: Status) => void,
): React.ReactElement {
  return makeTree(registry, [{ url, onStatus }]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useWidgetLoader", () => {
  it('returns "loading" immediately after mount', async () => {
    mockFetchManifest(EMPTY_MANIFEST);
    const registry = new WidgetRegistry();
    const statuses: Status[] = [];

    await render(makeSingleTree(registry, MANIFEST_A_URL, (s) => statuses.push(s)));

    expect(statuses[0]).toBe("loading");
  });

  it('returns "ready" after manifest loads', async () => {
    mockFetchManifest(EMPTY_MANIFEST);
    const registry = new WidgetRegistry();
    const statuses: Status[] = [];

    await render(makeSingleTree(registry, MANIFEST_A_URL, (s) => statuses.push(s)));

    await act(async () => {
      await Promise.resolve();
    });

    expect(statuses).toContain("ready");
  });

  it('returns "error" when manifest load fails', async () => {
    mockFetchFailure();
    const registry = new WidgetRegistry();
    const statuses: Status[] = [];

    await render(makeSingleTree(registry, MANIFEST_A_URL, (s) => statuses.push(s)));

    await act(async () => {
      await Promise.resolve();
    });

    expect(statuses).toContain("error");
  });

  it("unloads manifest on unmount — widgets are removed", async () => {
    mockFetchManifest(MANIFEST_WITH_WIDGET);
    const registry = new WidgetRegistry();
    const statuses: Status[] = [];

    const { unmount } = await render(
      makeSingleTree(registry, MANIFEST_A_URL, (s) => statuses.push(s)),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(registry.get("TestWidget")).toBeDefined();

    await unmount();

    expect(registry.get("TestWidget")).toBeUndefined();
  });

  it("transitions from loading → ready", async () => {
    mockFetchManifest(EMPTY_MANIFEST);
    const registry = new WidgetRegistry();
    const statuses: Status[] = [];

    await render(makeSingleTree(registry, MANIFEST_A_URL, (s) => statuses.push(s)));

    await act(async () => {
      await Promise.resolve();
    });

    expect(statuses).toEqual(expect.arrayContaining(["loading", "ready"]));
    expect(statuses.indexOf("loading")).toBeLessThan(statuses.lastIndexOf("ready"));
  });

  it("two hooks sharing one WidgetLoaderProvider register widgets from both manifests", async () => {
    mockFetchByUrl({
      [MANIFEST_A_URL]: MANIFEST_WITH_WIDGET,
      [MANIFEST_B_URL]: MANIFEST_B_WITH_WIDGET,
    });
    const registry = new WidgetRegistry();
    const statusA: Status[] = [];
    const statusB: Status[] = [];

    await render(
      makeTree(registry, [
        { url: MANIFEST_A_URL, onStatus: (s) => statusA.push(s) },
        { url: MANIFEST_B_URL, onStatus: (s) => statusB.push(s) },
      ]),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(statusA).toContain("ready");
    expect(statusB).toContain("ready");
    expect(registry.get("TestWidget")).toBeDefined();
    expect(registry.get("ChartWidget")).toBeDefined();
  });

  it("unmounting one hook unloads only its manifest — the other remains", async () => {
    mockFetchByUrl({
      [MANIFEST_A_URL]: MANIFEST_WITH_WIDGET,
      [MANIFEST_B_URL]: MANIFEST_B_WITH_WIDGET,
    });
    const registry = new WidgetRegistry();
    const statusA: Status[] = [];
    const statusB: Status[] = [];
    const socket = new FakeWebSocket();

    let setShowA!: (v: boolean) => void;

    function Shell() {
      const [showA, setA] = React.useState(true);
      setShowA = setA;
      return (
        <WidgetRegistryContext.Provider value={registry}>
          <EventBusProvider path="/ws" webSocketFactory={() => socket}>
            <WidgetLoaderProvider>
              {showA && (
                <Probe url={MANIFEST_A_URL} onStatus={(s) => statusA.push(s)} />
              )}
              <Probe url={MANIFEST_B_URL} onStatus={(s) => statusB.push(s)} />
            </WidgetLoaderProvider>
          </EventBusProvider>
        </WidgetRegistryContext.Provider>
      );
    }

    await render(<Shell />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(registry.get("TestWidget")).toBeDefined();
    expect(registry.get("ChartWidget")).toBeDefined();

    act(() => {
      setShowA(false);
    });

    expect(registry.get("TestWidget")).toBeUndefined();
    expect(registry.get("ChartWidget")).toBeDefined();
  });

  it("same URL used by two hooks only fetches once", async () => {
    mockFetchManifest(EMPTY_MANIFEST);
    const registry = new WidgetRegistry();
    const statusA: Status[] = [];
    const statusB: Status[] = [];

    await render(
      makeTree(registry, [
        { url: MANIFEST_A_URL, onStatus: (s) => statusA.push(s) },
        { url: MANIFEST_A_URL, onStatus: (s) => statusB.push(s) },
      ]),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(statusA).toContain("ready");
    expect(statusB).toContain("ready");
  });
});
