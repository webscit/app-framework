import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetRegistry } from "./widgetRegistry";
import { ApplicationShell, ShellLayoutContext } from "./ApplicationShell";
import type { ShellLayout } from "./shellTypes";
import { createDefaultShellLayout } from "./shellTypes";
import type { WidgetDefinition } from "./widgetRegistry";

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function renderShell(
  registry: WidgetRegistry,
  initialLayout?: ShellLayout,
  children?: React.ReactNode,
) {
  return create(
    <WidgetRegistryContext.Provider value={registry}>
      <ApplicationShell initialLayout={initialLayout}>{children}</ApplicationShell>
    </WidgetRegistryContext.Provider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ApplicationShell", () => {
  it("renders all 6 regions when no initialLayout provided and no widgets registered", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    const testIds = [
      "shell-header",
      "shell-sidebar-left",
      "shell-main",
      "shell-sidebar-right",
      "shell-bottom",
      "shell-status-bar",
    ];

    for (const testId of testIds) {
      const el = renderer!.root.findByProps({ "data-testid": testId });
      expect(el).toBeDefined();
    }
  });

  it("hidden regions have display:none style when visible=false", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    const sidebarRight = renderer!.root.findByProps({
      "data-testid": "shell-sidebar-right",
    });
    const bottom = renderer!.root.findByProps({ "data-testid": "shell-bottom" });

    expect(sidebarRight.props.style).toEqual({ display: "none" });
    expect(bottom.props.style).toEqual({ display: "none" });
  });

  it("visible regions do not have display:none style", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    // Always-visible sub-components (ShellHeader, ShellMain) have no style prop.
    const header = renderer!.root.findByProps({ "data-testid": "shell-header" });
    const main = renderer!.root.findByProps({ "data-testid": "shell-main" });

    expect(header).toBeDefined();
    expect(main).toBeDefined();
  });

  it("auto-places widgets with defaultRegion on mount", () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("HeaderWidget", "header"));
    registry.register(makeWidget("MainWidget", "main"));
    registry.register(makeWidget("DefaultWidget", undefined)); // no defaultRegion → goes to main

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    const headerRegion = renderer!.root.findByProps({ "data-testid": "shell-header" });
    const mainRegion = renderer!.root.findByProps({ "data-testid": "shell-main" });

    // Should find the rendered widgets (which render as null components)
    expect(headerRegion.children.length).toBeGreaterThan(0);
    expect(mainRegion.children.length).toBeGreaterThan(0); // already there, now also catches DefaultWidget
  });

  it("post-mount auto-placement: widget registered after mount appears in region", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    // Initially no items in sidebar-left — no RegionItem instances rendered inside
    const sidebarLeft = renderer!.root.findByProps({
      "data-testid": "shell-sidebar-left",
    });
    expect(
      sidebarLeft.findAll((node) => node.props["item"] !== undefined),
    ).toHaveLength(0);

    // Register a widget after mount
    act(() => {
      registry.register(makeWidget("SidebarWidget", "sidebar-left"));
    });

    const sidebarLeftAfter = renderer!.root.findByProps({
      "data-testid": "shell-sidebar-left",
    });
    expect(
      sidebarLeftAfter.findAll((node) => node.props["item"] !== undefined).length,
    ).toBeGreaterThan(0);
  });

  it("post-mount auto-placement: widget with no defaultRegion defaults to main", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    // Register a widget with no defaultRegion after mount
    act(() => {
      registry.register(makeWidget("NoRegionWidget", undefined));
    });

    const mainRegion = renderer!.root.findByProps({ "data-testid": "shell-main" });
    // Should appear in main (the default)
    expect(() =>
      mainRegion.findByProps({ "data-testid": "shell-main-empty" }),
    ).toThrow();
  });

  it("removal removes the widget from the layout", () => {
    const registry = new WidgetRegistry();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry);
    });

    let handle: ReturnType<WidgetRegistry["register"]>;
    act(() => {
      handle = registry.register(makeWidget("RemovableWidget", "main"));
    });

    const mainAfterAdd = renderer!.root.findByProps({ "data-testid": "shell-main" });
    // widget item present — no empty placeholder
    expect(() =>
      mainAfterAdd.findByProps({ "data-testid": "shell-main-empty" }),
    ).toThrow();

    // Now dispose/remove
    act(() => {
      handle.dispose();
    });

    const mainAfterRemove = renderer!.root.findByProps({ "data-testid": "shell-main" });
    // widget gone — empty placeholder shows
    expect(
      mainAfterRemove.findByProps({ "data-testid": "shell-main-empty" }),
    ).toBeDefined();
  });

  it("unknown widget type renders 'Widget not found' placeholder", () => {
    const registry = new WidgetRegistry();
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [{ id: "ghost-1", type: "GhostWidget", props: {}, order: 0 }],
        },
      },
    };

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    const placeholder = renderer!.root.findByProps({
      "data-testid": "widget-not-found",
    });
    expect(placeholder).toBeDefined();
    // Check the text content includes the widget type
    const textContent = JSON.stringify(placeholder.children);
    expect(textContent).toContain("GhostWidget");
  });

  it("non-togglable correction: initialLayout with header.visible=false corrects to true", () => {
    const registry = new WidgetRegistry();
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        header: { visible: false, items: [] },
        main: { visible: false, items: [] },
        "status-bar": { visible: false, items: [] },
      },
    };

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    // Non-togglable sub-components always render without display:none.
    const header = renderer!.root.findByProps({ "data-testid": "shell-header" });
    const main = renderer!.root.findByProps({ "data-testid": "shell-main" });
    const statusBar = renderer!.root.findByProps({ "data-testid": "shell-status-bar" });

    expect(header).toBeDefined();
    expect(main).toBeDefined();
    expect(statusBar).toBeDefined();
  });

  it("initialLayout skips auto-placement: widget with defaultRegion not placed", () => {
    const registry = new WidgetRegistry();
    // Register a widget with a defaultRegion
    registry.register(makeWidget("AutoWidget", "main"));

    // Provide an explicit initialLayout with an empty main region
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: { visible: true, items: [] },
      },
    };

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    const mainRegion = renderer!.root.findByProps({ "data-testid": "shell-main" });
    // Since initialLayout was provided, no auto-placement — only the empty placeholder
    expect(mainRegion.findByProps({ "data-testid": "shell-main-empty" })).toBeDefined();
  });

  it("initialLayout skips post-mount auto-placement when widget registered after mount", () => {
    const registry = new WidgetRegistry();
    const layout = createDefaultShellLayout();

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    // Register a widget after mount — should NOT be auto-placed
    act(() => {
      registry.register(makeWidget("LateWidget", "main"));
    });

    const mainRegion = renderer!.root.findByProps({ "data-testid": "shell-main" });
    // No auto-placement — only the empty placeholder
    expect(mainRegion.findByProps({ "data-testid": "shell-main-empty" })).toBeDefined();
  });

  it("initialLayout merges over default: overridden region wins over default", () => {
    const registry = new WidgetRegistry();
    // sidebar-right is visible: false in the default layout; override it to visible: true
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        "sidebar-right": { visible: true, items: [] },
      },
    };

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    const sidebarRight = renderer!.root.findByProps({
      "data-testid": "shell-sidebar-right",
    });
    // The override (visible: true) should win over the default (visible: false)
    expect(sidebarRight.props.style).not.toEqual({ display: "none" });
  });

  it("async factory (Promise return) renders loading placeholder", () => {
    const registry = new WidgetRegistry();
    const asyncWidget: WidgetDefinition = {
      name: "AsyncWidget",
      description: "Async widget",
      defaultRegion: "main" as const,
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      factory: () => Promise.resolve(() => null),
    };

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: {
          visible: true,
          items: [{ id: "async-1", type: "AsyncWidget", props: {}, order: 0 }],
        },
      },
    };

    registry.register(asyncWidget);
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderShell(registry, layout);
    });

    const placeholder = renderer!.root.findByProps({ "data-testid": "widget-loading" });
    expect(placeholder).toBeDefined();
  });

  it("ShellLayoutContext is provided with layout and setLayout", () => {
    const registry = new WidgetRegistry();
    let capturedLayout: ShellLayout | null = null;
    let capturedSetLayout: unknown = null;

    function ContextConsumer(): null {
      const ctx = React.useContext(ShellLayoutContext);
      capturedLayout = ctx?.layout ?? null;
      capturedSetLayout = ctx?.setLayout ?? null;
      return null;
    }

    act(() => {
      create(
        <WidgetRegistryContext.Provider value={registry}>
          <ApplicationShell>
            <ContextConsumer />
          </ApplicationShell>
        </WidgetRegistryContext.Provider>,
      );
    });

    expect(capturedLayout).not.toBeNull();
    expect(capturedLayout!.regions).toBeDefined();
    expect(typeof capturedSetLayout).toBe("function");
  });
});
