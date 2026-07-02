# Choreography Flow Widget (React Flow) — Specification

**Goal:** Add a node-based widget to the Reachy Mini example that lets a user
**author the robot's choreography visually** — wiring a sequence of movement
steps together as a React Flow graph and publishing it to the robot. It turns
the abstract `sequence` (currently only definable in backend code or by the AI)
into a first-class, editable diagram that follows the [React Flow](https://reactflow.dev/)
node/edge UI pattern.

**Architecture:** A Reachy **example** widget (`examples/reachy_mini/frontend/src/`),
registered into the shell like `RobotViewWidget`. It renders a React Flow canvas
of step-nodes each flowing **directly into a single "Robot" node** (which shows
the live MuJoCo render). **Send to robot** publishes the assembled sequence plus
a `start` command to the existing `reachy/control` channel
(`{ sequence: StepSpecPayload[], command: "start" }`). **No framework or backend
changes are required** — the backend already consumes a frontend-authored
sequence and runs it (`consumers.py`: `_set_sequence` then `_handle_command`).

**Tech Stack:** TypeScript — React 19, `@xyflow/react` (new dependency, added to
the example frontend only), the framework's `usePublish` / `useChannel` hooks,
CSS class names prefixed with `reachy-choreo-` in a co-located
`ChoreographyFlowWidget.css`.

**Status:** Implemented; spec updated to match. The layout evolved during
implementation review from the originally-approved chain model to a fan-in model
(see §13).

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

- Branching, parallel, or looping sequences (v1 is a flat ordered list)
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
- Add / edit / delete / reorder (by vertical position) steps that fan into the
  robot
- **Send to robot** action that serializes the steps and publishes
  `{ sequence, command: "start" }` to `reachy/control` via `usePublish`
- Initialization from a configurable default sequence (the backend's
  `DEFAULT_SEQUENCE`, mirrored in the example)
- `CHOREOGRAPHY_FLOW` `WidgetDefinition` registered in the example's `main.tsx`
- `@xyflow/react` added to `examples/reachy_mini/frontend/package.json`
- Brand-themed styling via `reachy-choreo-` classes in `shell.css`
- Unit tests (Vitest) following `SafetyStatusWidget.test.tsx` patterns

**Out of scope:** see §1 and §12.

---

## 3. Concept & UX

Each step is an input node whose controls flow **directly into a single Robot
node** — the reactflow.dev "inputs → output" layout. There is **no `start` node
and no step-to-step chain**. The **Robot node shows the live MuJoCo render**
(the same `reachy/frame` stream as the sidebar), so a run's motion is visible
right in the flow.

```
┌─ Step: tilt_right ─┐
│ label [tilt_right] │╌╌╌╮
│ roll    ──●──  1.0 │   ╎
│ antenna ──●──  0.0 │   ╎    ┌────────────┐
└────────────────────┘   ├╌╌▶ │   Robot    │
┌─ Step: tilt_left ──┐   ╎    │ [live      │
│ label [tilt_left]  │╌╌╌┤    │  render]   │
│ roll    ──●── -1.0 │   ╎    └────────────┘
└────────────────────┘   ╎
┌─ Step: … ──────────┐   ╎
│ …                  │╌╌╌╯
└────────────────────┘
  (faint dashed "imaginary" guide lines fan into the robot)
```

**Editing actions:**

| Action        | How                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------- |
| Add step      | "Add step" toolbar button → appends a step below the others                              |
| Edit factors  | Sliders inside the node (range −1…1), marked `nodrag` so they adjust the value           |
| Edit label    | Inline text field in the node header (`nodrag`)                                          |
| Reorder       | Drag a node up/down — order is top-to-bottom vertical position                           |
| Delete step   | Per-node `×` control (`nodrag`)                                                          |
| Send to robot | Toolbar button → publishes the sequence **and a start command** so the robot runs it now |

**Order semantics:** the sequence order is the steps' **top-to-bottom vertical
position** — `serializeSequence` sorts step nodes by their `y`. The edges are
faint dashed guide lines showing each step flows into the robot; they do not
encode order. (Interactive node controls carry React Flow's `nodrag` class so
using a slider adjusts its value instead of dragging the node box.)

**Empty state:** an empty default sequence shows just the Robot node and an
"Add step" prompt.

---

## 4. Node & Edge Model

### 4.1 Node types

```typescript
/** The widget's React Flow node types. */
type ChoreoNodeType = "step" | "robot";

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

`robot` is a fixed, single-instance sink node that renders the live MuJoCo
frame. There is no `start` node.

### 4.2 Edges

One edge per step, `step → robot` (fan-in). Each step node has a single **source
handle** (right); `robot` has a single **target handle** (left). Edges are
decorative (they show flow into the robot); the sequence order comes from node
position, not the edges.

### 4.3 Serialization (graph → sequence)

```typescript
/** Emit one StepSpecPayload per step node, ordered top-to-bottom by y. */
function serializeSequence(nodes): StepSpecPayload[];
```

Maps each `step` node (sorted by vertical position) to the existing wire type
(`useReachy.ts` `StepSpecPayload`):

```typescript
{ label, roll_factor: rollFactor, z_factor: zFactor, antenna_factor: antennaFactor }
```

The `robot` node contributes nothing to the payload.

---

## 5. Data Contract

**Publishes** to `reachy/control` (the existing control channel) on **Send to
robot** — the sequence **plus a `start` command**, so the robot immediately runs
the edited choreography:

```json
{
  "command": "start",
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

These are existing `ReachyControlPayload` fields. The backend's control handler
applies params (`_set_sequence`) **then** the command (`_handle_command`) in one
message, so the sequence is applied and a run is launched — **already
implemented, no backend change needed**. The ws-bridge fans the publish back to
all subscribers, so other widgets (and `useReachy`) stay consistent.

**Why auto-run:** the widget is a dedicated "send this dance to the robot"
action, so publishing the sequence without running it left users seeing no
change. Bundling `command: "start"` makes Send visibly perform the edited
choreography.

**Publish trigger:** explicit **Send to robot** button only — NOT on every node
edit. Authoring a dance is a deliberate, multi-edit act; publishing on each
keystroke would flood the backend and apply half-built sequences.

**No read-back in v1:** the widget initializes from a static default sequence,
not from the backend's current sequence. Reading the active sequence back is an
open question (§13) deferred until there is a channel that carries it.

---

## 6. Component Behaviour

### 6.1 Mount

Initialize nodes/edges from the `defaultSequence` prop: one `step` node per
entry stacked vertically, a `robot` node, and one `step → robot` edge each. Does
**not** publish on mount.

### 6.2 Edit

Node edits update local React Flow state only (controlled `nodes`/`edges` via
`useNodesState`/`useEdgesState`). Factor controls clamp to −1…1. No publish.

### 6.3 Add / delete / reorder

- **Add:** append a new `step` node (label `step_N`, zero factors) below the
  others, wired into the robot.
- **Delete:** remove the node and its edge into the robot.
- **Reorder:** drag a node up/down — order is recomputed from vertical position
  on Send.

### 6.4 Send to robot

Serialize the step nodes (by `y`) and `publish("reachy/control", { sequence,
command: "start" })`. Always enabled — there is no chain to validate.

### 6.5 Robot node (live render)

The `robot` node subscribes to `reachy/frame` via `useChannel` and shows the
latest frame, so a run's motion appears in the flow. Before any frame it shows a
"Send a choreography and press Start" placeholder. (Note: frames only stream
while a run executes, so there is no instant per-slider preview — a live-preview
renderer would be a backend follow-up.)

### 6.6 Disconnected EventBus

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
  module, then override with brand tokens in the co-located CSS.

---

## 10. File Structure

```
examples/reachy_mini/frontend/src/
  choreography.ts                   # pure graph logic (build/serialize/add/remove)
  choreography.test.ts              # pure-logic unit tests
  ChoreographyFlowWidget.tsx        # CHOREOGRAPHY_FLOW def + component + Step/Robot nodes
  ChoreographyFlowWidget.test.tsx   # component unit tests
  ChoreographyFlowWidget.css        # co-located reachy-choreo-* rules + React Flow theming
  main.tsx                          # register + place CHOREOGRAPHY_FLOW
package.json                        # add @xyflow/react
```

The pure graph logic lives in `choreography.ts` (no React/React Flow runtime),
so it is unit-testable without a DOM and a **future generic flow primitive is a
low-friction extraction** (§12).

---

## 11. Accessibility & Styling

- **Styling:** override React Flow's default CSS with the brand tokens in the
  co-located `ChoreographyFlowWidget.css` (`--card`, `--border`, `--ring`,
  `--primary`, `--radius`). Node bodies use `--card`; edges are faint dashed
  brand lines. Co-located (not `shell.css`) so it loads in tests too.
- **Class naming:** `reachy-choreo-node`, `reachy-choreo-node-header`,
  `reachy-choreo-factor`, `reachy-choreo-toolbar`, `reachy-choreo-robot`, etc.
  Interactive controls also carry React Flow's `nodrag` class.
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
  The `choreography.ts` pure-logic split (§10) keeps the extraction cheap.
- **Branching / parallel / looping sequences.** v1 is a flat ordered list.
- **Persistence** of authored sequences (disk or `localStorage`).
- **Per-step duration / easing.** Duration stays global (`step_duration_s`).
- **Read-back of the active sequence — HIGH-PRIORITY follow-up (not v1).**
  There is no channel today that carries the full resolved sequence, and adding
  one is a backend change we keep out of v1. But this is the top follow-up right
  after merge: the backend should echo its resolved sequence on a channel (e.g.
  `reachy/choreography`) that the widget subscribes to, so the canvas visibly
  updates when the **AI** (or a preset) rewrites the choreography. That visual
  feedback is a strong AI demo, so it should land soon after this PR.

---

## 13. Resolved Decisions (reviewed)

These were open questions during review; the answers below are the decisions the
implementation follows. **Note:** the layout evolved during implementation review
from the originally-approved `Start → chain → Robot` model to a **fan-in** model
(no `Start`, each step → robot, order by position) — see decision 1 and §3.

1. **Order source → vertical position (fan-in), not an edge chain.** The
   originally-approved edge-chain model (`Start → step → … → Robot`) proved
   confusing in review — the `Start` node and internal chaining read as
   misleading. Final model: **no `Start` node**; each step wires **directly into
   the robot**, and order is the steps' top-to-bottom `y` position. Edges are
   faint dashed guide lines. This matches the reactflow.dev "inputs → output"
   layout the widget is modelled on.
2. **Factor range → −1…1, kept non-configurable for v1.** The `DEFAULT_SEQUENCE`
   only uses values in −1…1, and factors multiply the max safe amplitudes, so
   ±1 is the sane envelope. Hard-coded (no config prop) to keep the first
   version simple — lift the limit later only if it proves too restrictive.
3. **Read-back → out of v1; high-priority follow-up.** See §12 — author-and-send
   for now, backend echo channel to follow soon after merge for AI visual
   feedback.
4. **Placement → `main` region.** The canvas needs width to pan/zoom and show
   several steps; a sidebar is too narrow. It is the interactive centerpiece.
5. **Send auto-runs.** Send publishes `{ sequence, command: "start" }` so the
   robot immediately performs the edited dance — publishing without running left
   users seeing no change.
6. **Robot node shows the live render.** The output node displays the live
   `reachy/frame` MuJoCo image, so motion is visible in the flow during a run.
7. **Interactive controls carry `nodrag`.** Sliders/inputs/buttons inside nodes
   use React Flow's `nodrag` class so interacting with them adjusts the value
   instead of dragging the node.

---

## 14. Testing Strategy

Vitest unit tests (`ChoreographyFlowWidget.test.tsx`), following
`SafetyStatusWidget.test.tsx` / `RunControlsWidget.test.tsx`:

- pure logic (`choreography.test.ts`): `buildInitialGraph` makes a step node per
  entry + one robot (no start) with `step → robot` edges; `serializeSequence`
  returns steps top-to-bottom; `addStep`/`removeStep` grow/shrink the graph;
  `clampFactor` bounds to −1…1
- component (`ChoreographyFlowWidget.test.tsx`): renders Add step / Send to robot;
  **Send** publishes `{ sequence, command: "start" }` with steps in order;
  "Add step" grows the published sequence by one; does NOT publish on mount
- serialized payload matches `StepSpecPayload[]` shape exactly

React Flow rendering is mounted in the test runtime; assertions target the
accessible controls and (for canvas-level checks) `data-testid` hooks.

---

## 15. Implementation Checklist

```
- [x] Task 1: Dependency + scaffolding
      - [x] Add @xyflow/react (exact pin) to example frontend package.json
      - [x] Import @xyflow/react/dist/style.css in the widget module

- [x] Task 2: Pure graph logic (choreography.ts, TDD)
      - [x] buildInitialGraph: step nodes + robot, step → robot edges (no start)
      - [x] serializeSequence: step nodes ordered by vertical position
      - [x] addStep / removeStep; clampFactor (−1…1)

- [x] Task 3: ChoreographyFlowComponent + nodes
      - [x] StepNode (label + roll/z/antenna sliders, all `nodrag`), RobotNode
            (live reachy/frame render via useChannel)
      - [x] Props: channel, defaultSequence
      - [x] useNodesState/useEdgesState; add/delete/reorder handlers
      - [x] Send to robot → publish(channel, { sequence, command: "start" })

- [x] Task 4: CHOREOGRAPHY_FLOW WidgetDefinition + register in main.tsx (main region)

- [x] Task 5: Styling (co-located ChoreographyFlowWidget.css)
      - [x] reachy-choreo-* classes; dashed edges; brand theming

- [x] Task 6: Tests (see §14)

- [x] Task 7: Quality gate — typecheck / lint / test:ui / format:check
```
