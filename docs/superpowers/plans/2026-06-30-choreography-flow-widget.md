# Choreography Flow Widget (React Flow) — Specification

**Goal:** Add a node-based widget to the Reachy Mini example that lets a user
**author the robot's choreography visually** — wiring a sequence of movement
steps together as a React Flow graph and publishing it to the robot. It turns
the abstract `sequence` (currently only definable in backend code or by the AI)
into a first-class, editable diagram that follows the [React Flow](https://reactflow.dev/)
node/edge UI pattern.

**Architecture:** A Reachy **example** widget (`examples/reachy_mini/frontend/src/`),
registered into the shell like `RobotViewWidget`. It renders a React Flow canvas
of step-nodes flowing into a terminal "Robot" node, and publishes the assembled
sequence to the existing `reachy/control` channel as
`{ sequence: StepSpecPayload[] }`. **No framework or backend changes are
required** — the backend already consumes a frontend-authored sequence
(`examples/reachy_mini/backend/consumers.py:_set_sequence`, anticipated in
`producers.py` StepSpec docstring).

**Tech Stack:** TypeScript — React 19, `@xyflow/react` (new dependency, added to
the example frontend only), the framework's `usePublish` hook, CSS class names
prefixed with `reachy-choreo-` in the example's `shell.css`.

**Status:** Specification for review. Implementation follows once approved.

---

## 1. Problem Statement

The Reachy Mini performs a **choreography** — an ordered list of movement steps,
each expressed as amplitude _factors_ (`roll_factor`, `z_factor`,
`antenna_factor`) that are multiplied against the live amplitude parameters at
build time (`producers.py:build_steps`). This indirection exists specifically so
the sequence can be **replaced from the frontend**:

> "This indirection is what lets the sequence itself be replaced — e.g. from a
> frontend-authored widget, or an AI-suggested fix — without changing how
> amplitudes are interpreted." — `producers.py`, `StepSpec` docstring

Today there is **no UI** to author that sequence. A user can tune global
amplitudes via the `ParameterController`, trigger presets via `RunControls`, or
let the AI rewrite the sequence — but they cannot directly compose the dance
step-by-step. The choreography is invisible.

The Choreography Flow widget closes that gap with a node-based editor: each step
is a node, edges define execution order, and the whole graph flows into the
robot. Changing the graph and pressing **Send to robot** publishes the new
`sequence` to `reachy/control`, where the backend applies it on the next run.

**Best example:** A user opens the widget and sees the default 4-step greeting
(`tilt_right → tilt_left → raise_tilt_wiggle → home`) as four wired nodes. They
delete `home`, add a new `nod` step with `z_factor = -1`, drag it into the
chain, and click **Send to robot**. The next run performs their custom dance —
no code, no restart.

**What this solves:**

- Direct, visual authoring of the robot's choreography sequence
- Makes the existing (but UI-less) `sequence` contract usable by non-coders
- A compelling, demo-friendly showcase of the framework's widget model and the
  React Flow node/edge UX

**What this does NOT solve (out of scope — see §12):**

- Branching, parallel, or looping sequences (v1 is a single linear chain)
- Persisting the authored sequence to disk or across reloads
- A generic, framework-level node-canvas primitive (deliberate future step)
- Any backend or framework-package change
- Per-step duration (duration stays global via `step_duration_s`)

---

## 2. Scope

**In scope:**

- `ChoreographyFlowComponent` — a React component wrapping a `@xyflow/react`
  canvas that renders step-nodes + a terminal Robot node
- A custom **step node** type with an editable label and three factor controls
  (`roll_factor`, `z_factor`, `antenna_factor`)
- Add / edit / delete / reorder (rewire) steps on a single linear chain
- **Send to robot** action that linearizes the graph and publishes
  `{ sequence }` to `reachy/control` via `usePublish`
- Initialization from a configurable default sequence (the backend's
  `DEFAULT_SEQUENCE`, mirrored in the example)
- `CHOREOGRAPHY_FLOW` `WidgetDefinition` registered in the example's `main.tsx`
- `@xyflow/react` added to `examples/reachy_mini/frontend/package.json`
- Brand-themed styling via `reachy-choreo-` classes in `shell.css`
- Unit tests (Vitest) following `SafetyStatusWidget.test.tsx` patterns

**Out of scope:** see §1 and §12.

---

## 3. Concept & UX

The dance flows **left → right** into the robot. Each step is a node; edges
define order; one fixed terminal **Robot** node anchors the "flows into the
robot" metaphor.

```
┌─ Start ─┐   ┌─ Step: tilt_right ─┐   ┌─ Step: tilt_left ──┐   ┌─ Robot ──┐
│  ●──────┼──▶│ label  [tilt_right]│──▶│ label  [tilt_left] │──▶│  (sink)  │
└─────────┘   │ roll    ──●──  1.0 │   │ roll    ──●── -1.0 │   │ ▶ run    │
              │ z       ──●──  0.0 │   │ z       ──●──  0.0 │   └──────────┘
              │ antenna ──●──  0.0 │   │ antenna ──●──  0.0 │
              └────────────────────┘   └────────────────────┘
              (each step node = label + 3 factor sliders/inputs)
```

**Canvas affordances (from React Flow):** pan, zoom, a minimap and controls
(optional), draggable nodes, and edges drawn between node handles.

**Editing actions (v1):**

| Action        | How                                                       |
| ------------- | --------------------------------------------------------- |
| Add step      | "Add step" toolbar button → appends a default step node   |
| Edit factors  | Slider/number controls inside the node (range −1…1)       |
| Edit label    | Inline text field in the node header                      |
| Reorder       | Drag an edge to rewire, or drag nodes; order = edge chain |
| Delete step   | Per-node delete control (or select + Backspace)           |
| Send to robot | Toolbar button → publishes the linearized sequence        |

**Order semantics:** the sequence is the **single linear path** from the Start
node to the Robot node, walked edge-by-edge. If the graph is not one valid path
(a branch, cycle, or disconnected node), **Send to robot** is disabled with an
inline hint ("Connect all steps into a single chain"). This keeps "the graph IS
the sequence" honest and demonstrates React Flow's wiring meaningfully.

**Empty state:** if configured with an empty default sequence, the canvas shows
just `Start → Robot` and an "Add step" prompt.

---

## 4. Node & Edge Model

### 4.1 Node types

```typescript
/** Discriminator for the widget's React Flow node types. */
type ChoreoNodeType = "start" | "step" | "robot";

/** Data carried by a `step` node — one StepSpec the user is editing. */
interface StepNodeData {
  /** Human-readable step name, e.g. "tilt_right". */
  label: string;
  /** Multiplier applied to roll_amplitude_deg. Range −1…1. */
  rollFactor: number;
  /** Multiplier applied to z_amplitude_mm. Range −1…1. */
  zFactor: number;
  /** Multiplier applied to antenna_amplitude. Range −1…1. */
  antennaFactor: number;
}
```

`start` and `robot` are fixed, single-instance anchor nodes with no editable
data (the `robot` node hosts the **Send to robot** affordance; the `start` node
is the chain's head).

### 4.2 Edges

Plain default React Flow edges. Each step node exposes exactly **one target
handle** (left) and **one source handle** (right); `start` has a source only,
`robot` a target only. This handle topology naturally constrains the graph
toward a single chain (a node can sit in only one position in the path).

### 4.3 Serialization (graph → sequence)

```typescript
/** Walk start→robot, emitting one StepSpecPayload per step node in path order. */
function serializeSequence(nodes, edges): StepSpecPayload[];
```

Maps each `step` node on the path to the existing wire type
(`useReachy.ts` `StepSpecPayload`):

```typescript
{ label, roll_factor: rollFactor, z_factor: zFactor, antenna_factor: antennaFactor }
```

`start`/`robot` nodes contribute nothing to the payload.

---

## 5. Data Contract

**Publishes** to `reachy/control` (the existing control channel) on **Send to
robot**:

```json
{
  "sequence": [
    {
      "label": "tilt_right",
      "roll_factor": 1.0,
      "z_factor": 0.0,
      "antenna_factor": 0.0
    },
    {
      "label": "tilt_left",
      "roll_factor": -1.0,
      "z_factor": 0.0,
      "antenna_factor": 0.0
    }
  ]
}
```

This is the existing `ReachyControlPayload.sequence` field. The backend's
`_set_sequence` (`consumers.py`) validates and applies it — **already
implemented, no change needed**. The ws-bridge fans the publish back to all
subscribers, so other widgets (and `useReachy`) stay consistent automatically.

**Publish trigger:** explicit **Send to robot** button only — NOT on every node
edit. Authoring a dance is a deliberate, multi-edit act; publishing on each
keystroke would flood the backend and apply half-built sequences. (Contrast with
`ParameterController`, which publishes per-change because each control is an
independent live value.)

**No read-back in v1:** the widget initializes from a static default sequence,
not from the backend's current sequence. Reading the active sequence back is an
open question (§13) deferred until there is a channel that carries it.

---

## 6. Component Behaviour

### 6.1 Mount

Initialize nodes/edges from the `defaultSequence` prop: build a `start` node, one
`step` node per entry, a `robot` node, and edges linking them into a chain. Does
**not** publish on mount.

### 6.2 Edit

Node edits update local React Flow state only (controlled `nodes`/`edges` via
`useNodesState`/`useEdgesState`). Factor controls clamp to −1…1. No publish.

### 6.3 Add / delete / reorder

- **Add:** append a new `step` node with a default label (`step_N`) and zero
  factors; auto-connect it before the `robot` node.
- **Delete:** remove the node and heal the chain (reconnect its neighbours).
- **Reorder:** user rewires edges; the path is recomputed from edges on publish.

### 6.4 Send to robot

Validate the graph is a single `start → … → robot` path. If valid, serialize and
`publish("reachy/control", { sequence })`. If invalid, the button is disabled
with an inline hint; no publish occurs.

### 6.5 Disconnected EventBus

`usePublish` is a no-op when the bus is down (same as every other widget) — no
special handling.

---

## 7. Widget Definition

Registered as an example widget (mirrors `ROBOT_VIEW`):

```typescript
export const CHOREOGRAPHY_FLOW: WidgetDefinition = {
  name: "ChoreographyFlow",
  description:
    "Node-based choreography editor (React Flow). Author the robot's movement " +
    "sequence as a wired graph of step nodes and publish it to reachy/control.",
  channelPattern: "reachy/control",
  consumes: [],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    channel: { type: "string", default: "reachy/control" },
  },
  factory: () => ChoreographyFlowComponent,
};
```

The `defaultSequence` is supplied via the layout item's `props` (like the
existing `parameters` config on `ParameterController`), keeping domain data in
the example's `main.tsx`, not hard-coded in the component.

---

## 8. Example Usage (Frontend wiring)

```tsx
import { CHOREOGRAPHY_FLOW } from "./ChoreographyFlowWidget";

registry.register(CHOREOGRAPHY_FLOW);

// In initialLayout.regions.main.items (or a dedicated region):
{
  id: "choreography",
  type: "ChoreographyFlow",
  props: {
    channel: "reachy/control",
    defaultSequence: [
      { label: "tilt_right", roll_factor: 1.0 },
      { label: "tilt_left", roll_factor: -1.0 },
      { label: "raise_tilt_wiggle", roll_factor: 0.5, z_factor: 1.0, antenna_factor: 1.0 },
      { label: "home" },
    ],
  },
  order: 3,
}
```

The `defaultSequence` mirrors the backend's `DEFAULT_SEQUENCE` so the widget
opens showing the dance the robot already performs.

---

## 9. Dependency: `@xyflow/react`

- Added to **`examples/reachy_mini/frontend/package.json`** only (not the
  framework package — keeps `@app-framework/core-ui` dependency-light and
  domain-free).
- Pin an exact version (consistent with the prettier-pin lesson: CI installs
  fresh, so exact pins avoid drift). Latest `@xyflow/react` 12.x at
  implementation time.
- Import its stylesheet (`@xyflow/react/dist/style.css`) once in the widget
  module, then override with brand tokens in `shell.css`.

---

## 10. File Structure

```
examples/reachy_mini/frontend/src/
  ChoreographyFlowWidget.tsx        # CHOREOGRAPHY_FLOW def + ChoreographyFlowComponent
  ChoreographyFlowWidget.test.tsx   # Vitest unit tests
  nodes/
    StepNode.tsx                    # custom React Flow node (label + 3 factor controls)
    StartNode.tsx, RobotNode.tsx    # fixed anchor nodes (Robot hosts "Send to robot")
  shell.css                         # add reachy-choreo-* rules + React Flow theming
  main.tsx                          # register + place CHOREOGRAPHY_FLOW
package.json                        # add @xyflow/react
```

Separating `nodes/` (the React Flow plumbing) from the widget shell keeps the
choreography-specific node content isolated — making a **future extraction of a
generic flow primitive low-friction** (§12).

---

## 11. Accessibility & Styling

- **Styling:** override React Flow's default CSS with the brand tokens already
  in `shell.css` (`--card`, `--border`, `--ring`, `--primary`, `--radius`).
  Node bodies use `--card`; edges/handles use `--ring`/`--primary`. Respect the
  existing `prefers-reduced-motion` block.
- **Class naming:** `reachy-choreo-node`, `reachy-choreo-node-header`,
  `reachy-choreo-factor`, `reachy-choreo-toolbar`, etc. Per the CSS-not-inline
  convention established earlier, dynamic values (if any) go through CSS custom
  properties; static rules live in `shell.css`.
- **Selectors / `data-testid`:** prefer accessible selectors (`getByRole`,
  `getByLabelText`) for the editable controls (label input, factor
  sliders/inputs, toolbar buttons). The React Flow **canvas** has no semantic
  role, so per `CLAUDE.md` a `data-testid` on the canvas/nodes is the acceptable
  last-resort selector for canvas-level assertions.
- **Keyboard:** factor controls and toolbar buttons are standard focusable
  inputs/buttons. Full canvas keyboard navigation (node traversal) is out of
  scope for v1.

---

## 12. Out of Scope / Future

- **Generic framework flow primitive (the "Option 3" split).** A reusable
  node-canvas widget in `@app-framework/core-ui` is deliberately deferred:
  designing that abstraction against a single consumer risks baking in wrong
  assumptions. Revisit once the **drone example** exists to challenge the design
  (per the agreed "first version, revisit when we have more material" approach).
  The `nodes/` separation (§10) keeps the extraction cheap when that time comes.
- **Branching / parallel / looping sequences.** v1 is a single linear chain.
- **Persistence** of authored sequences (disk or `localStorage`).
- **Read-back** of the backend's currently-active sequence into the canvas.
- **Per-step duration / easing.** Duration stays global (`step_duration_s`).

---

## 13. Open Questions (for review)

1. **Order source:** edge-chain traversal (proposed) vs. a simpler
   left-to-right-by-position ordering. Edge traversal is more "React Flow,"
   position is simpler/less error-prone. Recommendation: edge traversal with the
   single-path constraint.
2. **Factor range:** confirm −1…1 is the intended multiplier range (the
   `DEFAULT_SEQUENCE` uses 1.0 / −1.0 / 0.5). Should it be configurable per
   deployment?
3. **Read-back:** is it worth adding a channel that carries the active sequence
   so the widget reflects AI/preset changes, or is "author-and-send" enough for
   v1?
4. **Placement:** `main` region (large canvas, proposed) vs. a sidebar. The
   canvas wants width, so `main` is recommended.

---

## 14. Testing Strategy

Vitest unit tests (`ChoreographyFlowWidget.test.tsx`), following
`SafetyStatusWidget.test.tsx` / `RunControlsWidget.test.tsx`:

- renders the default sequence as N step nodes + Start + Robot
- "Add step" appends a node connected before Robot
- editing a factor control updates that node's data (clamped to −1…1)
- editing a label updates the node header
- delete removes a node and heals the chain
- **Send to robot** publishes `{ sequence }` with steps in path order
- Send is disabled (no publish) when the graph is not a single valid chain
- does NOT publish on mount or on edit — only on Send
- serialized payload matches `StepSpecPayload[]` shape exactly

React Flow rendering is mounted in the test runtime; assertions target the
accessible controls and (for canvas-level checks) `data-testid` hooks.

---

## 15. Implementation Checklist

```
- [ ] Task 1: Dependency + scaffolding
      - [ ] Add @xyflow/react (exact pin) to example frontend package.json
      - [ ] Import @xyflow/react/dist/style.css in the widget module

- [ ] Task 2: Node components (nodes/)
      - [ ] StepNode: label input + roll/z/antenna controls (clamp −1…1), handles
      - [ ] StartNode (source handle), RobotNode (target handle + Send button)

- [ ] Task 3: ChoreographyFlowComponent
      - [ ] Props: channel, defaultSequence
      - [ ] Build initial nodes/edges from defaultSequence
      - [ ] useNodesState/useEdgesState; add/delete/reorder handlers
      - [ ] serializeSequence (walk start→robot)
      - [ ] validateSinglePath; disable Send + hint when invalid
      - [ ] Send to robot → usePublish(channel, { sequence })

- [ ] Task 4: CHOREOGRAPHY_FLOW WidgetDefinition + register in main.tsx
      - [ ] Place in main region with the default greeting sequence

- [ ] Task 5: Styling (shell.css)
      - [ ] reachy-choreo-* classes; React Flow brand theming; reduced-motion

- [ ] Task 6: Tests (see §14)

- [ ] Task 7: Quality gate
      - [ ] npm run typecheck / lint / test:ui / format:check
```
