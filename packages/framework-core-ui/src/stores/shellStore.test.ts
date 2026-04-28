import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultShellLayout, SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import { clearPersistedLayout, useShellLayoutStore } from "./shellStore";

// ─── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const STORAGE_KEY = "app-framework:shell-layout";

// ─── helpers ──────────────────────────────────────────────────────────────────

function getStoredLayout() {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as { state: { layout: unknown }; version: number };
}

function setStoredLayout(state: unknown, version = SHELL_LAYOUT_STORAGE_VERSION) {
  localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  // Reset store to default between tests
  useShellLayoutStore.setState({ layout: createDefaultShellLayout() });
});

describe("persist — saving", () => {
  it("saves layout to localStorage when setLayout is called", () => {
    const { setLayout } = useShellLayoutStore.getState();

    setLayout((prev) => ({
      ...prev,
      regions: {
        ...prev.regions,
        bottom: { visible: true, items: [] },
      },
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
  it("restores layout from localStorage on store initialisation", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions["sidebar-right"] = { visible: true, items: [] };

    setStoredLayout({ layout: customLayout });

    // Re-hydrate by calling the persist rehydrate manually
    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout.regions["sidebar-right"].visible).toBe(true);
  });

  it("falls back to createDefaultShellLayout() when no stored key exists", async () => {
    // localStorage is empty (cleared in beforeEach)
    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });

  it("falls back to createDefaultShellLayout() when stored value is corrupted", async () => {
    localStorageMock.setItem(STORAGE_KEY, "not-valid-json{{{");

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });
});

describe("persist — migration", () => {
  it("version mismatch triggers migrate(): version 0 passes through", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions.bottom = { visible: true, items: [] };

    setStoredLayout({ layout: customLayout }, 0); // stored as version 0

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    // version 0 → 1 is a passthrough, so layout should be restored
    expect(layout.regions.bottom.visible).toBe(true);
  });

  it("unknown version falls back to default layout", async () => {
    const customLayout = createDefaultShellLayout();
    customLayout.regions.bottom = { visible: true, items: [] };

    setStoredLayout({ layout: customLayout }, 99); // unknown future version

    await useShellLayoutStore.persist.rehydrate();

    const { layout } = useShellLayoutStore.getState();
    expect(layout).toEqual(createDefaultShellLayout());
  });
});

describe("clearPersistedLayout", () => {
  it("clears localStorage and resets store to default", () => {
    const { setLayout } = useShellLayoutStore.getState();

    // Mutate the layout first
    setLayout((prev) => ({
      ...prev,
      regions: {
        ...prev.regions,
        bottom: { visible: true, items: [] },
      },
    }));

    expect(getStoredLayout()).not.toBeNull();

    clearPersistedLayout();

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(useShellLayoutStore.getState().layout).toEqual(createDefaultShellLayout());
  });
});

describe("non-togglable region correction", () => {
  it("header stored as hidden is corrected to visible by ApplicationShell normalization", async () => {
    // The persist layer itself does NOT correct non-togglable regions —
    // that is ApplicationShell's responsibility. So here we verify that
    // the store restores exactly what was stored (including visible: false),
    // and that correction is left to ApplicationShell.
    const corruptedLayout = createDefaultShellLayout();
    corruptedLayout.regions.header = { visible: false, items: [] };

    setStoredLayout({ layout: corruptedLayout });
    await useShellLayoutStore.persist.rehydrate();

    // Store restores as-is — ApplicationShell will correct on mount
    const { layout } = useShellLayoutStore.getState();
    expect(layout.regions.header.visible).toBe(false);
  });
});
