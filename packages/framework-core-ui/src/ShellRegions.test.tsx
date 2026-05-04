import React, { act } from "react";
import { page } from "vitest/browser";
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
  it("renders header landmark", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(page.getByRole("banner").query()).not.toBeNull();
  });
});

describe("ShellSidebar", () => {
  it("side=left renders left sidebar", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(
      page.getByRole("complementary", { name: "left sidebar" }).query(),
    ).not.toBeNull();
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

    const el = page
      .getByRole("complementary", { name: "left sidebar" })
      .element() as HTMLElement;
    expect(el).not.toBeNull();
    // Collapsed sidebar uses width:32px instead of display:none
    expect(el.style.width).toBe("32px");
    expect(el.style.overflow).toBe("hidden");
  });

  it("side=right renders right sidebar", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(
      page.getByRole("complementary", { name: "right sidebar" }).query(),
    ).not.toBeNull();
  });

  it("side=right is hidden by default (visible=false)", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);

    const el = page
      .getByRole("complementary", { name: "right sidebar" })
      .element() as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.width).toBe("32px");
    expect(el.style.overflow).toBe("hidden");
  });
});

describe("ShellMain", () => {
  it("renders main landmark", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(page.getByRole("main").query()).not.toBeNull();
  });

  it("shows empty placeholder when no items", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(page.getByText("No widgets placed").query()).not.toBeNull();
  });

  it("renders items when present and no empty placeholder", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("MainWidget", "main"));
    await renderWithShell(registry);

    expect(page.getByText("No widgets placed").query()).toBeNull();
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
      factory: () => () => React.createElement("span", null, name),
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

    const output = page.getByRole("main").element().innerHTML;
    const idxB = output.indexOf("WidgetB");
    const idxA = output.indexOf("WidgetA");
    expect(idxB).toBeGreaterThan(-1);
    expect(idxA).toBeGreaterThan(-1);
    // WidgetB (order:1) must appear before WidgetA (order:2)
    expect(idxB).toBeLessThan(idxA);
  });
});

describe("ShellBottom", () => {
  it("renders bottom panel region", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(
      page.getByRole("region", { name: "bottom panel", includeHidden: true }).query(),
    ).not.toBeNull();
  });

  it("is hidden by default (visible=false)", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);

    const el = page
      .getByRole("region", { name: "bottom panel", includeHidden: true })
      .element() as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });
});

describe("ShellStatusBar", () => {
  it("renders contentinfo landmark", async () => {
    const registry = new WidgetRegistry();
    await renderWithShell(registry);
    expect(page.getByRole("contentinfo").query()).not.toBeNull();
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

    const placeholder = page.getByText(/Widget not found/).element();
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain("GhostWidget");
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

    expect(page.getByText(/Loading:/).query()).not.toBeNull();
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(page.getByText(/Failed to load:/).query()).not.toBeNull();
  });

  it("passes item.props to the rendered widget component", async () => {
    const registry = new WidgetRegistry();
    const receivedProps: Record<string, unknown>[] = [];

    const propsWidget: WidgetDefinition = {
      name: "PropsWidget",
      description: "Records received props",
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      factory: () => (props: Record<string, unknown>) => {
        receivedProps.push(props);
        return React.createElement("span", null, String(props["label"] ?? ""));
      },
    };
    registry.register(propsWidget);

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [
            {
              id: "pw1",
              type: "PropsWidget",
              props: { label: "hello", value: 42 },
              order: 0,
            },
          ],
        },
      },
    };

    await renderWithShell(registry, layout);

    const el = page.getByText("hello").element();
    expect(el).not.toBeNull();
    expect(el.textContent).toBe("hello");
    expect(receivedProps[0]).toMatchObject({ label: "hello", value: 42 });
  });
});
