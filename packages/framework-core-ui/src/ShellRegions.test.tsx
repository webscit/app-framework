import React, { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { ApplicationShell } from "./ApplicationShell";
import { createDefaultShellLayout } from "./shellTypes";
import type { ShellLayout } from "./shellTypes";
import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetRegistry } from "./widgetRegistry";
import type { WidgetDefinition } from "./widgetRegistry";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWidget(
  name: string,
  defaultRegion?: WidgetDefinition["defaultRegion"],
): WidgetDefinition {
  return {
    name,
    description: `Test widget ${name}`,
    channelPattern: "data/*",
    consumes: ["text/plain"],
    priority: 10,
    parameters: {},
    defaultRegion,
    factory: () => () => null,
  };
}

async function renderWithShell(registry: WidgetRegistry, initialLayout?: ShellLayout) {
  return render(
    <WidgetRegistryContext.Provider value={registry}>
      <ApplicationShell initialLayout={initialLayout} />
    </WidgetRegistryContext.Provider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ShellHeader", () => {
  it("renders shell-header", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-header"]')).not.toBeNull();
  });
});

describe("ShellSidebar", () => {
  it("side=left renders shell-sidebar-left", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-sidebar-left"]')).not.toBeNull();
  });

  it("side=left is hidden when sidebar-left.visible=false", async () => {
    const registry = new WidgetRegistry();
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        "sidebar-left": { visible: false, items: [] },
      },
    };
    await renderWithShell(registry, layout);

    const el = document.querySelector<HTMLElement>(
      '[data-testid="shell-sidebar-left"]',
    );
    expect(el).not.toBeNull();
    // Collapsed sidebar uses width:32px instead of display:none
    expect(el!.style.width).toBe("32px");
    expect(el!.style.overflow).toBe("hidden");
  });

  it("side=right renders shell-sidebar-right", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(
      document.querySelector('[data-testid="shell-sidebar-right"]'),
    ).not.toBeNull();
  });

  it("side=right is hidden by default (visible=false)", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);

    const el = document.querySelector<HTMLElement>(
      '[data-testid="shell-sidebar-right"]',
    );
    expect(el).not.toBeNull();
    expect(el!.style.width).toBe("32px");
    expect(el!.style.overflow).toBe("hidden");
  });
});

describe("ShellMain", () => {
  it("renders shell-main", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-main"]')).not.toBeNull();
  });

  it("shows shell-main-empty placeholder when no items", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-main-empty"]')).not.toBeNull();
  });

  it("renders items when present and no empty placeholder", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("MainWidget", "main"));
    await renderWithShell(registry);

    expect(document.querySelector('[data-testid="shell-main-empty"]')).toBeNull();
  });

  it("renders items in ascending order", async () => {
    const registry = new WidgetRegistry();

    const makeOrderedWidget = (name: string): WidgetDefinition => ({
      name,
      description: name,
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      factory: () => () =>
        React.createElement("span", { "data-testid": `widget-${name}` }),
    });

    registry.register(makeOrderedWidget("WidgetA"));
    registry.register(makeOrderedWidget("WidgetB"));

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [
            { id: "a", type: "WidgetA", props: {}, order: 2 },
            { id: "b", type: "WidgetB", props: {}, order: 1 },
          ],
        },
      },
    };

    await renderWithShell(registry, layout);

    const output = document.querySelector('[data-testid="shell-main"]')!.innerHTML;
    const idxB = output.indexOf("widget-WidgetB");
    const idxA = output.indexOf("widget-WidgetA");
    expect(idxB).toBeGreaterThan(-1);
    expect(idxA).toBeGreaterThan(-1);
    // WidgetB (order:1) must appear before WidgetA (order:2)
    expect(idxB).toBeLessThan(idxA);
  });
});

describe("ShellBottom", () => {
  it("renders shell-bottom", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-bottom"]')).not.toBeNull();
  });

  it("is hidden by default (visible=false)", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);

    const el = document.querySelector<HTMLElement>('[data-testid="shell-bottom"]');
    expect(el).not.toBeNull();
    expect(el!.style.display).toBe("none");
  });
});

describe("ShellStatusBar", () => {
  it("renders shell-status-bar", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(document.querySelector('[data-testid="shell-status-bar"]')).not.toBeNull();
  });
});

describe("RegionItemRenderer (via ShellMain)", () => {
  it("renders widget-not-found placeholder for unregistered type", async () => {
    const registry = new WidgetRegistry();
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [{ id: "ghost", type: "GhostWidget", props: {}, order: 0 }],
        },
      },
    };

    await renderWithShell(registry, layout);

    const placeholder = document.querySelector('[data-testid="widget-not-found"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("GhostWidget");
  });

  it("renders widget-loading placeholder for async (Promise) factory", async () => {
    const registry = new WidgetRegistry();
    const asyncWidget: WidgetDefinition = {
      name: "AsyncWidget",
      description: "Async",
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      factory: () => new Promise(() => {}), // never resolves
    };
    registry.register(asyncWidget);

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [{ id: "a1", type: "AsyncWidget", props: {}, order: 0 }],
        },
      },
    };

    await renderWithShell(registry, layout);

    expect(document.querySelector('[data-testid="widget-loading"]')).not.toBeNull();
  });

  it("renders widget-load-error placeholder when async factory rejects", async () => {
    const registry = new WidgetRegistry();
    const failingWidget: WidgetDefinition = {
      name: "FailingWidget",
      description: "Failing",
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      factory: () => Promise.reject(new Error("load failed")),
    };
    registry.register(failingWidget);

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [{ id: "f1", type: "FailingWidget", props: {}, order: 0 }],
        },
      },
    };

    await renderWithShell(registry, layout);

    // Wait for the async factory rejection to propagate
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="widget-load-error"]')).not.toBeNull();
  });
});
