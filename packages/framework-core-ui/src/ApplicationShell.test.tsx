import React, { act } from "react";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, describe, expect, it } from "vitest";

import { WidgetRegistryContext } from "./WidgetRegistryContext";
import { WidgetRegistry } from "./widgetRegistry";
import { ApplicationShell } from "./ApplicationShell";
import type { ShellLayout } from "./shellTypes";
import { createDefaultShellLayout } from "./shellTypes";
import { clearPersistedLayout, useShellLayoutStore } from "./stores/shellStore";
import type { WidgetDefinition } from "./widgetRegistry";

// The layout store is a module singleton shared across tests; reset it so each
// test mounts into a fresh, empty "Default" profile that the shell will seed.
beforeEach(() => {
  clearPersistedLayout();
});

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

describe("ApplicationShell layout profiles — size restore", () => {
  const bottomHeight = () => {
    const region = page
      .getByRole("region", { name: "bottom panel", includeHidden: true })
      .element() as HTMLElement;
    const panel = region.closest("[data-panel]") as HTMLElement;
    return panel.getBoundingClientRect().height;
  };

  function layoutWithBottomSize(size: number | undefined): ShellLayout {
    const l = createDefaultShellLayout();
    l.regions.bottom = {
      visible: true,
      size,
      items: [{ id: "Log", type: "Log", props: {} }],
    };
    return l;
  }

  const settle = () => new Promise((r) => setTimeout(r, 60));

  it("restores the bottom panel size when switching profiles", async () => {
    // The shell takes its height from the consumer app's CSS; replicate that
    // full-height flex chain here so percentage panel sizes are measurable.
    const style = document.createElement("style");
    style.textContent = `
      .sct-ApplicationShell { height: 600px; display: flex; flex-direction: column; }
      .sct-ApplicationShell-Body { flex: 1 1 auto; min-height: 0; }
    `;
    document.head.appendChild(style);

    const registry = new WidgetRegistry();
    registry.register(makeWidget("Log", "bottom"));
    await renderShell(registry, layoutWithBottomSize(20));
    await settle();

    // Two saved profiles with very different bottom heights, plus a size-less
    // "Default" that must fall back to the shell default.
    act(() => {
      useShellLayoutStore.setState({
        profiles: [
          { id: "default", name: "Default", layout: layoutWithBottomSize(undefined) },
          { id: "big", name: "Big", layout: layoutWithBottomSize(50) },
          { id: "small", name: "Small", layout: layoutWithBottomSize(10) },
        ],
        activeProfileId: "default",
        workingLayout: layoutWithBottomSize(undefined),
        defaultLayout: layoutWithBottomSize(undefined),
      });
    });

    act(() => useShellLayoutStore.getState().switchProfile("big"));
    await settle();
    const big = bottomHeight();

    act(() => useShellLayoutStore.getState().switchProfile("small"));
    await settle();
    const small = bottomHeight();

    act(() => useShellLayoutStore.getState().switchProfile("default"));
    await settle();
    const dflt = bottomHeight();

    document.head.removeChild(style);

    // The saved sizes must produce visibly different panel heights, and the
    // size-less "Default" must land between them (its shell-default fallback) —
    // proof the switch restores real sizes rather than keeping the previous one.
    expect(big).toBeGreaterThan(small * 2);
    expect(dflt).toBeGreaterThan(small);
    expect(dflt).toBeLessThan(big);
  });
});

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
    expect(bottom.className).toContain("sct-ShellBottom--collapsed");
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

  // ─── Built-in AI assistant (ai prop) ────────────────────────────────────────

  it("renders the AI assistant tab when `ai` is configured", async () => {
    const registry = new WidgetRegistry();
    await render(
      <WidgetRegistryContext.Provider value={registry}>
        <ApplicationShell ai={{ apiUrl: "/api/ai/layout" }} />
      </WidgetRegistryContext.Provider>,
    );

    await expect
      .element(page.getByRole("button", { name: "Open AI assistant" }))
      .toBeInTheDocument();
  });

  it("does not render the AI assistant tab when `ai` is omitted", async () => {
    const registry = new WidgetRegistry();
    await renderShell(registry);

    expect(page.getByRole("button", { name: "Open AI assistant" }).query()).toBeNull();
  });

  it("opens the AI assistant panel when the tab is clicked", async () => {
    const registry = new WidgetRegistry();
    await render(
      <WidgetRegistryContext.Provider value={registry}>
        <ApplicationShell ai={{ apiUrl: "/api/ai/layout" }} />
      </WidgetRegistryContext.Provider>,
    );

    (
      page.getByRole("button", { name: "Open AI assistant" }).element() as HTMLElement
    ).click();

    await expect
      .element(page.getByRole("heading", { name: "AI Layout Assistant" }))
      .toBeInTheDocument();
  });
});
