import React, { act } from "react";
import { page } from "vitest/browser";
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

    expect(page.getByRole("banner").query()).not.toBeNull();
    expect(
      page.getByRole("complementary", { name: "left sidebar" }).query(),
    ).not.toBeNull();
    expect(page.getByRole("main").query()).not.toBeNull();
    expect(
      page.getByRole("complementary", { name: "right sidebar" }).query(),
    ).not.toBeNull();
    expect(
      page.getByRole("region", { name: "bottom panel", includeHidden: true }).query(),
    ).not.toBeNull();
    expect(page.getByRole("contentinfo").query()).not.toBeNull();
  });

  it("hidden regions have correct style when visible=false", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    const sidebarRight = page
      .getByRole("complementary", { name: "right sidebar" })
      .element() as HTMLElement;
    const bottom = page
      .getByRole("region", { name: "bottom panel", includeHidden: true })
      .element() as HTMLElement;

    expect(sidebarRight).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(bottom.style.display).toBe("none");
  });

  it("visible regions are rendered", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    expect(page.getByRole("banner").query()).not.toBeNull();
    expect(page.getByRole("main").query()).not.toBeNull();
  });

  it("auto-places widgets with defaultRegion on mount", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("HeaderWidget", "header"));
    registry.register(makeWidget("MainWidget", "main"));
    registry.register(makeWidget("DefaultWidget", undefined));

    await renderShell(registry);

    // Widgets placed — placeholder gone
    expect(page.getByText("No widgets placed").query()).toBeNull();
  });

  it("post-mount auto-placement: widget registered after mount appears in region", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    // No widgets yet — placeholder visible
    expect(page.getByText("No widgets placed").query()).not.toBeNull();

    await act(async () => {
      registry.register(makeWidget("MainWidget", "main"));
    });

    // After registration — placeholder gone
    expect(page.getByText("No widgets placed").query()).toBeNull();
  });

  it("post-mount auto-placement: widget with no defaultRegion defaults to main", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    await act(async () => {
      registry.register(makeWidget("NoRegionWidget", undefined));
    });

    // Widget placed in main — placeholder gone
    expect(page.getByText("No widgets placed").query()).toBeNull();
  });

  it("removal removes the widget from the layout", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    let handle: ReturnType<WidgetRegistry["register"]>;
    await act(async () => {
      handle = registry.register(makeWidget("RemovableWidget", "main"));
    });

    // Widget present — no placeholder
    expect(page.getByText("No widgets placed").query()).toBeNull();

    await act(async () => {
      handle.dispose();
    });

    // Widget gone — placeholder shows
    expect(page.getByText("No widgets placed").query()).not.toBeNull();
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

    const placeholder = page.getByText(/Widget not found/).element();
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain("GhostWidget");
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

    expect(page.getByRole("banner").query()).not.toBeNull();
    expect(page.getByRole("main").query()).not.toBeNull();
    expect(page.getByRole("contentinfo").query()).not.toBeNull();
  });

  it("initialLayout skips auto-placement: widget with defaultRegion not placed", async () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget("AutoWidget", "main"));

    const layout: ShellLayout = {
      regions: {
        ...createDefaultShellLayout().regions,
        main: { visible: true, items: [] },
      },
    };

    await renderShell(registry, layout);

    expect(page.getByText("No widgets placed").query()).not.toBeNull();
  });

  it("initialLayout skips post-mount auto-placement when widget registered after mount", async () => {
    const registry = new WidgetRegistry();
    const layout = createDefaultShellLayout();

    await renderShell(registry, layout);

    await act(async () => {
      registry.register(makeWidget("LateWidget", "main"));
    });

    expect(page.getByText("No widgets placed").query()).not.toBeNull();
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

    expect(page.getByText(/Loading:/).query()).not.toBeNull();
  });

  it("ShellLayoutContext is provided — shell-layout and shell-main are rendered", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    expect(page.getByRole("main").query()).not.toBeNull();
  });
});
