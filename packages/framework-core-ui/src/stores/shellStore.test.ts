import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultShellLayout, SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import { clearPersistedLayout, useShellLayoutStore } from "./shellStore";

const STORAGE_KEY = "app-framework:shell-layout";

// ─── helpers ──────────────────────────────────────────────────────────────────

function getStoredLayout() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as { state: { layout: unknown }; version: number };
}

function setStoredLayout(state: unknown, version = SHELL_LAYOUT_STORAGE_VERSION) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  useShellLayoutStore.setState({ layout: createDefaultShellLayout() });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("persist — saving", () => {
  it("saves layout to localStorage when setLayout is called", () => {
    const { setLayout } = useShellLayoutStore.getState();

    setLayout((prev) => ({
      ...prev,
      regions: { ...prev.regions, bottom: { visible: true, items: [] } },
    }));

    const stored = getStoredLayout();
    expect(stored).not.toBeNull();
    expect(stored!.state.layout).toMatchObject({
      regions: { bottom: { visible: true } },
    });
  });

  it("stored value includes the schema version", () => {
    const { setLayout } = useShellLayoutStore.getState();
    setLayout((prev) => prev);

    const stored = getStoredLayout();
    expect(stored!.version).toBe(SHELL_LAYOUT_STORAGE_VERSION);
  });
});

describe("persist — restoring", () => {
  it("restores layout from localStorage on rehydrate", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions["sidebar-right"] = { visible: true, items: [] };
    setStoredLayout({ layout: customLayout });

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout.regions["sidebar-right"].visible).toBe(true);
  });

  it("falls back to createDefaultShellLayout() when no stored key exists", async () => {
    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });

  it("falls back to createDefaultShellLayout() when stored value is corrupted", async () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });
});

describe("persist — migration", () => {
  it("version 0 passes through state as-is", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions.bottom = { visible: true, items: [] };
    setStoredLayout({ layout: customLayout }, 0);

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout.regions.bottom.visible).toBe(true);
  });

  it("unknown version falls back to default layout", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions.bottom = { visible: true, items: [] };
    setStoredLayout({ layout: customLayout }, 99);

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });
});

describe("clearPersistedLayout", () => {
  it("clears localStorage and resets store to default", () => {
    const { setLayout } = useShellLayoutStore.getState();

    setLayout((prev) => ({
      ...prev,
      regions: { ...prev.regions, bottom: { visible: true, items: [] } },
    }));

    expect(getStoredLayout()).not.toBeNull();

    clearPersistedLayout();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(useShellLayoutStore.getState().layout).toEqual(createDefaultShellLayout());
  });
});

describe("non-togglable region correction", () => {
  it("store restores visible:false as-is — correction is ApplicationShell's responsibility", async () => {
    const corruptedLayout = createDefaultShellLayout();
    corruptedLayout.regions.header = { visible: false, items: [] };
    setStoredLayout({ layout: corruptedLayout });

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout.regions.header.visible).toBe(false);
  });
});
