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
