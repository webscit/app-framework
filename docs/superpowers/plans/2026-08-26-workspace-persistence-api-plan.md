# Backend Workspace Persistence API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side "workspace" concept (create/list/get/save/delete) to `sci_framework_core`, backed by one JSON file per workspace on local disk, mounted via an opt-in `mount_workspace_routes(app, app_name, workspace_dir=None)` function.

**Architecture:** A single new module, `pypackages/framework-core/src/sci_framework_core/workspace.py`, holds two Pydantic models (`WorkspaceSummary`, `Workspace`), a small file-storage helper (atomic read/write/delete/list against a directory), and the `mount_workspace_routes` function that wires 5 REST endpoints to that storage helper. No changes to `create_app()`; consumers call `mount_workspace_routes` explicitly, exactly like `mount_ai_routes`.

**Tech Stack:** Python, FastAPI, Pydantic, pytest + `fastapi.testclient.TestClient`, `tmp_path` fixture for filesystem isolation.

## Global Constraints

- Every exported symbol needs a docstring with summary + Args/Returns (project convention, `CLAUDE.md`).
- Never remove existing docstrings; this plan only adds a new module, so N/A here but keep in mind if `__init__.py` is touched.
- `mypy pypackages/framework-core/src` and `ruff check .` must pass — use `from __future__ import annotations`, explicit typing, no wildcard imports (matches `ai_layout.py` style).
- No database — one JSON file per workspace, atomic writes via temp-file + `os.replace()` (spec §4.3).
- No file locking / no concurrency control — "last write wins" is accepted (spec §4.4).
- Storage default path: `Path.home() / f".{app_name}" / "workspaces"`, created on first use if missing; `workspace_dir` param overrides it (spec §4.1).
- `layout_snapshot` and `metadata` are opaque `dict[str, Any]` — never validated or interpreted by this module (spec §3).
- Unknown `id` on GET/PUT/DELETE → `404`; malformed body → FastAPI's default `422`; filesystem errors propagate unhandled → default `500` (spec §5, "Error handling"). Do not add try/except beyond what's specified.
- `create_app()` and its existing signature are unchanged (spec §2, §6).

---

### Task 1: `WorkspaceSummary` / `Workspace` models + file storage helpers

**Files:**

- Create: `pypackages/framework-core/src/sci_framework_core/workspace.py`
- Test: `pypackages/framework-core/tests/test_workspace.py`

**Interfaces:**

- Consumes: nothing new — only stdlib (`json`, `os`, `uuid`, `pathlib.Path`, `datetime`), `pydantic.BaseModel`.
- Produces (used by Task 2):
  - `class WorkspaceSummary(BaseModel)`: `id: str`, `name: str`, `created_at: datetime`, `updated_at: datetime`.
  - `class Workspace(WorkspaceSummary)`: adds `goal: str | None = None`, `layout_snapshot: dict[str, Any] | None = None`, `metadata: dict[str, Any] = {}`.
  - `class WorkspaceStore`: constructed as `WorkspaceStore(workspace_dir: Path)`, with methods:
    - `create(name: str, goal: str | None) -> Workspace`
    - `list_summaries() -> list[WorkspaceSummary]` (sorted by `updated_at` descending)
    - `get(workspace_id: str) -> Workspace | None`
    - `update(workspace_id: str, workspace: Workspace) -> Workspace | None` (returns `None` if `workspace_id` doesn't exist; refreshes `updated_at`; ignores `workspace.id` in favor of `workspace_id`)
    - `delete(workspace_id: str) -> bool` (returns whether a file was removed)
  - `default_workspace_dir(app_name: str) -> Path` — returns `Path.home() / f".{app_name}" / "workspaces"`.

- [ ] **Step 1: Write the failing tests for the models and `WorkspaceStore`**

```python
# pypackages/framework-core/tests/test_workspace.py
from __future__ import annotations

from pathlib import Path

import pytest
from sci_framework_core.workspace import (
    Workspace,
    WorkspaceStore,
    default_workspace_dir,
)


@pytest.fixture()
def store(tmp_path: Path) -> WorkspaceStore:
    """WorkspaceStore backed by a fresh temp directory per test."""
    return WorkspaceStore(tmp_path / "workspaces")


def test_create_generates_id_and_timestamps(store: WorkspaceStore) -> None:
    workspace = store.create(name="My Workspace", goal="Tune the controller")
    assert workspace.name == "My Workspace"
    assert workspace.goal == "Tune the controller"
    assert workspace.id
    assert workspace.created_at == workspace.updated_at
    assert workspace.layout_snapshot is None
    assert workspace.metadata == {}


def test_create_persists_a_readable_file(store: WorkspaceStore, tmp_path: Path) -> None:
    workspace = store.create(name="My Workspace", goal=None)
    workspace_dir = tmp_path / "workspaces"
    assert (workspace_dir / f"{workspace.id}.json").exists()


def test_list_summaries_sorted_by_updated_at_descending(
    store: WorkspaceStore,
) -> None:
    first = store.create(name="First", goal=None)
    second = store.create(name="Second", goal=None)
    # Force an update so `second`'s updated_at moves ahead of a re-touched `first`.
    store.update(first.id, first)

    summaries = store.list_summaries()
    assert [s.id for s in summaries] == [first.id, second.id]


def test_get_by_id_matches_created(store: WorkspaceStore) -> None:
    created = store.create(name="My Workspace", goal="Goal text")
    fetched = store.get(created.id)
    assert fetched == created


def test_get_unknown_id_returns_none(store: WorkspaceStore) -> None:
    assert store.get("does-not-exist") is None


def test_update_persists_changes_and_refreshes_updated_at(
    store: WorkspaceStore,
) -> None:
    created = store.create(name="Old Name", goal=None)
    changed = created.model_copy(update={"name": "New Name"})

    updated = store.update(created.id, changed)

    assert updated is not None
    assert updated.name == "New Name"
    assert updated.updated_at >= created.updated_at
    assert updated.created_at == created.created_at

    refetched = store.get(created.id)
    assert refetched is not None
    assert refetched.name == "New Name"


def test_update_ignores_mismatched_id_in_body(store: WorkspaceStore) -> None:
    created = store.create(name="Original", goal=None)
    mismatched = created.model_copy(update={"id": "some-other-id", "name": "Changed"})

    updated = store.update(created.id, mismatched)

    assert updated is not None
    assert updated.id == created.id
    assert store.get("some-other-id") is None


def test_update_unknown_id_returns_none(store: WorkspaceStore) -> None:
    fake = Workspace(
        id="does-not-exist",
        name="X",
        created_at=__import__("datetime").datetime.now(),
        updated_at=__import__("datetime").datetime.now(),
    )
    assert store.update("does-not-exist", fake) is None


def test_delete_removes_file(store: WorkspaceStore) -> None:
    created = store.create(name="To Delete", goal=None)
    assert store.delete(created.id) is True
    assert store.get(created.id) is None


def test_delete_unknown_id_returns_false(store: WorkspaceStore) -> None:
    assert store.delete("does-not-exist") is False


def test_create_writes_atomically_no_tmp_file_left_behind(
    store: WorkspaceStore, tmp_path: Path
) -> None:
    workspace = store.create(name="Atomic", goal=None)
    workspace_dir = tmp_path / "workspaces"
    assert not (workspace_dir / f"{workspace.id}.json.tmp").exists()
    assert (workspace_dir / f"{workspace.id}.json").exists()


def test_default_workspace_dir_resolves_under_home() -> None:
    resolved = default_workspace_dir("my-app")
    assert resolved == Path.home() / ".my-app" / "workspaces"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sci_framework_core.workspace'`

- [ ] **Step 3: Write the implementation**

```python
# pypackages/framework-core/src/sci_framework_core/workspace.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Run lint and typecheck**

Run: `ruff check pypackages/framework-core/src/sci_framework_core/workspace.py pypackages/framework-core/tests/test_workspace.py && mypy pypackages/framework-core/src`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add pypackages/framework-core/src/sci_framework_core/workspace.py pypackages/framework-core/tests/test_workspace.py
git commit -m "feat: add WorkspaceStore file-backed CRUD storage"
```

---

### Task 2: `mount_workspace_routes` REST endpoints

**Files:**

- Modify: `pypackages/framework-core/src/sci_framework_core/workspace.py`
- Modify: `pypackages/framework-core/tests/test_workspace.py`

**Interfaces:**

- Consumes: `WorkspaceStore`, `Workspace`, `WorkspaceSummary`, `default_workspace_dir` (Task 1); `fastapi.FastAPI`, `fastapi.HTTPException`, `pydantic.BaseModel` for the request body.
- Produces (used by Task 3 and by example apps):
  - `class CreateWorkspaceRequest(BaseModel)`: `name: str`, `goal: str | None = None`.
  - `def mount_workspace_routes(app: FastAPI, app_name: str, workspace_dir: Path | None = None) -> None` — mounts:
    - `POST /workspaces` → 201, body `CreateWorkspaceRequest`, returns `Workspace`
    - `GET /workspaces` → 200, returns `list[WorkspaceSummary]`
    - `GET /workspaces/{workspace_id}` → 200 `Workspace` / 404
    - `PUT /workspaces/{workspace_id}` → 200 `Workspace` / 404, body `Workspace`
    - `DELETE /workspaces/{workspace_id}` → 204 / 404

- [ ] **Step 1: Write the failing endpoint tests**

Append to `pypackages/framework-core/tests/test_workspace.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sci_framework_core.workspace import mount_workspace_routes


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """TestClient wired with mount_workspace_routes pointed at a temp dir."""
    app = FastAPI()
    mount_workspace_routes(app, app_name="test-app", workspace_dir=tmp_path / "workspaces")
    return TestClient(app)


def test_post_creates_workspace(client: TestClient) -> None:
    response = client.post("/workspaces", json={"name": "My Workspace", "goal": "Test goal"})
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "My Workspace"
    assert body["goal"] == "Test goal"
    assert "id" in body and "created_at" in body and "updated_at" in body


def test_get_list_returns_summaries_sorted_desc(client: TestClient) -> None:
    first = client.post("/workspaces", json={"name": "First"}).json()
    client.post("/workspaces", json={"name": "Second"}).json()
    client.put(f"/workspaces/{first['id']}", json=first)

    response = client.get("/workspaces")
    assert response.status_code == 200
    names = [w["name"] for w in response.json()]
    assert names == ["First", "Second"]


def test_get_by_id_matches_created(client: TestClient) -> None:
    created = client.post("/workspaces", json={"name": "My Workspace"}).json()
    response = client.get(f"/workspaces/{created['id']}")
    assert response.status_code == 200
    assert response.json() == created


def test_get_unknown_id_returns_404(client: TestClient) -> None:
    response = client.get("/workspaces/does-not-exist")
    assert response.status_code == 404


def test_put_updates_and_refreshes_updated_at(client: TestClient) -> None:
    created = client.post("/workspaces", json={"name": "Old Name"}).json()
    payload = {**created, "id": "ignored-mismatch", "name": "New Name"}

    response = client.put(f"/workspaces/{created['id']}", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == "New Name"
    assert body["updated_at"] >= created["updated_at"]


def test_put_unknown_id_returns_404(client: TestClient) -> None:
    created = client.post("/workspaces", json={"name": "X"}).json()
    response = client.put("/workspaces/does-not-exist", json=created)
    assert response.status_code == 404


def test_delete_removes_and_subsequent_get_404s(client: TestClient) -> None:
    created = client.post("/workspaces", json={"name": "To Delete"}).json()
    delete_response = client.delete(f"/workspaces/{created['id']}")
    assert delete_response.status_code == 204
    assert client.get(f"/workspaces/{created['id']}").status_code == 404


def test_delete_unknown_id_returns_404(client: TestClient) -> None:
    response = client.delete("/workspaces/does-not-exist")
    assert response.status_code == 404


def test_malformed_body_returns_422(client: TestClient) -> None:
    response = client.post("/workspaces", json={"goal": "missing name"})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v -k "test_post_creates or test_get_list or test_get_by_id_matches or test_get_unknown or test_put or test_delete or test_malformed"`
Expected: FAIL with `ImportError: cannot import name 'mount_workspace_routes'`

- [ ] **Step 3: Add `mount_workspace_routes` to `workspace.py`**

Append to `pypackages/framework-core/src/sci_framework_core/workspace.py` (add these imports to the top alongside the existing ones: `from fastapi import FastAPI, HTTPException, status`):

```python
# ─── Request models ───────────────────────────────────────────────────────────


class CreateWorkspaceRequest(BaseModel):
    """Request body for ``POST /workspaces``.

    Attributes:
        name: Display name for the new workspace.
        goal: Optional free-text goal description.
    """

    name: str
    goal: str | None = None


# ─── Route mounting ───────────────────────────────────────────────────────────


def mount_workspace_routes(
    app: FastAPI, app_name: str, workspace_dir: Path | None = None
) -> None:
    """Mount workspace persistence CRUD endpoints onto the given FastAPI app.

    Call once after ``create_app()``:

    .. code-block:: python

        app = create_app(lifespan=lifespan)
        mount_workspace_routes(app, app_name="drone")

    Args:
        app: FastAPI application instance to attach routes to.
        app_name: Application identifier used to derive the default storage
            directory (``~/.{app_name}/workspaces``) when ``workspace_dir``
            is not given. Each example app should supply its own so sibling
            apps never collide on the same machine.
        workspace_dir: Explicit storage directory, overriding the default
            derived from ``app_name``. Primarily for tests.
    """
    store = WorkspaceStore(workspace_dir or default_workspace_dir(app_name))

    @app.post("/workspaces", response_model=Workspace, status_code=status.HTTP_201_CREATED)
    async def create_workspace(request: CreateWorkspaceRequest) -> Workspace:
        """Create a new workspace.

        Args:
            request: Name and optional goal for the new workspace.

        Returns:
            The newly created ``Workspace``, with generated ``id`` and
            timestamps.
        """
        return store.create(name=request.name, goal=request.goal)

    @app.get("/workspaces", response_model=list[WorkspaceSummary])
    async def list_workspaces() -> list[WorkspaceSummary]:
        """List all workspaces as lightweight summaries.

        Returns:
            Summaries sorted by ``updated_at`` descending.
        """
        return store.list_summaries()

    @app.get("/workspaces/{workspace_id}", response_model=Workspace)
    async def get_workspace(workspace_id: str) -> Workspace:
        """Fetch one workspace by id.

        Args:
            workspace_id: The workspace's ``id``.

        Returns:
            The full ``Workspace`` record.

        Raises:
            HTTPException: 404 if no workspace with this id exists.
        """
        workspace = store.get(workspace_id)
        if workspace is None:
            raise HTTPException(status_code=404, detail=f"Workspace '{workspace_id}' not found")
        return workspace

    @app.put("/workspaces/{workspace_id}", response_model=Workspace)
    async def update_workspace(workspace_id: str, workspace: Workspace) -> Workspace:
        """Save changes to an existing workspace.

        Args:
            workspace_id: The workspace's ``id`` (path parameter wins over
                any ``id`` present in the request body).
            workspace: The full record to save.

        Returns:
            The saved ``Workspace``, with ``updated_at`` refreshed.

        Raises:
            HTTPException: 404 if no workspace with this id exists.
        """
        updated = store.update(workspace_id, workspace)
        if updated is None:
            raise HTTPException(status_code=404, detail=f"Workspace '{workspace_id}' not found")
        return updated

    @app.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_workspace(workspace_id: str) -> None:
        """Delete a workspace.

        Args:
            workspace_id: The workspace's ``id``.

        Raises:
            HTTPException: 404 if no workspace with this id exists.
        """
        deleted = store.delete(workspace_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Workspace '{workspace_id}' not found")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v`
Expected: PASS (all tests from Task 1 and Task 2)

- [ ] **Step 5: Run lint and typecheck**

Run: `ruff check pypackages/framework-core/src/sci_framework_core/workspace.py pypackages/framework-core/tests/test_workspace.py && mypy pypackages/framework-core/src`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add pypackages/framework-core/src/sci_framework_core/workspace.py pypackages/framework-core/tests/test_workspace.py
git commit -m "feat: add mount_workspace_routes CRUD endpoints"
```

---

### Task 3: Atomic-write crash safety test + public API export

**Files:**

- Modify: `pypackages/framework-core/tests/test_workspace.py`
- Modify: `pypackages/framework-core/src/sci_framework_core/__init__.py:1-11` (imports only — `create_app` body is untouched)

**Interfaces:**

- Consumes: `WorkspaceStore`, `Workspace`, `WorkspaceSummary`, `mount_workspace_routes` (Tasks 1–2).
- Produces: public import path `from sci_framework_core.workspace import mount_workspace_routes, Workspace, WorkspaceSummary` — already true after Tasks 1–2 since they're module-level symbols; this task only re-verifies it via a test importing from the package root style used in the spec (§6), and adds the crash-safety test from spec §7.

- [ ] **Step 1: Write the failing crash-safety test**

Append to `pypackages/framework-core/tests/test_workspace.py`:

```python
def test_update_crash_before_replace_leaves_original_file_untouched(
    store: WorkspaceStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If os.replace() never runs, the original file must be unaffected."""
    created = store.create(name="Original", goal=None)

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise OSError("simulated crash before replace")

    monkeypatch.setattr("sci_framework_core.workspace.os.replace", _boom)

    changed = created.model_copy(update={"name": "Should Not Persist"})
    with pytest.raises(OSError):
        store.update(created.id, changed)

    # Original file is untouched — the store never saw the crash-time write.
    monkeypatch.undo()
    refetched = store.get(created.id)
    assert refetched is not None
    assert refetched.name == "Original"


def test_create_crash_before_replace_leaves_no_file(
    store: WorkspaceStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If os.replace() never runs during create, no final file should exist."""
    monkeypatch.setattr(
        "sci_framework_core.workspace.os.replace",
        lambda *_a, **_k: (_ for _ in ()).throw(OSError("simulated crash")),
    )

    with pytest.raises(OSError):
        store.create(name="Never Persisted", goal=None)

    workspace_dir = tmp_path / "workspaces"
    json_files = list(workspace_dir.glob("*.json"))
    assert json_files == []


def test_public_api_importable_from_workspace_module() -> None:
    """The spec's documented import path resolves without error."""
    from sci_framework_core.workspace import (  # noqa: F401
        Workspace,
        WorkspaceSummary,
        mount_workspace_routes,
    )
```

- [ ] **Step 2: Run tests to verify they fail (or pass unexpectedly, revealing a bug)**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v -k "crash or public_api"`
Expected: PASS if the atomic-write implementation from Task 1 is already correct (the temp-file-then-replace pattern naturally satisfies this). If any of these FAIL, the `_write` implementation in Task 1 has a bug — fix `WorkspaceStore._write` before proceeding, do not weaken the test.

- [ ] **Step 3: Update `__init__.py`'s `__all__` is left unchanged — confirm no framework-wide re-export is needed**

No code change needed: the spec (§6) documents the import path as `from sci_framework_core.workspace import ...`, matching the existing `ai_layout` precedent where `mount_ai_routes` is also imported from its submodule, not re-exported at the package root. Skip this step's edit; proceed directly to the full-suite run below.

- [ ] **Step 4: Run the full test suite**

Run: `cd pypackages/framework-core && uv run pytest tests/test_workspace.py -v`
Expected: PASS (all ~17 tests)

- [ ] **Step 5: Run full quality gate**

Run:
```bash
ruff check .
mypy pypackages/framework-core/src
cd pypackages/framework-core && uv run pytest -q
```
Expected: no errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add pypackages/framework-core/tests/test_workspace.py
git commit -m "test: add atomic-write crash-safety coverage for WorkspaceStore"
```

---

## Self-Review Notes

- **Spec coverage:** §3 (data model) → Task 1. §4.1/§4.2/§4.3/§4.4 (storage, file layout, atomic writes, concurrency) → Task 1. §5 (API table + error handling) → Task 2. §6 (public API surface) → Task 3 confirms via test. §7 (testing list) → every bullet has a corresponding test: create/list/get/get-404/update/update-404/delete/delete-404/atomic-write-crash/default-dir-derivation are all present across Tasks 1–3.
- **No placeholders:** every step has complete, runnable code — no TBD/TODO.
- **Type consistency:** `WorkspaceStore.update(workspace_id: str, workspace: Workspace) -> Workspace | None` in Task 1 matches its usage in the `PUT` handler in Task 2. `default_workspace_dir(app_name: str) -> Path` matches its use in `mount_workspace_routes(app_name: str, workspace_dir: Path | None = None)`.
