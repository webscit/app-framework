# Multiple Saved Layout Profiles

**Goal:** Let an engineer keep **several named dashboard layouts** and switch
between them instantly — e.g. a "Tuning" layout with big parameter sliders, a
"Monitoring" layout dominated by charts, and a "Debug" layout with the log
viewer expanded — instead of the single throwaway layout they have today. Each
profile is saved locally and restored across reloads.

**Architecture:** Extend the existing layout persistence (Zustand `persist` +
`localStorage`, storage key `app-framework:shell-layout`, versioned) from a
single `ShellLayout` to a small collection of **named profile snapshots** plus a
separate **live working layout**. The shell renders and edits the _working_
layout (drag-to-reorder, resize, AI-applied layouts); saving **freezes** the
working layout into a named profile, and switching **loads** a profile's frozen
snapshot back into the working layout. A schema-version bump migrates/resets old
persisted data so no one is stuck on a stale dashboard.

> **Implemented — see §10 for what shipped beyond this v1 outline.** The final
> model is _freeze-on-save_ (not the auto-save-into-active-profile wording used
> below), and it additionally captures **panel sizes** and opt-in **per-widget
> state** (`useProfileState`).

**Tech Stack:** TypeScript — React, existing Zustand store + `persist`
middleware, `localStorage`. No new dependency; no backend (see §9 for a future
server/DB-backed approach).

**Status:** Implemented on `feat/layout-profiles`. Fully tested (store, hook,
registry, and a DOM-level panel-size regression test).

---

## 1. Problem Statement

### 1.1 What the engineer wants

Different tasks want different dashboards. While tuning, the engineer wants the
parameter controls front-and-centre; while watching a run, they want the charts
and status banner to dominate; while debugging, they want the log viewer large.
Today the shell persists **one** layout, so every switch means manually
rearranging widgets and undoing it afterwards. Engineers want to set each
arrangement up once, name it, and flip between them.

### 1.2 What exists today

- Layout is a JSON-serializable `ShellLayout`, persisted via a Zustand store
  with the `persist` middleware (`stores/shellStore.ts`), under the key
  `app-framework:shell-layout`, keyed by `SHELL_LAYOUT_STORAGE_VERSION`
  (currently 6) with a `migrate` that resets unknown versions.
- Manual **drag-to-reorder and resize** already work (resize via
  `react-resizable-panels`); the AI assistant can also apply a layout. All of
  these funnel through the store's `setLayout(updater)` and auto-persist.

The one thing missing is **more than one** saved layout. This spec adds that and
nothing else — drag/resize/AI editing are unchanged.

### 1.3 What this adds

- Save the current layout as a **named profile**.
- **Switch** the active profile (the shell instantly renders that layout).
- **Rename**, **delete**, and **reset** profiles.
- All profiles persist in `localStorage`, per application, across reloads.

### 1.4 Next steps after v1

- Import / export profiles as JSON files; share profiles between teammates;
  server-side storage. (All explicitly out of scope here, consistent with the
  original persistence spec.)

---

## 2. Scope

**In scope (v1):**

- A `LayoutProfile` data model and an extended store holding many profiles + an
  active id, persisted to `localStorage`.
- Store actions: save-as-new, switch, rename, delete, reset-active; and
  repointing `setLayout` to edit the active profile.
- A schema migration that folds the existing single layout into a "Default"
  profile.
- A `LayoutProfilesMenu` UI in the shell header to manage and switch profiles.
- Unit tests for the store logic and the menu.

**Out of scope (v1):** import/export to files, cross-user sharing, server sync,
cloud storage; any change to drag-to-reorder, resize, or the AI layout flow
(these already exist and are only repointed at the active profile, not
modified).

---

## 3. Data Model

```ts
/** One named, saved dashboard arrangement. */
interface LayoutProfile {
  id: string; // stable unique id (e.g. crypto.randomUUID())
  name: string; // user-facing label, e.g. "Monitoring"
  layout: ShellLayout; // the serializable arrangement
}

/** Persisted store shape (replaces the single `layout`). */
interface ShellLayoutStore {
  profiles: LayoutProfile[]; // always length >= 1
  activeProfileId: string; // id of the profile currently rendered
  // ...actions (see §4)
}
```

The shell renders **`profiles.find(p => p.id === activeProfileId).layout`**. A
selector (e.g. `useActiveLayout()`) exposes it so consumers that read `layout`
today change minimally.

**Invariants:** there is always at least one profile; `activeProfileId` always
points at an existing profile.

---

## 4. Store Design (`stores/shellStore.ts`)

The existing single-layout store is extended in place (one source of truth;
migration handles the upgrade). Backward-compatible surface:

- **`setLayout(updater)`** — unchanged signature, now applies the updater to the
  **active profile's** layout. Every current caller (drag/resize handlers, the
  AI apply path, region toggles) keeps working; edits auto-save into the active
  profile via `persist`.
- **`saveAsProfile(name)`** — snapshot the current active layout into a **new**
  profile with a fresh id, and make it active. (A "fork this arrangement" action.)
- **`switchProfile(id)`** — set `activeProfileId`; the shell re-renders that
  layout. No-op if `id` is unknown.
- **`renameProfile(id, name)`** — rename; blank names rejected.
- **`deleteProfile(id)`** — remove it; if it was active, switch to the first
  remaining profile. Deleting the **last** profile is disallowed (guarded).
- **`resetActiveProfile()`** — set the active profile's layout back to
  `createDefaultShellLayout()` (replaces today's `clearPersistedLayout` intent
  at profile granularity).

### 4.1 Migration

Bump `SHELL_LAYOUT_STORAGE_VERSION`. The `migrate(persistedState, version)`
function converts the previous shape `{ layout }` into
`{ profiles: [{ id, name: "Default", layout }], activeProfileId: <that id> }`.
Unknown/older versions fall back to a single fresh "Default" profile (existing
graceful-reset behaviour, now producing one profile). No user loses their
current dashboard on upgrade.

---

## 5. UI — `LayoutProfilesMenu`

A small control in the **shell header** (near the existing header items):

- Shows the **active profile's name** and opens a menu listing all profiles;
  selecting one calls `switchProfile`.
- Menu actions: **Save as new profile…** (prompts for a name → `saveAsProfile`),
  **Rename** (inline edit → `renameProfile`), **Delete** (→ `deleteProfile`,
  disabled when only one profile exists), **Reset to default** (→
  `resetActiveProfile`).
- Accessibility: a labelled `button`/`menu` (e.g.
  `getByRole("button", { name: /layout profile/i })`) with menu items as
  `menuitem`s — no `data-testid` needed.

The menu is a thin consumer of the store actions; it holds no layout state of
its own. It is registered/placed by `ApplicationShell` so every app gets it for
free.

---

## 6. Data Flow

1. Engineer arranges widgets (existing drag/resize/AI) → `setLayout` writes to
   the active profile → auto-persisted.
2. Engineer opens the profiles menu → **Save as new profile** "Monitoring" →
   `saveAsProfile("Monitoring")` clones the current layout into a new active
   profile.
3. They rearrange for a different task and **Save as new profile** "Tuning".
4. Flipping the menu between "Monitoring" and "Tuning" (`switchProfile`) swaps
   the rendered dashboard instantly; each profile keeps its own edits.
5. On reload, `persist` restores all profiles and the active id.

---

## 7. Testing Strategy

- **Store** (`shellStore.test.ts`): `saveAsProfile` adds a profile and makes it
  active; `switchProfile` changes the active layout; `setLayout` edits only the
  active profile; `deleteProfile` removes it and re-points active; deleting the
  last profile is refused; `renameProfile` rejects blank names;
  `resetActiveProfile` restores the default; **migration** folds a legacy
  `{ layout }` into a single "Default" profile.
- **UI** (Vitest browser): the menu lists profiles and switching re-renders the
  active layout; Save-as-new creates and activates a profile; rename/delete
  reflect in the list; Delete disabled with a single profile — all via
  accessible roles.
- **Quality gate:** `npm run typecheck` / `lint` / `test:ui` / `format:check`.

---

## 8. Implementation Checklist

```
- [x] Task 1: LayoutProfile type + extended ShellLayoutStore shape (profiles +
      activeProfileId + workingLayout + defaultLayout) in shellTypes.ts / shellStore.ts
- [x] Task 2: store actions (setLayout→working, saveAsProfile, switchProfile,
      renameProfile, deleteProfile, resetActiveProfile) + invariants (freeze-on-save)
- [x] Task 3: bump SHELL_LAYOUT_STORAGE_VERSION (→ 8) + migrate legacy {layout};
      discard older profile data on schema bump
- [x] Task 4: useActiveLayout selector; repoint ApplicationShell/consumers to it
- [x] Task 5: LayoutProfilesMenu component + place it in the shell header
- [x] Task 6: store tests (actions + migration) + menu tests
- [x] Task 7: docs note (profiles are local/per-app) + full quality gate

Extensions delivered beyond the v1 outline (see §10):
- [x] Task 8: panel-size capture/restore (RegionState.size, group getLayout/
      setLayout, default fallback) + DOM-level size regression test
- [x] Task 9: useProfileState hook + profileStateRegistry (opt-in widget state:
      save/restore/reset-to-default) + reachy box-position demo
- [ ] Task 10 (open): capture main-region inner split sizes (RegionItem.size)
```

---

## 9. Next Steps (after v1)

### 9.1 Server / database-backed profiles (recommended next major version)

Today profiles live in the browser's `localStorage`: they are **per-browser,
per-device, not shared, and lost if storage is cleared or the schema version is
bumped**. A more realistic, production-grade approach is to persist profiles in
a **database behind an API**, so they follow the user rather than the browser.

Sketch:

- **Backend:** a small `profiles` table/collection — `id`, `owner`, `name`,
  `layout` (JSON), `state` (JSON widget-state blob), `updated_at`. Expose CRUD
  endpoints (`GET/POST/PUT/DELETE /profiles`), scoped per user (and optionally
  per team for sharing).
- **Frontend:** swap the `persist` (`localStorage`) middleware for a storage
  adapter that reads/writes through the API, or keep `localStorage` as an
  offline cache and sync to the server (last-write-wins or `updated_at`
  conflict handling).
- **Payoff:** profiles are cross-device, survive cache clears, can be **shared
  between teammates**, and can carry server-side metadata (owner, last-used,
  a default-on-first-load choice).

Because the store already serializes each profile as plain JSON
(`{ layout, state }`), the data model is API-ready; this is mostly a storage
adapter + backend, not a redesign.

### 9.2 Smaller follow-ups

- Export / import profiles as JSON files (a stepping stone to sharing).
- Persist `main`-region **inner split sizes** (`RegionItem.size`) the same way
  the outer panels are captured (see §10, open item).
- Fan out `useProfileState` to more widgets (sliders, scroll position) — each is
  one line; the mechanism already works.
- Per-profile metadata (icons, ordering, "modified since save" indicator).
- Dev-time warning on duplicate `useProfileState` keys.

---

## 10. Implementation Addendum (what shipped)

The implementation extended the v1 outline in three ways. This section is the
authoritative description of the shipped behaviour.

### 10.1 Freeze-on-save model (supersedes the "auto-save into active profile" wording)

The store keeps a **live `workingLayout`** separate from the saved
**`profiles`**:

- `setLayout` edits `workingLayout` only. Live edits are **not** written to any
  saved profile and are **not** persisted to `localStorage`.
- `saveAsProfile(name)` **freezes** a deep-cloned snapshot of `workingLayout`
  (and widget state, §10.3) into a new profile.
- `switchProfile(id)` **loads** a profile's frozen snapshot into `workingLayout`.
- Only `profiles` + `activeProfileId` are persisted; on load, `workingLayout` is
  restored from the active profile's snapshot (`onRehydrateStorage`).
- `resetActiveProfile()` resets `workingLayout` to `defaultLayout` (the app's
  baseline, registered once via `setDefaultLayout` on mount) **and** resets
  opt-in widget state to defaults.

This gives the intended "snapshot on save, restore on switch" behaviour:
rearranging never mutates a saved profile.

### 10.2 Panel-size persistence

A profile captures **how large** each collapsible region is, not just what's
visible. `RegionState` gained an optional `size` (percentage). The shell wires
react-resizable-panels' group `onLayoutChanged` (capture) and `groupRef.setLayout`
(restore) for the outer sidebar/main and content/bottom groups. On switch, a
visible panel restores to the profile's saved size, or — when the profile has
none (e.g. the untouched "Default") — to the shell default. Verified by a
DOM-level test that measures real panel pixel heights across switches.

**Open item:** inner `main`-region splits (`RegionItem.size`, resizing between
stacked widgets) are read on mount but not yet captured on drag. See §9.2.

### 10.3 Opt-in per-widget state — `useProfileState`

Layout alone can't restore state that lives _inside_ a widget (slider values,
scroll position, react-flow node positions). A small **state registry**
(`profileStateRegistry.ts`) plus a hook closes this:

```tsx
useProfileState("choreo.nodePositions", positions, applyPositions);
```

- On **save**, `snapshotProfileState()` collects every registered key → value
  into the profile's `state` blob (deep-cloned, frozen).
- On **switch/reset**, `applyProfileState(blob)` sets every registered widget to
  its saved value — or, when the profile has no value for a key, back to the
  widget's **default** (the value it mounted with). This is what makes switching
  to "Default" actually reset a widget rather than leave it as the last profile
  set it.
- A widget mounting into an active profile adopts its saved value immediately.

Unlimited _in principle_ (any widget, any serializable value) but **opt-in**:
each widget adds one line. Demonstrated on the reachy choreography box positions.

### 10.4 Storage

`SHELL_LAYOUT_STORAGE_VERSION` is `8`. `LayoutProfile` is
`{ id, name, layout, state? }`. A version bump discards older persisted data
(schema-reset semantics) — acceptable while local-only, but a reason to move to
server/DB storage (§9.1) before this is depended on across builds.
