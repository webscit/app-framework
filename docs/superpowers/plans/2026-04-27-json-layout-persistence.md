# JSON Layout Persistence — Phase 1 Implementation Plan

**Goal:** Persist the `ShellLayout` state across browser sessions using `localStorage` so that
engineers can reload the application and find their dashboard exactly as they left it.

**Architecture:** `ShellLayout` was designed to be JSON-serializable from day one (Phase 1 shell
spec, Section 4c). Persistence wraps the existing Zustand layout store with the `persist`
middleware — no changes to `ShellLayout`, `RegionItem`, or any existing type. The storage key is
versioned so that future schema changes can migrate or reset stored layouts gracefully without
crashing the application.

**Tech Stack:** TypeScript — React, Zustand `persist` middleware, `localStorage`.

---

## 1. Problem Statement

Without persistence, every dashboard is throwaway. When an engineer reloads the page, all widget
placements, panel visibility states, and region configurations are lost. They must rebuild their
layout from scratch on every session.

`ShellLayout` was explicitly designed in Phase 1 to be `JSON.stringify`-safe — no functions, no
class instances, no circular references. The data model is ready for persistence today. This phase
wires it up.

**What this solves:**

- Layout survives page reloads
- Panel open/closed state is restored (sidebar, bottom panel)
- Widget placements and their props are restored
- No server required — runs entirely in the browser

**What this does not solve (out of scope for now):**

- Sharing layouts between team members
- Server-side layout storage
- File-based import/export (JSON files)
- AI-generated layouts
- Multi-user sessions

---

## 2. Scope

**In scope:**

- Wrap the Zustand layout store with `persist` middleware using `localStorage`
- Auto-save layout on every change
- Auto-load layout on startup
- Schema version field to handle future migrations
- Graceful fallback to default layout when stored data is missing, corrupted, or from an
  incompatible schema version

**Out of scope:**

- Server-side storage
- File import/export
- Layout sharing
- Authentication

---

## 3. Storage Strategy

### 3.1 Zustand `persist` middleware

Zustand ships a `persist` middleware that wraps any store and automatically serializes its state
to a storage backend on every change, and deserializes it on startup. No manual
`localStorage.getItem` / `localStorage.setItem` calls are needed.

```typescript
import { persist } from "zustand/middleware";

const useShellLayoutStore = create<ShellLayoutStore>()(
  persist(
    (set, get) => ({
      layout: createDefaultShellLayout(),
      setLayout: (updater) => set((state) => ({ layout: updater(state.layout) })),
    }),
    {
      name: "app-framework:shell-layout", // localStorage key
      version: 1, // schema version
      migrate, // migration function (see Section 5)
    },
  ),
);
```

### 3.2 Storage key

The localStorage key is `app-framework:shell-layout`. The namespace prefix (`app-framework:`)
prevents collisions with other applications running on the same origin.

### 3.3 What is stored

The full `ShellLayout` object is stored — all six regions, their `visible` state, and their
`items` arrays. This matches exactly what `useShellLayout()` returns today.

```json
{
  "state": {
    "layout": {
      "regions": {
        "header": { "visible": true, "items": [] },
        "sidebar-left": { "visible": true, "items": [] },
        "main": {
          "visible": true,
          "items": [{ "id": "LogViewer", "type": "LogViewer", "props": {}, "order": 0 }]
        },
        "sidebar-right": { "visible": false, "items": [] },
        "bottom": { "visible": false, "items": [] },
        "status-bar": { "visible": true, "items": [] }
      }
    }
  },
  "version": 1
}
```

### 3.4 First load vs subsequent loads

| Situation                                | Behaviour                                  |
| ---------------------------------------- | ------------------------------------------ |
| No stored layout                         | Falls back to `createDefaultShellLayout()` |
| Stored layout found, version matches     | Restores stored layout                     |
| Stored layout found, version mismatch    | Runs migration function (see Section 5)    |
| Stored layout is corrupted / unparseable | Falls back to `createDefaultShellLayout()` |

### 3.5 Non-togglable region correction

The same correction applied at mount time in `ApplicationShell` applies here — if a stored layout
has `visible: false` for `header`, `main`, or `status-bar`, the value is silently corrected to
`true` before the layout is applied to the store. This is handled by the existing
`ApplicationShell` normalization logic and requires no changes to the persist layer.

---

## 4. Data Model

`ShellLayout` requires no changes. It was designed to be JSON-serializable from day one.

The only addition is a `SHELL_LAYOUT_STORAGE_VERSION` constant that acts as the schema version
sentinel:

```typescript
/** Increment this when ShellLayout schema changes in a breaking way. */
export const SHELL_LAYOUT_STORAGE_VERSION = 1;
```

This constant is the single source of truth for the current schema version. It is passed directly
to the `persist` middleware `version` option.

---

## 5. Schema Versioning and Migration

The `persist` middleware accepts a `version` number and a `migrate` function. When the stored
version does not match the current version, `migrate` is called with the stored state and the
stored version number.

```typescript
function migrate(persistedState: unknown, version: number): ShellLayoutStore {
  // version 0 → version 1: no breaking changes yet, return as-is
  if (version === 0) {
    return persistedState as ShellLayoutStore;
  }
  // Unknown version — fall back to default
  return { layout: createDefaultShellLayout() };
}
```

**Rules for future migrations:**

- Increment `SHELL_LAYOUT_STORAGE_VERSION` whenever `ShellLayout`, `RegionItem`, or `RegionState`
  changes in a breaking way
- Add a migration branch in `migrate()` for every version increment
- If migration is not possible (e.g. shape is completely different), return
  `createDefaultShellLayout()` — never crash

---

## 6. Edge Cases

**Corrupted localStorage:** If `JSON.parse` throws on the stored value, Zustand `persist`
catches the error and falls back to the initial state (`createDefaultShellLayout()`). No user
action is required.

**Storage quota exceeded:** If `localStorage.setItem` throws a `QuotaExceededError`, Zustand
`persist` logs a warning. The in-memory layout continues to work normally for the current session
— only persistence is lost. No crash.

**Unknown widget type in restored layout:** A restored layout may reference a widget type that is
no longer registered (e.g. a plugin was removed). The existing `ApplicationShell` unknown-type
handling renders a "Widget not found" placeholder. No changes needed here.

**Non-togglable regions stored as hidden:** Corrected silently to `visible: true` by the existing
`ApplicationShell` normalization. No changes needed in the persist layer.

**Multiple tabs:** Each tab reads and writes to the same `localStorage` key. Zustand `persist`
does not synchronize across tabs in Phase 1 — the last tab to write wins. Cross-tab
synchronization is out of scope.

**Clearing storage:** The user can clear their layout by calling
`useShellLayoutStore.persist.clearStorage()` from the browser console or via a future "Reset
layout" UI action. After clearing, the next reload falls back to `createDefaultShellLayout()`.

---

## 7. Public API Changes

No new public API surface is introduced. The `useShellLayout()` hook and `ApplicationShell`
component are unchanged from the caller's perspective.

The only internal change is that `useShellLayoutStore` is now wrapped with `persist`. Callers
using `useShellLayout()` see no difference — the hook signature, return type, and behaviour are
identical. Persistence is an implementation detail of the store.

One new utility is exported for testing and the future "Reset layout" action:

```typescript
/**
 * Clears the persisted layout from localStorage and resets the store to the
 * default layout. Useful for testing and for a future "Reset layout" UI action.
 */
export function clearPersistedLayout(): void {
  useShellLayoutStore.persist.clearStorage();
  useShellLayoutStore.getState().setLayout(() => createDefaultShellLayout());
}
```

---

## 8. Implementation Checklist

```
- [ ] Task 1: Add persist middleware to layout store
      - [ ] Install no new dependencies — zustand/middleware is already available
      - [ ] Wrap useShellLayoutStore with persist middleware
      - [ ] Set storage key to "app-framework:shell-layout"
      - [ ] Set version to SHELL_LAYOUT_STORAGE_VERSION (= 1)
      - [ ] Wire migrate function

- [ ] Task 2: Schema version constant
      - [ ] Add SHELL_LAYOUT_STORAGE_VERSION = 1 to shellTypes.ts
      - [ ] Export from index.ts

- [ ] Task 3: Migration function
      - [ ] Implement migrate() with version 0 → 1 passthrough
      - [ ] Unknown version falls back to createDefaultShellLayout()

- [ ] Task 4: clearPersistedLayout utility
      - [ ] Implement clearPersistedLayout() in stores/shellStore.ts
      - [ ] Export from index.ts

- [ ] Task 5: Tests
      - [ ] persist saves layout to localStorage on change
      - [ ] persist restores layout from localStorage on mount
      - [ ] missing storage key falls back to createDefaultShellLayout()
      - [ ] corrupted value falls back to createDefaultShellLayout()
      - [ ] version mismatch triggers migrate()
      - [ ] clearPersistedLayout() resets store and clears storage
      - [ ] non-togglable regions stored as hidden are corrected to visible

- [ ] Task 6: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```
