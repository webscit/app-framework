import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { AppRoot } from "./AppRoot";
import { WidgetRegistry } from "./widgetRegistry";
import { useEventBusClient } from "./EventBusContext";
import { useWidgetRegistryInstance } from "./WidgetRegistryContext";
import { useWidgetLoaderInstance } from "./WidgetLoaderContext";
import type { WebSocketLike } from "./client";

// Minimal fake socket so EventBusProvider doesn't open a real connection.
class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState = FakeWebSocket.OPEN;
  send(): void {}
  close(): void {}
}

/** Probe that succeeds only if all three framework contexts resolve. */
function Probe() {
  const client = useEventBusClient();
  const registry = useWidgetRegistryInstance();
  const loader = useWidgetLoaderInstance();
  const ok = Boolean(client) && Boolean(registry) && Boolean(loader);
  return <div>{ok ? "all-contexts-ready" : "missing-context"}</div>;
}

describe("AppRoot", () => {
  it("provides the registry, EventBus, and widget-loader contexts to children", async () => {
    const registry = new WidgetRegistry();

    await render(
      <AppRoot
        registry={registry}
        webSocketPath="/ws"
        webSocketFactory={() => new FakeWebSocket()}
      >
        <Probe />
      </AppRoot>,
    );

    await expect.element(page.getByText("all-contexts-ready")).toBeInTheDocument();
  });

  it("shares the provided registry instance with descendants", async () => {
    const registry = new WidgetRegistry();
    let seen: WidgetRegistry | null = null;

    function Capture() {
      seen = useWidgetRegistryInstance();
      return null;
    }

    await render(
      <AppRoot registry={registry} webSocketFactory={() => new FakeWebSocket()}>
        <Capture />
      </AppRoot>,
    );

    expect(seen).toBe(registry);
  });
});
