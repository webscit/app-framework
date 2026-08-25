import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultShellLayout, SHELL_LAYOUT_STORAGE_VERSION } from "../shellTypes";
import type { LayoutProfile } from "../shellTypes";
import { registerProfileState } from "../profileStateRegistry";
import {
  clearPersistedLayout,
  selectActiveLayout,
  useShellLayoutStore,
} from "./shellStore";

const STORAGE_KEY = "sci-framework:shell-layout";

// ─── helpers ──────────────────────────────────────────────────────────────────

interface PersistedShape {
  state: {
    profiles?: LayoutProfile[];
    activeProfileId?: string;
    workingLayout?: unknown;
    layout?: unknown;
  };
  version: number;
}

function getStored(): PersistedShape | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as PersistedShape) : null;
}

function setStored(state: unknown, version = SHELL_LAYOUT_STORAGE_VERSION) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
}

/** A layout with a widget in `main`, standing in for an "app" layout. */
function layoutWithWidget() {
  const layout = createDefaultShellLayout();
  layout.regions.main = {
    visible: true,
    items: [{ id: "w1", type: "Chart", props: {} }],
  };
  return layout;
}

/** A layout with the bottom region visible — a cheap "arranged" marker. */
function layoutWithBottom() {
  const layout = createDefaultShellLayout();
  layout.regions.bottom = { visible: true, items: [] };
  return layout;
}

/** Reset the store to a single fresh "Default" profile before each test. */
function resetStore() {
  const id = "fixed-default-id";
  useShellLayoutStore.setState({
    profiles: [{ id, name: "Default", layout: createDefaultShellLayout() }],
    activeProfileId: id,
    workingLayout: createDefaultShellLayout(),
    defaultLayout: createDefaultShellLayout(),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

// ─── selectActiveLayout ─────────────────────────────────────────────────────────

describe("selectActiveLayout", () => {
  it("returns the working layout", () => {
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    expect(selectActiveLayout(useShellLayoutStore.getState())).toEqual(
      layoutWithBottom(),
    );
  });
});

// ─── setLayout ──────────────────────────────────────────────────────────────────

describe("setLayout", () => {
  it("edits the working layout, not any saved profile", () => {
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());

    const state = useShellLayoutStore.getState();
    expect(selectActiveLayout(state).regions.bottom.visible).toBe(true);
    // The saved "Default" snapshot is untouched by live editing.
    expect(state.profiles[0].layout.regions.bottom.visible).toBe(false);
  });
});

// ─── saveAsProfile ──────────────────────────────────────────────────────────────

describe("saveAsProfile", () => {
  it("captures the working layout as a new active profile", () => {
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    useShellLayoutStore.getState().saveAsProfile("Debug");

    const state = useShellLayoutStore.getState();
    expect(state.profiles).toHaveLength(2);
    const active = state.profiles.find((p) => p.id === state.activeProfileId)!;
    expect(active.name).toBe("Debug");
    expect(active.layout.regions.bottom.visible).toBe(true);
  });

  it("freezes the snapshot: editing the working layout afterwards does not change it", () => {
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    useShellLayoutStore.getState().saveAsProfile("Debug");
    const savedId = useShellLayoutStore.getState().activeProfileId;

    // Keep editing the live working layout after saving.
    useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout());

    const saved = useShellLayoutStore
      .getState()
      .profiles.find((p) => p.id === savedId)!;
    expect(saved.layout.regions.bottom.visible).toBe(true); // still frozen
  });

  it("gives the new profile an id distinct from the previous active one", () => {
    const sourceId = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().saveAsProfile("Tuning");
    expect(useShellLayoutStore.getState().activeProfileId).not.toBe(sourceId);
  });

  it("ignores a blank name", () => {
    const before = useShellLayoutStore.getState().profiles.length;
    useShellLayoutStore.getState().saveAsProfile("   ");
    expect(useShellLayoutStore.getState().profiles).toHaveLength(before);
  });
});

// ─── widget state (opt-in via useProfileState) ──────────────────────────────────

describe("widget state capture & restore", () => {
  it("saveAsProfile captures registered widget state into the profile", () => {
    let value = 40;
    const off = registerProfileState("slider", {
      get: () => value,
      set: (v) => {
        value = v as number;
      },
      getDefault: () => 40,
    });

    useShellLayoutStore.getState().saveAsProfile("WithState");

    const state = useShellLayoutStore.getState();
    const active = state.profiles.find((p) => p.id === state.activeProfileId)!;
    expect(active.state).toEqual({ slider: 40 });
    off();
  });

  it("switchProfile replays the saved widget state through the setters", () => {
    let value = 40;
    const off = registerProfileState("slider", {
      get: () => value,
      set: (v) => {
        value = v as number;
      },
      getDefault: () => 40,
    });

    useShellLayoutStore.getState().saveAsProfile("A"); // captures slider = 40
    const aId = useShellLayoutStore.getState().activeProfileId;

    value = 99; // user changes it live
    useShellLayoutStore.getState().saveAsProfile("B"); // captures slider = 99

    value = 0; // scramble
    useShellLayoutStore.getState().switchProfile(aId); // restore A → 40

    expect(value).toBe(40);
    off();
  });

  it("switchProfile resets a widget to its default when the target profile saved nothing", () => {
    let value = 40; // default
    const off = registerProfileState("slider", {
      get: () => value,
      set: (v) => {
        value = v as number;
      },
      getDefault: () => 40,
    });
    const defaultId = useShellLayoutStore.getState().activeProfileId; // "Default", no state

    value = 90;
    useShellLayoutStore.getState().saveAsProfile("Custom"); // captures slider = 90
    const customId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().switchProfile(customId);
    expect(value).toBe(90);

    // Default profile has no widget state → the slider must return to 40.
    useShellLayoutStore.getState().switchProfile(defaultId);
    expect(value).toBe(40);
    off();
  });

  it("resetActiveProfile also resets opted-in widgets to their defaults", () => {
    let value = 40; // default
    const off = registerProfileState("slider", {
      get: () => value,
      set: (v) => {
        value = v as number;
      },
      getDefault: () => 40,
    });

    value = 90; // live edit
    useShellLayoutStore.getState().resetActiveProfile();

    expect(value).toBe(40);
    off();
  });
});

// ─── switchProfile ──────────────────────────────────────────────────────────────

describe("switchProfile", () => {
  it("loads a profile's frozen snapshot into the working layout", () => {
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    useShellLayoutStore.getState().saveAsProfile("A"); // A: bottom visible
    const aId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout());
    useShellLayoutStore.getState().saveAsProfile("B"); // B: bottom hidden
    const bId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().switchProfile(aId);
    expect(
      selectActiveLayout(useShellLayoutStore.getState()).regions.bottom.visible,
    ).toBe(true);

    useShellLayoutStore.getState().switchProfile(bId);
    expect(
      selectActiveLayout(useShellLayoutStore.getState()).regions.bottom.visible,
    ).toBe(false);
  });

  it("is a no-op for an unknown id", () => {
    const activeId = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().switchProfile("does-not-exist");
    expect(useShellLayoutStore.getState().activeProfileId).toBe(activeId);
  });
});

// ─── renameProfile ──────────────────────────────────────────────────────────────

describe("renameProfile", () => {
  it("renames the profile", () => {
    const id = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().renameProfile(id, "Renamed");
    expect(useShellLayoutStore.getState().profiles.find((x) => x.id === id)!.name).toBe(
      "Renamed",
    );
  });

  it("rejects a blank name", () => {
    const id = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().renameProfile(id, "   ");
    expect(useShellLayoutStore.getState().profiles.find((x) => x.id === id)!.name).toBe(
      "Default",
    );
  });
});

// ─── deleteProfile ──────────────────────────────────────────────────────────────

describe("deleteProfile", () => {
  it("removes the profile", () => {
    const firstId = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().saveAsProfile("Monitoring");
    const secondId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().deleteProfile(secondId);

    expect(useShellLayoutStore.getState().profiles.map((p) => p.id)).toEqual([firstId]);
  });

  it("loads the first remaining profile when the active one is deleted", () => {
    // Starts with the "Default" profile (bottom hidden). Add an active second.
    const defaultId = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    useShellLayoutStore.getState().saveAsProfile("Second"); // active, bottom visible
    const secondId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().deleteProfile(secondId);

    const state = useShellLayoutStore.getState();
    // Falls back to the first remaining profile (the original Default)…
    expect(state.activeProfileId).toBe(defaultId);
    // …and its snapshot (bottom hidden) is loaded into the working layout.
    expect(selectActiveLayout(state).regions.bottom.visible).toBe(false);
  });

  it("refuses to delete the last remaining profile", () => {
    const onlyId = useShellLayoutStore.getState().activeProfileId;
    useShellLayoutStore.getState().deleteProfile(onlyId);
    expect(useShellLayoutStore.getState().profiles).toHaveLength(1);
  });
});

// ─── resetActiveProfile ─────────────────────────────────────────────────────────

describe("resetActiveProfile", () => {
  it("resets the working layout to the app default", () => {
    useShellLayoutStore.getState().setDefaultLayout(layoutWithWidget());
    // Arrange away from the default…
    useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout());

    useShellLayoutStore.getState().resetActiveProfile();

    expect(
      selectActiveLayout(useShellLayoutStore.getState()).regions.main.items,
    ).toHaveLength(1);
  });

  it("does not modify the saved profile snapshot", () => {
    useShellLayoutStore.getState().setDefaultLayout(layoutWithWidget());
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());
    useShellLayoutStore.getState().saveAsProfile("Custom");
    const savedId = useShellLayoutStore.getState().activeProfileId;

    useShellLayoutStore.getState().resetActiveProfile();

    const saved = useShellLayoutStore
      .getState()
      .profiles.find((p) => p.id === savedId)!;
    expect(saved.layout.regions.bottom.visible).toBe(true); // snapshot untouched
  });
});

// ─── setDefaultLayout ───────────────────────────────────────────────────────────

describe("setDefaultLayout", () => {
  it("seeds the working layout when nothing has been arranged (empty)", () => {
    useShellLayoutStore.getState().setDefaultLayout(layoutWithWidget());
    expect(
      selectActiveLayout(useShellLayoutStore.getState()).regions.main.items,
    ).toHaveLength(1);
  });

  it("does not clobber a working layout that already has content", () => {
    const arranged = createDefaultShellLayout();
    arranged.regions["sidebar-left"] = {
      visible: true,
      items: [{ id: "saved", type: "LogViewer", props: {} }],
    };
    useShellLayoutStore.getState().setLayout(() => arranged);

    useShellLayoutStore.getState().setDefaultLayout(layoutWithWidget());

    const working = selectActiveLayout(useShellLayoutStore.getState());
    expect(working.regions["sidebar-left"].items).toHaveLength(1);
    expect(working.regions.main.items).toHaveLength(0);
  });

  it("records the baseline used by resetActiveProfile", () => {
    useShellLayoutStore.getState().setDefaultLayout(layoutWithWidget());
    expect(useShellLayoutStore.getState().defaultLayout).toEqual(layoutWithWidget());
  });
});

// ─── persist ─────────────────────────────────────────────────────────────────────

describe("persist — saving", () => {
  it("persists profiles and activeProfileId", () => {
    useShellLayoutStore.getState().saveAsProfile("Monitoring");

    const stored = getStored();
    expect(stored).not.toBeNull();
    expect(stored!.state.profiles).toHaveLength(2);
    expect(stored!.state.activeProfileId).toBe(
      useShellLayoutStore.getState().activeProfileId,
    );
  });

  it("does NOT persist the live working layout (unsaved edits stay out of storage)", () => {
    useShellLayoutStore.getState().saveAsProfile("Monitoring");
    // Edit the working layout after saving.
    useShellLayoutStore.getState().setLayout(() => layoutWithBottom());

    const stored = getStored()!;
    expect(stored.state.workingLayout).toBeUndefined();
    // The saved snapshot does not reflect the post-save edit either.
    const active = stored.state.profiles!.find(
      (p) => p.id === stored.state.activeProfileId,
    )!;
    expect(active.layout.regions.bottom.visible).toBe(false);
  });

  it("stored value includes the schema version", () => {
    useShellLayoutStore.getState().saveAsProfile("Monitoring");
    expect(getStored()!.version).toBe(SHELL_LAYOUT_STORAGE_VERSION);
  });
});

describe("persist — restoring", () => {
  it("restores the working layout from the active profile's snapshot", async () => {
    const id = "mon-1";
    setStored({
      profiles: [{ id, name: "Monitoring", layout: layoutWithWidget() }],
      activeProfileId: id,
    });

    await useShellLayoutStore.persist.rehydrate();

    const state = useShellLayoutStore.getState();
    expect(state.profiles[0].name).toBe("Monitoring");
    expect(selectActiveLayout(state).regions.main.items).toHaveLength(1);
  });
});

describe("persist — migration", () => {
  it("resets an older-version state to a fresh Default (no backward compatibility)", async () => {
    setStored({ layout: layoutWithBottom() }, 6);

    await useShellLayoutStore.persist.rehydrate();

    const state = useShellLayoutStore.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Default");
    // The old { layout } is NOT migrated — it resets to the default layout.
    expect(selectActiveLayout(state).regions.bottom.visible).toBe(false);
  });

  it("falls back to a single Default profile for an unknown version", async () => {
    setStored({ layout: layoutWithBottom() }, 99);

    await useShellLayoutStore.persist.rehydrate();

    const state = useShellLayoutStore.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Default");
  });

  it("falls back to a Default profile when the stored value is corrupted", async () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");

    await useShellLayoutStore.persist.rehydrate();

    expect(useShellLayoutStore.getState().profiles).toHaveLength(1);
  });
});

// ─── clearPersistedLayout ───────────────────────────────────────────────────────

describe("clearPersistedLayout", () => {
  it("clears localStorage and resets to a single Default profile", () => {
    useShellLayoutStore.getState().saveAsProfile("Monitoring");
    expect(getStored()).not.toBeNull();

    clearPersistedLayout();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    const state = useShellLayoutStore.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Default");
  });
});
