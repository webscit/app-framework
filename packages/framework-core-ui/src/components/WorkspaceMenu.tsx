import { useEffect, useState } from "react";
import type React from "react";

import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  useWorkspaceStore,
} from "../stores/workspaceStore";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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
 * id (a workspace deleted elsewhere) is cleared silently. If the initial
 * list fetch itself fails, the stored id is left untouched (rather than
 * cleared) since we don't yet know whether it's actually stale.
 *
 * The component is a thin consumer of the workspace store and holds no
 * workspace state of its own — {@link useWorkspaceStore} is the single
 * source of truth. It is placed in the shell header by `ShellRegions`, next
 * to `LayoutProfilesMenu` (which continues to manage local layout presets
 * independently of workspaces). Its menu is built on the shared
 * {@link DropdownMenu} primitives rather than a bespoke popover.
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
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
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
      const state = useWorkspaceStore.getState();
      if (state.status === "error") return;
      const exists = state.workspaces.some((w) => w.id === storedId);
      if (exists) {
        await openWorkspace(storedId);
      } else {
        clearStoredActiveWorkspaceId();
      }
    }
    void init();
    // Runs once on mount only; refreshList/openWorkspace are stable store actions.
  }, []);

  const active = activeWorkspace ?? workspaces.find((w) => w.id === activeWorkspaceId);
  const hasActive = active !== undefined;

  function closeMenu(): void {
    setOpen(false);
    setDraft({ mode: "idle" });
  }

  async function handleSelect(id: string): Promise<void> {
    const ok = await openWorkspace(id);
    if (ok) closeMenu();
  }

  async function handleSave(): Promise<void> {
    const ok = await save();
    if (ok) closeMenu();
  }

  async function handleDelete(): Promise<void> {
    if (!activeWorkspaceId) return;
    const ok = await deleteWorkspace(activeWorkspaceId);
    if (ok) closeMenu();
  }

  async function submitDraft(): Promise<void> {
    let ok = true;
    if (draft.mode === "creating") {
      ok = await createWorkspace(draft.name);
    } else if (draft.mode === "renaming") {
      ok = await rename(draft.name);
    }
    if (ok) closeMenu();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="sct-WorkspaceMenu-trigger"
        aria-label={`Workspace: ${active ? active.name : "No workspace"}`}
      >
        <span className="sct-WorkspaceMenu-triggerLabel">
          {active ? active.name : "No workspace"}
        </span>
        <span aria-hidden className="sct-WorkspaceMenu-caret">
          ▾
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        aria-label="Workspaces"
        className="sct-WorkspaceMenu-popover"
      >
        {draft.mode === "idle" ? (
          <>
            <DropdownMenuRadioGroup
              value={activeWorkspaceId ?? null}
              onValueChange={(value) => void handleSelect(value as string)}
            >
              {workspaces.map((w) => (
                <DropdownMenuRadioItem
                  key={w.id}
                  value={w.id}
                  className="sct-WorkspaceMenu-item"
                >
                  {w.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              closeOnClick={false}
              className="sct-WorkspaceMenu-item"
              onClick={() => setDraft({ mode: "creating", name: "" })}
            >
              New workspace…
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={!hasActive}
              className="sct-WorkspaceMenu-item"
              onClick={() => void handleSave()}
            >
              Save
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={!hasActive}
              className="sct-WorkspaceMenu-item"
              onClick={() => setDraft({ mode: "renaming", name: active?.name ?? "" })}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={!hasActive}
              className="sct-WorkspaceMenu-item"
              onClick={() => {
                close();
                closeMenu();
              }}
            >
              Close
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={!hasActive}
              className="sct-WorkspaceMenu-item"
              onClick={() => void handleDelete()}
            >
              Delete
            </DropdownMenuItem>
          </>
        ) : (
          <div className="sct-WorkspaceMenu-form">
            <span className="sct-WorkspaceMenu-formLabel">
              {draft.mode === "creating" ? "New workspace name" : "Rename workspace"}
            </span>
            <input
              className="sct-WorkspaceMenu-input"
              aria-label="Workspace name"
              placeholder={draft.mode === "creating" ? "e.g. Drone survey" : undefined}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitDraft();
                } else if (e.key === "Escape") {
                  setDraft({ mode: "idle" });
                }
              }}
            />
            <div className="sct-WorkspaceMenu-formActions">
              <Button size="sm" onClick={() => void submitDraft()}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
