import { useCallback, useMemo } from "react";

import { useWorkspaceStore } from "./stores/workspaceStore";

/** `metadata` key under which the active workspace's scenario list is stored. */
const SCENARIOS_METADATA_KEY = "scenarios";

/** Generate a stable unique scenario id. */
function newId(): string {
  // Prefer Web Crypto when available (browsers, modern runtimes); fall back for
  // environments that don't expose a global `crypto` (e.g. some node test
  // runtimes) so the hook still initialises everywhere.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A single simulation scenario definition, persisted inside a workspace's
 * `metadata.scenarios` array.
 *
 * `id` and `name` are standardized so generic tooling (a scenario picker,
 * future AI reasoning over "which scenarios exist") can work without knowing
 * the domain. `data` is fully opaque — each example defines its own shape
 * (FMU parameter overrides, choreography steps, etc.) and is responsible for
 * validating it.
 */
export interface Scenario {
  /** Stable identifier, generated client-side (`crypto.randomUUID()`). */
  id: string;
  /** Human-readable name shown in scenario lists/pickers. */
  name: string;
  /** Tool-specific scenario payload. Opaque to the framework. */
  data: unknown;
}

function readScenariosFromMetadata(
  metadata: Record<string, unknown> | undefined,
): Scenario[] {
  const raw = metadata?.[SCENARIOS_METADATA_KEY];
  return Array.isArray(raw) ? (raw as Scenario[]) : [];
}

/**
 * Writes `scenarios` into the active workspace's `metadata.scenarios`,
 * local-state only. No-op if no workspace is active.
 */
function writeScenarios(scenarios: Scenario[]): void {
  useWorkspaceStore.setState((state) => {
    if (!state.activeWorkspace) return state;
    return {
      activeWorkspace: {
        ...state.activeWorkspace,
        metadata: {
          ...state.activeWorkspace.metadata,
          [SCENARIOS_METADATA_KEY]: scenarios,
        },
      },
    };
  });
}

function readScenarios(): Scenario[] {
  return readScenariosFromMetadata(
    useWorkspaceStore.getState().activeWorkspace?.metadata,
  );
}

/**
 * Reads and edits the active workspace's scenario definitions.
 *
 * Built directly on {@link useWorkspaceStore} — mutations are local state
 * only, written into `activeWorkspace.metadata.scenarios`. They become
 * durable only when `useWorkspaceStore().save()` is called separately
 * (typically via the existing workspace Save action). With no active
 * workspace, `scenarios` reads as `[]` and every mutator is a no-op.
 *
 * @returns `scenarios` (the current list) plus `add`/`update`/`remove`/
 *   `setScenarios` mutators.
 * @example
 * ```ts
 * const { scenarios, add, update, remove } = useScenarios();
 * add("Takeoff sweep", { altitude: 50 });
 * update(scenarios[0].id, { name: "Renamed sweep" });
 * remove(scenarios[0].id);
 * ```
 */
export function useScenarios(): {
  /** The active workspace's current scenario list, or `[]` if none is active. */
  scenarios: Scenario[];
  /** Appends a new scenario with a generated `id`. No-op if no workspace is active. */
  add: (name: string, data: unknown) => void;
  /** Merges `patch` into the scenario matching `id`. No-op if `id` isn't found or no workspace is active. */
  update: (id: string, patch: Partial<Omit<Scenario, "id">>) => void;
  /** Removes the scenario matching `id`. No-op if `id` isn't found or no workspace is active. */
  remove: (id: string) => void;
  /** Replaces the entire scenario list. No-op if no workspace is active. */
  setScenarios: (scenarios: Scenario[]) => void;
} {
  const metadata = useWorkspaceStore((state) => state.activeWorkspace?.metadata);
  const scenarios = useMemo(() => readScenariosFromMetadata(metadata), [metadata]);

  const add = useCallback((name: string, data: unknown) => {
    const next: Scenario = { id: newId(), name, data };
    writeScenarios([...readScenarios(), next]);
  }, []);

  const update = useCallback((id: string, patch: Partial<Omit<Scenario, "id">>) => {
    const current = readScenarios();
    if (!current.some((s) => s.id === id)) return;
    writeScenarios(current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const remove = useCallback((id: string) => {
    const current = readScenarios();
    if (!current.some((s) => s.id === id)) return;
    writeScenarios(current.filter((s) => s.id !== id));
  }, []);

  const setScenarios = useCallback((next: Scenario[]) => {
    writeScenarios(next);
  }, []);

  return { scenarios, add, update, remove, setScenarios };
}
