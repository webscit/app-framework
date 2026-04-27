import React, { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetRegistry } from "./widgetRegistry";
import { ApplicationShell } from "./ApplicationShell";
import type { ShellLayout } from "./shellTypes";
import { createDefaultShellLayout } from "./shellTypes";
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

async function renderShell(registry: WidgetRegistry, initialLayout?: ShellLayout) {
  return render(
    <WidgetRegistryContext.Provider value={registry}>
      <ApplicationShell initialLayout={initialLayout} />
    </WidgetRegistryContext.Provider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ApplicationShell", () => {
  it("renders all 6 regions when no initialLayout provided and no widgets registered", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    const testIds = [
      "shell-header",
      "shell-sidebar-left",
      "shell-main",
      "shell-sidebar-right",
      "shell-bottom",
      "shell-status-bar",
    ];

    for (const testId of testIds) {
      expect(document.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }
  });

  it("hidden regions have correct style when visible=false", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    // sidebar-right is collapsed (width:32px), bottom is hidden (display:none)
    const sidebarRight = document.querySelector<HTMLElement>(
      '[data-testid="shell-sidebar-right"]',
    );
    const bottom = document.querySelector<HTMLElement>('[data-testid="shell-bottom"]');

    expect(sidebarRight).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(bottom!.style.display).toBe("none");
  });

  it("visible regions are rendered", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    expect(document.querySelector('[data-testid="shell-header"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shell-main"]')).not.toBeNull();
  });

  it("auto-places widgets with defaultRegion on mount", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("HeaderWidget", "header"));
    registry.register(makeWidget("MainWidget", "main"));
    // No defaultRegion → goes to main
    registry.register(makeWidget("DefaultWidget", undefined));

    await renderShell(registry);

    // main should not show the empty placeholder since widgets are placed there
    expect(document.querySelector('[data-testid="shell-main-empty"]')).toBeNull();
  });

  it("post-mount auto-placement: widget registered after mount appears in region", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    // No widgets yet — empty placeholder visible
    expect(document.querySelector('[data-testid="shell-main-empty"]')).not.toBeNull();

    await act(async () => {
      registry.register(makeWidget("MainWidget", "main"));
    });

    // After registration, placeholder should be gone
    expect(document.querySelector('[data-testid="shell-main-empty"]')).toBeNull();
  });

  it("post-mount auto-placement: widget with no defaultRegion defaults to main", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    await act(async () => {
      registry.register(makeWidget("NoRegionWidget", undefined));
    });

    // Widget should appear in main — empty placeholder gone
    expect(document.querySelector('[data-testid="shell-main-empty"]')).toBeNull();
  });

  it("removal removes the widget from the layout", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    let handle: ReturnType<WidgetRegistry["register"]>;
    await act(async () => {
      handle = registry.register(makeWidget("RemovableWidget", "main"));
    });

    // Widget present — no empty placeholder
    expect(document.querySelector('[data-testid="shell-main-empty"]')).toBeNull();

    await act(async () => {
      handle.dispose();
    });

    // Widget gone — empty placeholder shows
    expect(document.querySelector('[data-testid="shell-main-empty"]')).not.toBeNull();
  });

  it("unknown widget type renders 'Widget not found' placeholder", async () => {
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

    await renderShell(registry, layout);

    const placeholder = document.querySelector('[data-testid="widget-not-found"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("GhostWidget");
  });

  it("non-togglable correction: initialLayout with header/main/status-bar visible=false corrects to true", async () => {
    const registry = new WidgetRegistry();
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        header: { visible: false, items: [] },
        main: { visible: false, items: [] },
        "status-bar": { visible: false, items: [] },
      },
    };

    await renderShell(registry, layout);

    // Non-togglable regions always render
    expect(document.querySelector('[data-testid="shell-header"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shell-main"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shell-status-bar"]')).not.toBeNull();
  });

  it("initialLayout skips auto-placement: widget with defaultRegion not placed", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("AutoWidget", "main"));

    // Explicit empty main — auto-placement should be skipped
    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: { visible: true, items: [] },
      },
    };

    await renderShell(registry, layout);

    expect(document.querySelector('[data-testid="shell-main-empty"]')).not.toBeNull();
  });

  it("initialLayout skips post-mount auto-placement when widget registered after mount", async () => {
    const registry = new WidgetRegistry();
    const layout = createDefaultShellLayout();

    await renderShell(registry, layout);

    await act(async () => {
      registry.register(makeWidget("LateWidget", "main"));
    });

    // No auto-placement when initialLayout was provided
    expect(document.querySelector('[data-testid="shell-main-empty"]')).not.toBeNull();
  });

  it("async factory (Promise return) renders loading placeholder", async () => {
    const registry = new WidgetRegistry();
    const asyncWidget: WidgetDefinition = {
      name: "AsyncWidget",
      description: "Async widget",
      defaultRegion: "main" as const,
      channelPattern: "data/*",
      consumes: ["text/plain"],
      priority: 10,
      parameters: {},
      // Never resolves — keeps loading state permanently
      factory: () => new Promise(() => {}),
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
    await renderShell(registry, layout);

    expect(document.querySelector('[data-testid="widget-loading"]')).not.toBeNull();
  });

  it("ShellLayoutContext is provided — shell-layout and shell-main are rendered", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    expect(document.querySelector('[data-testid="shell-layout"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shell-main"]')).not.toBeNull();
  });
});
