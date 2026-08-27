"""Server-side workspace persistence — one JSON file per workspace on local disk.

Entry point for consumers: ``mount_workspace_routes(app, app_name)`` — call once
after ``create_app()`` to attach the ``/workspaces`` CRUD endpoints to a FastAPI
application.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

# ─── Data model ───────────────────────────────────────────────────────────────


class WorkspaceSummary(BaseModel):
    """Lightweight workspace listing entry.

    Attributes:
        id: Server-generated UUID4, immutable for the workspace's lifetime.
        name: User-editable display name.
        created_at: Timestamp the workspace was created.
        updated_at: Timestamp the workspace was last saved.
    """

    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class Workspace(WorkspaceSummary):
    """Full workspace record — the persisted application state for one
    technical query (goal, scenario references, validation constraints,
    layout snapshot reference).

    Attributes:
        goal: Free-text description of what the user is trying to accomplish
            in this workspace, or ``None`` if not yet set.
        layout_snapshot: Opaque, frontend-owned JSON (e.g. a ``ShellLayout``).
            This module stores and returns it unmodified without interpreting
            its structure.
        metadata: Escape-hatch bag for future scenario/constraint references
            (see #35, #32) without requiring a breaking schema change here.
    """

    goal: str | None = None
    layout_snapshot: dict[str, Any] | None = None
    metadata: dict[str, Any] = {}


# ─── Storage ──────────────────────────────────────────────────────────────────


def default_workspace_dir(app_name: str) -> Path:
    """Return the default on-disk directory for one application's workspaces.

    Args:
        app_name: Caller-supplied application identifier (e.g. ``"drone"``),
            so sibling example apps never collide on the same machine.

    Returns:
        ``Path.home() / f".{app_name}" / "workspaces"``.
    """
    return Path.home() / f".{app_name}" / "workspaces"


class WorkspaceStore:
    """File-backed CRUD storage for :class:`Workspace` records.

    One JSON file per workspace, named ``{id}.json``, inside ``workspace_dir``.
    Writes are atomic (temp file + ``os.replace``) so a crash mid-write never
    corrupts an existing file. No locking is performed — concurrent writers
    race on "last write wins", matching the frontend's accepted layout
    persistence semantics.
    """

    def __init__(self, workspace_dir: Path) -> None:
        """Create a store rooted at ``workspace_dir``.

        Args:
            workspace_dir: Directory holding one ``{id}.json`` file per
                workspace. Created on first write if it does not exist.
        """
        self._dir = workspace_dir

    def _path(self, workspace_id: str) -> Path:
        return self._dir / f"{workspace_id}.json"

    def _write(self, workspace: Workspace) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        final_path = self._path(workspace.id)
        tmp_path = self._dir / f"{workspace.id}.json.tmp"
        tmp_path.write_text(workspace.model_dump_json())
        os.replace(tmp_path, final_path)

    def create(self, name: str, goal: str | None) -> Workspace:
        """Create and persist a new workspace.

        Args:
            name: Display name for the new workspace.
            goal: Optional free-text goal description.

        Returns:
            The newly created :class:`Workspace`, with a generated ``id``
            and ``created_at``/``updated_at`` both set to the current time.
        """
        now = datetime.now()
        workspace = Workspace(
            id=str(uuid.uuid4()),
            name=name,
            goal=goal,
            created_at=now,
            updated_at=now,
        )
        self._write(workspace)
        return workspace

    def list_summaries(self) -> list[WorkspaceSummary]:
        """List all workspaces as lightweight summaries.

        Returns:
            Summaries sorted by ``updated_at`` descending (most recently
            saved first). Empty list if the workspace directory doesn't
            exist yet.
        """
        if not self._dir.exists():
            return []
        summaries = [
            WorkspaceSummary.model_validate_json(path.read_text())
            for path in self._dir.glob("*.json")
        ]
        return sorted(summaries, key=lambda s: s.updated_at, reverse=True)

    def get(self, workspace_id: str) -> Workspace | None:
        """Fetch one workspace by id.

        Args:
            workspace_id: The workspace's ``id``.

        Returns:
            The :class:`Workspace`, or ``None`` if no such workspace exists.
        """
        path = self._path(workspace_id)
        if not path.exists():
            return None
        return Workspace.model_validate_json(path.read_text())

    def update(self, workspace_id: str, workspace: Workspace) -> Workspace | None:
        """Persist changes to an existing workspace.

        Args:
            workspace_id: The workspace's ``id`` (authoritative — any ``id``
                on ``workspace`` itself is ignored).
            workspace: The full record to save. Its ``created_at`` is
                preserved from the existing record; ``updated_at`` is
                refreshed to now.

        Returns:
            The saved :class:`Workspace`, or ``None`` if ``workspace_id``
            does not correspond to an existing workspace.
        """
        existing = self.get(workspace_id)
        if existing is None:
            return None
        updated = workspace.model_copy(
            update={
                "id": workspace_id,
                "created_at": existing.created_at,
                "updated_at": datetime.now(),
            }
        )
        self._write(updated)
        return updated

    def delete(self, workspace_id: str) -> bool:
        """Delete a workspace's file.

        Args:
            workspace_id: The workspace's ``id``.

        Returns:
            ``True`` if a file was removed, ``False`` if no such workspace
            existed.
        """
        path = self._path(workspace_id)
        if not path.exists():
            return False
        path.unlink()
        return True
