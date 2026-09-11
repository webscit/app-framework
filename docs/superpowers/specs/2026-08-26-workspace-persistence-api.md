# Backend Workspace Persistence API — Design

**Issue:** [#30](https://github.com/webscit/app-framework/issues/30)
**Status:** Design approved, pending implementation plan.

**Goal:** Give applications built on the framework a server-side "workspace" —
the persisted application state used by the Simulation Engineer to answer one
technical query (`docs/stories/main.md`, *New workspace* / *Open workspace*)
— with create/list/get/save/delete operations, laying the foundation for the
frontend workspace controller widget (#31) and scenario storage (#35).

**Tech stack:** Python, FastAPI, Pydantic. No database — one JSON file per
workspace on local disk.

---

## 1. Problem Statement

There is currently no "workspace" concept anywhere in the codebase. The only
existing persistence is the frontend-only `LayoutProfile` mechanism
(`packages/framework-core-ui/src/stores/shellStore.ts`), which persists
layout arrangement to `localStorage` and carries no domain metadata (goal,
scenarios, validation constraints).

**What this solves:** server-side storage and a REST API to create, list,
open, save, and delete a workspace.

**What this does not solve (out of scope for this issue):**

- The frontend UI for opening/closing/saving a workspace (#31).
- Simulation scenario storage/schema (#35).
- Validation constraint storage/schema (#32).
- The AI onboarding wizard that populates a workspace's `goal`/`metadata`
  (#36).
- "Close workspace" as a server concept — closing is pure frontend state
  (there is no lock/session to release).
- Tracking "the latest workspace" server-side — the frontend remembers the
  last-opened workspace id itself (e.g. in `localStorage`) and requests it
  directly on startup.
- Authentication/authorization/multi-tenancy (ruled out at the project level,
  `docs/constraints_hypothesis.md` §5).

---

## 2. Scope

**In scope:**

- New module `pypackages/framework-core/src/sci_framework_core/workspace.py`.
- `mount_workspace_routes(app, app_name, workspace_dir=None)` — an opt-in
  mount function, following the existing `mount_ai_routes(app)` precedent
  (`ai_layout.py`). `create_app()` itself is unchanged; it continues to only
  mount `/health` and `/ws`.
- One JSON file per workspace on local disk, atomic writes.
- `POST /workspaces`, `GET /workspaces`, `GET /workspaces/{id}`,
  `PUT /workspaces/{id}`, `DELETE /workspaces/{id}`.
- Pytest unit tests covering the CRUD surface and edge cases.

**Out of scope:** everything listed under "What this does not solve" above.

---

## 3. Data Model

```python
class WorkspaceSummary(BaseModel):
    """Lightweight workspace listing entry."""
    id: str                 # server-generated UUID4, immutable
    name: str                # user-editable display name
    created_at: datetime
    updated_at: datetime

class Workspace(WorkspaceSummary):
    """Full workspace record."""
    goal: str | None = None
    layout_snapshot: dict[str, Any] | None = None  # opaque; frontend-owned shape
    metadata: dict[str, Any] = {}                    # escape hatch for future
                                                      # scenario/constraint refs
                                                      # (#35, #32) without a
                                                      # breaking schema change
```

Rationale for `metadata: dict[str, Any]`: scenarios (#35) and validation
constraints (#32) get their own dedicated storage and schemas in later
issues. Rather than guess their shape now, or block this issue on their
design, `Workspace` exposes a generic bag those issues can populate (e.g.
`metadata["scenario_ids"]`, `metadata["constraint_ids"]`) without changing
this envelope.

`layout_snapshot` is stored and returned as opaque JSON — this module does
not interpret or validate its structure. The frontend owns what goes in it
(likely a `ShellLayout`, see `packages/framework-core-ui/src/shellTypes.ts`).

---

## 4. Storage Strategy

### 4.1 Location

Default: `Path.home() / f".{app_name}" / "workspaces"`, created on first use
if missing. `app_name` is a required argument to `mount_workspace_routes` —
each example app supplies its own (e.g. `"drone"`, `"reachy-mini"`) so
sibling example apps never collide on the same machine. `workspace_dir` may
be passed explicitly to override the default entirely.

### 4.2 File layout

One file per workspace: `{workspace_dir}/{id}.json`, containing the
serialized `Workspace` model.

### 4.3 Atomic writes

Every write (create, update) writes to a temp file in the same directory
(`{id}.json.tmp`) and then calls `os.replace()` to atomically move it into
place. This guarantees a crash mid-write never corrupts an existing
workspace file — the reader always sees either the old complete file or the
new complete file, never a partial one.

### 4.4 Concurrency

No file locking. This is a single-user, single-process demonstrator; the
"last write wins" semantics already accepted for frontend layout persistence
(`docs/superpowers/plans/2026-04-27-json-layout-persistence.md` §6,
"Multiple tabs") apply here too.

---

## 5. API

All endpoints are mounted under `/workspaces` by `mount_workspace_routes`.

| Method | Path                | Body                        | Response              | Notes |
|--------|---------------------|------------------------------|------------------------|-------|
| POST   | `/workspaces`       | `{name: str, goal?: str}`   | `Workspace` (201)      | Generates `id`, `created_at`, `updated_at` |
| GET    | `/workspaces`       | —                             | `list[WorkspaceSummary]` | Sorted by `updated_at` descending |
| GET    | `/workspaces/{id}`  | —                             | `Workspace` (200) / 404 | |
| PUT    | `/workspaces/{id}`  | `Workspace` (id ignored, path id wins) | `Workspace` (200) / 404 | `updated_at` refreshed server-side |
| DELETE | `/workspaces/{id}`  | —                             | 204 / 404              | Removes the file |

### Error handling

- Unknown `id` on `GET`/`PUT`/`DELETE` → `404 Not Found` with a JSON detail
  message.
- Malformed request body → FastAPI/Pydantic's standard `422 Unprocessable
  Entity`, no custom handling needed.
- Filesystem errors (e.g. permission denied creating `workspace_dir`) are
  allowed to propagate as unhandled exceptions (→ FastAPI's default 500) —
  this mirrors how the rest of the framework treats unexpected I/O failures
  today; no example currently retries or recovers from these.

---

## 6. Public API Surface (new)

Exported from `sci_framework_core`:

```python
from sci_framework_core.workspace import mount_workspace_routes, Workspace, WorkspaceSummary
```

`create_app()` and its existing signature are unchanged.

---

## 7. Testing

Pytest unit tests in `pypackages/framework-core/tests/test_workspace.py`,
using FastAPI's `TestClient` against an app with `mount_workspace_routes`
pointed at a `tmp_path`-based `workspace_dir`:

- Create → returns a `Workspace` with generated `id`/timestamps.
- List → returns summaries sorted by `updated_at` descending.
- Get by id → matches what was created.
- Get unknown id → 404.
- Update (PUT) → persists changes, refreshes `updated_at`, ignores a
  mismatched `id` in the body.
- Update unknown id → 404.
- Delete → file removed, subsequent `GET` 404s.
- Delete unknown id → 404.
- Atomic write: simulate a crash between temp-file write and `os.replace`
  (e.g. monkeypatch to raise before replace) and confirm the original file
  (or absence of one, on create) is untouched.
- Default `workspace_dir` derivation from `app_name` resolves under
  `Path.home()`.
