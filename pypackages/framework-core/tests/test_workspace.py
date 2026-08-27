from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sci_framework_core.workspace import (
    Workspace,
    WorkspaceStore,
    default_workspace_dir,
    mount_workspace_routes,
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


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """TestClient wired with mount_workspace_routes pointed at a temp dir."""
    app = FastAPI()
    mount_workspace_routes(
        app, app_name="test-app", workspace_dir=tmp_path / "workspaces"
    )
    return TestClient(app)


def test_post_creates_workspace(client: TestClient) -> None:
    response = client.post(
        "/workspaces",
        json={"name": "My Workspace", "goal": "Test goal"},
    )
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


def test_get_by_id_returns_created(client: TestClient) -> None:
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
