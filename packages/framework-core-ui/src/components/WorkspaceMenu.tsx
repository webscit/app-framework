import { useEffect, useState } from "react";
import type React from "react";

import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  useWorkspaceStore,
} from "../stores/workspaceStore";
import { Button } from "./ui/button";
import "./WorkspaceMenu.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Which inline text-entry form (if any) the menu is currently showing. */
type Draft =
  | { mode: "idle" }
  | { mode: "creating"; name: string }
  | { mode: "renaming"; name: string };

// ─── WorkspaceMenu ──────────────────────────────────────────────────────────────

/**
 * Header control for creating, opening, saving, renaming, closing, and
 * deleting a backend-persisted workspace.
 *
 * Shows the active workspace's name (or `"No workspace"`) as a menu trigger.
 * Opening it lists every workspace (selecting one calls `openWorkspace`) plus
 * actions to **New workspace…** (inline name entry → `createWorkspace`),
 * **Save** the active workspace's current shell layout (→ `save`),
 * **Rename** it (inline edit → `rename`), **Close** it (→ `close`), and
 * **Delete** it (→ `deleteWorkspace`). Save/Rename/Close/Delete are disabled
 * when no workspace is active.
 *
 * On mount, the workspace list is fetched and, if `localStorage` names a
 * workspace still present in that list, it is opened automatically; a stale
 * id (a workspace deleted elsewhere) is cleared silently.
 *
 * The component is a thin consumer of the workspace store and holds no
 * workspace state of its own — {@link useWorkspaceStore} is the single
 * source of truth. It is placed in the shell header by `ShellRegions`, next
 * to `LayoutProfilesMenu` (which continues to manage local layout presets
 * independently of workspaces).
 *
 * @returns The workspace menu element.
 * @example
 * ```tsx
 * // Rendered inside the shell header:
 * <WorkspaceMenu />
 * ```
 */
export function WorkspaceMenu(): React.ReactElement {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const error = useWorkspaceStore((s) => s.error);
  const refreshList = useWorkspaceStore((s) => s.refreshList);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const save = useWorkspaceStore((s) => s.save);
  const rename = useWorkspaceStore((s) => s.rename);
  const close = useWorkspaceStore((s) => s.close);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ mode: "idle" });

  useEffect(() => {
    async function init(): Promise<void> {
      await refreshList();
      const storedId = readStoredActiveWorkspaceId();
      if (!storedId) return;
      const exists = useWorkspaceStore
        .getState()
        .workspaces.some((w) => w.id === storedId);
      if (exists) {
        await openWorkspace(storedId);
      } else {
        clearStoredActiveWorkspaceId();
      }
    }
    void init();
    // Runs once on mount only; refreshList/openWorkspace are stable store actions.
  }, []);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const hasActive = active !== undefined;

  function closeMenu(): void {
    setOpen(false);
    setDraft({ mode: "idle" });
  }

  function handleSelect(id: string): void {
    void openWorkspace(id);
    closeMenu();
  }

  function submitDraft(): void {
    if (draft.mode === "creating") {
      void createWorkspace(draft.name);
    } else if (draft.mode === "renaming") {
      void rename(draft.name);
    }
    closeMenu();
  }

  return (
    <div className="sct-WorkspaceMenu">
      <button
        type="button"
        className="sct-WorkspaceMenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${active ? active.name : "No workspace"}`}
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        <span className="sct-WorkspaceMenu-triggerLabel">
          {active ? active.name : "No workspace"}
        </span>
        <span aria-hidden className="sct-WorkspaceMenu-caret">
          ▾
        </span>
      </button>

      {open && (
        <div className="sct-WorkspaceMenu-popover" role="menu" aria-label="Workspaces">
          {draft.mode === "idle" ? (
            <>
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.id === activeWorkspaceId}
                  className="sct-WorkspaceMenu-item"
                  onClick={() => handleSelect(w.id)}
                >
                  {w.name}
                </button>
              ))}

              <div className="sct-WorkspaceMenu-divider" role="separator" />

              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                onClick={() => setDraft({ mode: "creating", name: "" })}
              >
                New workspace…
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  void save();
                  closeMenu();
                }}
              >
                Save
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => setDraft({ mode: "renaming", name: active?.name ?? "" })}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  close();
                  closeMenu();
                }}
              >
                Close
              </button>
              <button
                type="button"
                role="menuitem"
                className="sct-WorkspaceMenu-item"
                disabled={!hasActive}
                onClick={() => {
                  if (activeWorkspaceId) void deleteWorkspace(activeWorkspaceId);
                  closeMenu();
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <div className="sct-WorkspaceMenu-form">
              <span className="sct-WorkspaceMenu-formLabel">
                {draft.mode === "creating" ? "New workspace name" : "Rename workspace"}
              </span>
              <input
                className="sct-WorkspaceMenu-input"
                aria-label="Workspace name"
                placeholder={
                  draft.mode === "creating" ? "e.g. Drone survey" : undefined
                }
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitDraft();
                  } else if (e.key === "Escape") {
                    setDraft({ mode: "idle" });
                  }
                }}
              />
              <div className="sct-WorkspaceMenu-formActions">
                <Button size="sm" onClick={submitDraft}>
                  {draft.mode === "creating" ? "Create workspace" : "Save name"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft({ mode: "idle" })}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="sct-WorkspaceMenu-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
