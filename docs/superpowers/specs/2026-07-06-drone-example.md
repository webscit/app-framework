# Drone — Flight Manoeuvre Stability Validator

**Goal:** Add a second real engineering example alongside the Reachy Mini one,
built on the [ALSETLab Modelica Drone 3D FMI](https://github.com/ALSETLab/Modelica-Drone-3D-FMI)
model exported as an FMU. A controls engineer designs a flight **manoeuvre**
(a profile of position setpoints), runs it in simulation, and verifies the drone
**stays stable and responds fast enough** — with the AI assistant helping
diagnose instability and suggest corrected commands when the engineer asks.

This is the drone analogue of the Reachy "choreography safety validator" — same
_pattern_, different machine. The pattern is: **an engineer authors a motion,
then verifies it against the machine's physical limits.** For Reachy the motion
is a head-movement choreography checked against mechanical limits (roll angle,
z-travel, step speed). A drone has no head; its motion is a **flight manoeuvre**
(moving through 3D space, tilting to accelerate), checked against **stability and
responsiveness limits** (tilt, settling time, overshoot).

**Architecture:** A Python backend drives the pre-built `Drone.fmu` via
[FMPy](https://github.com/CATIA-Systems/FMPy), stepping the co-simulation while
applying the commanded setpoints and publishing live telemetry (position,
attitude, velocity, propeller speeds), a per-segment **stability assessment**,
and run state to the EventBus. The frontend visualises the flight in real time
using the **existing widget set** (Chart, DataTable, LogViewer,
ParameterController, plus a lightweight trajectory/attitude view). The existing
domain-agnostic `POST /ai/layout` endpoint is reused — the example supplies its
own AI instructions + telemetry snapshot, exactly like Reachy — so the single AI
chat panel handles both layout changes and stability diagnosis.

**Tech Stack:**

- Backend — Python, FastAPI, **FMPy** (FMU co-simulation), existing
  `framework_core` EventBus + AI helpers.
- Frontend — TypeScript, React, existing `@app-framework/core-ui` widgets. **No
  new framework widgets required for v1.**
- Simulation runtime — the FMI 2.0 co-simulation FMU `Drone.fmu`, recompiled
  from its bundled C sources by FMPy for the host platform (see §4.1). No
  OpenModelica/Dymola/Simulink GUI is needed at runtime.

**Status:** Specification for review. Implementation follows once approved
(mirrors the Reachy example's spec → PR → review → implement flow).

---

## 1. Problem Statement

### 1.1 Engineer persona

A controls engineer tuning a quadcopter's position controller has the drone
plant + controller as a Modelica model (exported to `Drone.fmu`). Before flashing
gains onto real hardware they need to answer:

1. **Does a commanded manoeuvre stay stable?** A large or abrupt position
   setpoint can make the drone tilt past the point of no return (loss of lift →
   flip), or set up sustained oscillation.
2. **Is it responsive enough?** Under rapid, high-frequency setpoint changes
   (e.g. an operator jinking the stick), does the drone track quickly, or does it
   lag and lag-induce instability?
3. **Does it settle without excessive overshoot?** Overshooting a waypoint near
   an obstacle is unsafe.

Today they read CSV dumps from a batch simulation or wire up a one-off plotting
script. **With this example they get a live dashboard, an automatic per-segment
PASS/FAIL verdict, and an AI they can ask "the drone looks unstable on the second
setpoint — what's going wrong?" and then "suggest command settings that keep it
stable" — all in one tool.**

### 1.2 The built-in failure mode (required by the framework demo goals)

The scenario ships two command presets:

| Preset         | Step  | Frequency | Rate (step×freq) | Outcome                                    |
| -------------- | ----- | --------- | ---------------- | ------------------------------------------ |
| **Gentle**     | 1.5 m | 0.5 Hz    | 0.75 m/s         | Tilt ~10°, each segment settles — **PASS** |
| **Aggressive** | 12 m  | 1.5 Hz    | 18 m/s           | Setpoint rate ≫ tracking limit → **FAIL**  |

> **Tuned against the real FMU (validated 2026-07-08).** The values above are the
> _validated_ presets, which differ from the first-draft guesses (Gentle was 3 m
> / 0.2 Hz). The real controller has a sharp stability cliff: it tracks a ramped
> setpoint up to ~1 m/s, and beyond that **loses control and diverges** — there
> is no graceful "tilts to 40° then recovers" regime. So the failure mode is
> _divergence_ (loss of control), not a mild tilt overshoot. See §4.4.

The **Aggressive** preset is the default so the demo starts in a visibly broken
state (tilt runs away, the trajectory diverges, FAIL banner). The engineer
notices and asks the AI: _"This manoeuvre looks unstable — can you read the
telemetry and tell me what's wrong?"_ The AI reads the snapshot and explains
(e.g. "the setpoint rate is 18 m/s, far past the ~1 m/s the controller can track,
so it can't keep up — tilt runs away and it loses control"). The engineer then
asks _"suggest command settings that fix this"_ and the AI proposes a correction
to approve.

**The AI does not self-trigger** — the engineer reaches for it. (Same principle
as the Reachy example.)

### 1.3 What this solves

- A **second** realistic, non-trivial example on a completely different physics
  domain (rigid-body flight dynamics via an FMU), proving the framework is not
  Reachy-specific.
- Exercises the framework against an **FMI co-simulation** backend rather than a
  bespoke Python simulator — a very common industrial integration.
- Reuses the **same AI diagnosis + command-suggestion loop** on new data,
  validating that `/ai/layout` is genuinely domain-agnostic.
- Stresses the current design with a second consumer (informs whether widgets /
  the AI context API need to generalise — see §13).

### 1.4 Next steps after v1

- A node-based **manoeuvre editor** (waypoint sequence) reusing the Reachy
  `ChoreographyFlow` chain widget — waypoints map naturally onto step-nodes.
- True **3D drone visualisation** (body pose + spinning propellers) from the
  FMU's geometry variables (§4.2) — v1 uses a 2D trajectory + attitude chart.
- A generic framework "FMU runner" helper, once a second FMU example exists to
  justify the abstraction.

---

## 2. Scope

**In scope (v1):**

- `Drone.fmu` co-simulation driven by FMPy in a background task, with
  time-varying position setpoints applied from the commanded manoeuvre.
- Live publishing of telemetry (position, attitude, velocity, propeller speeds),
  a per-segment stability assessment, run state, and a human log to the EventBus.
- Stability/responsiveness limits (tilt, settling time, overshoot, divergence).
- **Gentle** / **Aggressive** command presets + Start / Stop / Reset lifecycle.
- Frontend dashboard assembled from existing widgets (Chart, DataTable,
  LogViewer, ParameterController, Connection/Run controls, a trajectory view).
- AI diagnosis + command-suggestion via the reused `/ai/layout` endpoint.
- Python + frontend unit tests.

**Out of scope (v1):** new framework widgets, a node-based manoeuvre editor,
real-time 3D rendering, hardware, closed-loop AI (AI never auto-commands),
retuning the controller inside the FMU (we command setpoints, not gains).

---

## 3. Architecture

### 3.1 System diagram

```
┌──────────────────────────── Backend (FastAPI + framework_core) ─────────────┐
│                                                                             │
│  Drone.fmu ──FMPy──▶ ManoeuvreRunner ──▶ EventBus ──▶ /ws bridge            │
│   (co-sim)          (apply setpoints,     (publish)                         │
│                      read outputs,                                          │
│                      assess stability)                                     │
│                         ▲                                                   │
│                         │ setpoints / start / stop / reset                 │
└─────────────────────────┼───────────────────────────────────────────────── │
                          │ drone/control
┌─────────────────────────┼──────────────── Frontend (ApplicationShell) ──────┐
│  RunControls  Parameter │Controller   Chart(traj/attitude)  DataTable        │
│  (presets +   (setpoint step,          LogViewer  ConnectionStatus  AI panel │
│   Start/Stop) frequency, hold)         TrajectoryView (drone/state banner)   │
└──────────────────────────────────────────────────────────────────────────── ┘
```

### 3.2 Data flow — normal run

1. On mount the example publishes the default (**Aggressive**) manoeuvre; the
   backend starts a run.
2. `ManoeuvreRunner` steps `Drone.fmu` at a fixed rate; each step it sets the
   FMU's setpoint inputs, does one `doStep`, reads outputs, and publishes a
   `drone/telemetry` sample.
3. At the end of each **segment** (a hold at one setpoint) it computes a
   `drone/stability` assessment (peak tilt, overshoot, settling time → status).
4. On completion it publishes `drone/state` `{ phase: "done", verdict }` and a
   summary `drone/log` line.

### 3.3 Data flow — AI diagnosis loop

Identical to Reachy: the frontend keeps a rolling snapshot of the last N
telemetry + stability events. When the engineer sends a chat message, that
snapshot and the example's `AI_INSTRUCTIONS` are attached to the `/ai/layout`
request; the AI replies with an explanation, suggested command params, a layout
tweak, or a combination. The engineer approves suggested params, which publish to
`drone/control`.

---

## 4. Drone FMU Integration

### 4.1 FMU runtime (FMPy, cross-platform)

- The repo ships `Drone.fmu` compiled for Windows. On macOS/Linux the binary is
  absent, so **FMPy recompiles the FMU's bundled C sources** for the host at load
  time (`fmpy.util.compile_platform_binary`). _Validated so far:_ FMPy compiling
  and running `Drone.fmu` on macOS M2 (single run to completion). _Not yet
  validated:_ the per-step co-simulation loop below.
- No OpenModelica GUI / Dymola / Simulink is required — they are only for
  authoring the model. At runtime we use the FMU + FMPy alone.
- The backend uses **FMPy's low-level FMU2 co-simulation API** (instantiate →
  setup → `setReal(inputs)` / `doStep` / `getReal(outputs)` loop → terminate) so
  it can inject setpoints and read outputs every step, rather than `simulate_fmu`
  (which runs to completion in one shot).

**✅ Biggest risk RESOLVED (Task 0, 2026-07-08).** The setpoints are FMI
**inputs** (`causality="input"`), so per-step injection in the `doStep` loop
works and the full concept — including the high-frequency responsiveness test —
is viable. Confirmed by reading `modelDescription.xml`: the FMU is **FMI 2.0
CoSimulation** (`modelIdentifier="Drone"`,
`canHandleVariableCommunicationStepSize=true`). The setpoint inputs are named
`xcoord` / `ycoord` / `zcoord` (not the spec's earlier guess `targetX/Y/Z`).
The fixed-parameter fallback (one FMU run per segment) is therefore **not
needed**.

### 4.2 FMU variables used

Inputs (position setpoints — the "command"), confirmed in `modelDescription.xml`:

| Input    | Value ref | Meaning                      |
| -------- | --------- | ---------------------------- |
| `xcoord` | 352321536 | Commanded North position (m) |
| `ycoord` | 352321538 | Commanded East position (m)  |
| `zcoord` | 352321537 | Commanded altitude (m)       |

Outputs read every step (value references confirmed in `modelDescription.xml`;
the rich attitude/velocity/propeller signals are `causality="None"` **local**
variables, read directly by value reference via `fmi2GetReal`):

| Variable                                          | VR(s)                | Mapped telemetry field           |
| ------------------------------------------------- | -------------------- | -------------------------------- |
| `droneChassis1.bodyShape2.body.frame_a.r_0[1..3]` | 33554432/433/434     | `x`, `y`, `z` (m)                |
| `droneChassis1.bodyShape3.body.phi[1..3]`         | 33554438/439/440     | `roll`, `pitch`, `yaw` (rad→deg) |
| `droneChassis1.bodyShape3.v_0[1..3]`              | 33554435/436/437     | `vx`, `vy`, `vz` (m/s)           |
| `propellerRev{,1,2,3}.revolute.w`                 | 33554445/448/451/454 | `prop_w[0..3]` (rad/s)           |

(The official `output` variables `xgps`/`ygps`/`zgps` mirror the r_0 position;
we read `r_0` for consistency with the attitude/velocity locals.) Names are
resolved at runtime via FMPy's `read_model_description`, not hard-coded blindly.

### 4.3 Stability & responsiveness limits (the pass/fail criteria)

Assessed per manoeuvre **segment** (a hold at one setpoint):

| Metric                         | Warning | Violation       | Why                                   |
| ------------------------------ | ------- | --------------- | ------------------------------------- |
| Peak tilt (max\|roll,pitch\|)  | > 20°   | > 35°           | Past ~35° lift drops sharply → flip   |
| Settling time (to ±5% of step) | > 3 s   | > 6 s           | Responsiveness / controller bandwidth |
| Overshoot (beyond target)      | > 20%   | > 50%           | Waypoint safety                       |
| Divergence (\|v\| or pos)      | —       | grows unbounded | Loss of control                       |

Limits live in the **example backend** (like Reachy's), not the framework, and
are surfaced to the AI via `AI_INSTRUCTIONS`.

### 4.4 Manoeuvre definition

A manoeuvre is an ordered list of **segments**, each = a target setpoint held for
a duration. v1 derives the segment list from a small parameter set (so presets
are trivial), and the AI/engineer tune those parameters:

```python
@dataclass
class ManoeuvreParams:
    setpoint_step_m: float   # magnitude of each setpoint change
    change_frequency_hz: float  # how often the setpoint changes
    num_segments: int        # how many setpoint changes
    hold_time_s: float       # derived from change_frequency_hz
```

(A future version replaces this with an explicit waypoint sequence authored in a
node editor — §1.4.)

**Runner behaviour, validated against the real FMU (2026-07-08):**

- **Hover warm-up.** The drone starts at rest; commanding a manoeuvre before it
  settles diverges. The runner holds the origin setpoint for ~1.5 s first (this
  telemetry is published as `segment = −1` so the take-off shows).
- **Ramped setpoint.** Each segment ramps the setpoint linearly from the previous
  target to the new one across its hold time — the controller cannot track an
  instantaneous step reference (it diverges at _any_ step size). The ramp **rate**
  = `setpoint_step_m × change_frequency_hz` is the aggression knob; the stability
  cliff sits near ~1 m/s.
- **Step size `dt = 0.01 s`.** The co-simulation is numerically unstable at
  coarser steps (≥ 0.02 s), so `dt` is fixed small.
- **Stop on first violation.** A violated segment ends the run (mirrors Reachy
  refusing an unsafe move), and a runaway tilt/position aborts the segment
  immediately so a diverging run stops promptly.

---

## 5. EventBus Channel Design

### 5.1 Channel list

| Channel           | Direction        | Payload                             |
| ----------------- | ---------------- | ----------------------------------- |
| `drone/control`   | frontend→backend | manoeuvre params / preset / command |
| `drone/telemetry` | backend→frontend | one flight sample per sim step      |
| `drone/stability` | backend→frontend | per-segment stability assessment    |
| `drone/state`     | backend→frontend | run phase + verdict                 |
| `drone/log`       | backend→frontend | human-readable log line             |

### 5.2 Event schemas (frontend `useDrone.ts` types)

```typescript
interface DroneTelemetry {
  t: number; // sim time (s)
  segment: number;
  position: number[]; // position (m)
  attitude: number[]; // attitude (deg)
  velocity: number[]; // velocity (m/s)
  prop_w: number[]; // 4 propeller speeds (rad/s)
}

interface DroneStability {
  segment: number;
  peak_tilt_deg: number;
  settling_time_s: number;
  overshoot_pct: number;
  tilt_margin_deg: number; // limit − peak (negative = exceeded)
  settling_margin_s: number;
  status: "ok" | "warning" | "violation";
  violated: string[]; // e.g. ["tilt", "settling"]
}

interface DroneState {
  phase: "idle" | "running" | "warning" | "violation" | "done";
  verdict: "" | "PASS" | "FAIL";
  message: string;
}

interface DroneControlPayload {
  setpoint_step_m?: number;
  change_frequency_hz?: number;
  num_segments?: number;
  preset?: "gentle" | "aggressive";
  command?: "start" | "stop" | "reset";
}
```

The `status`/margin shape deliberately matches Reachy's `ReachySafety` so the
same `DataTable` `statusVariants` row-colouring and `SafetyStatus`-style banner
work unchanged.

---

## 6. Backend Design

### 6.1 File structure

```
examples/drone/
  backend/
    __init__.py
    fmu_runner.py     # DroneFmuRunner: FMPy co-sim loop + telemetry publish
    stability.py      # per-segment assessment against §4.3 limits
    consumers.py      # drone/control handler (params/preset/command)
    main.py           # create_app() wiring, lifespan, background task
    pyproject.toml    # fmpy + framework-core deps (Python pin per FMPy)
    Drone.fmu         # vendored from ALSETLab (or fetched at setup)
  frontend/
    src/ (mirrors examples/reachy_mini/frontend/src structure)
  tests/
```

### 6.2 `fmu_runner.py` — DroneFmuRunner (sketch)

```python
# Full implementation in the checklist. Key responsibilities:
# - read_model_description(Drone.fmu); resolve input/output value references
# - instantiate + setupExperiment + enterInitializationMode/exit
# - loop at fixed dt: set setpoints for the current segment, fmu.doStep(dt),
#   getReal(outputs) → publish drone/telemetry
# - at each segment boundary: stability.assess(...) → publish drone/stability
# - on cancel/finish: publish drone/state + drone/log; fmu.terminate()/freeInstance
```

Runs as an `asyncio` background task cancelled/restarted on `command: "start"`
(same lifecycle contract as Reachy's `ChoreographyRunner`). Because
`fmu.doStep` is blocking C, each step is offloaded via
`asyncio.to_thread`/executor so the event loop stays responsive.

### 6.3 `main.py` — wiring

`create_app()` from `framework_core`, register the `drone/control` consumer, and
start the runner in the FastAPI lifespan on the **Aggressive** preset (so the
demo opens broken), publishing to `app.state.bus`. Serves on **port 8002**
(Reachy uses 8001), proxied by the frontend dev server.

---

## 7. AI Endpoint (reused, not extended)

No backend/framework change: the drone frontend attaches its own
`AI_INSTRUCTIONS` (drone domain: what telemetry/stability mean, the tilt/settling
limits, which params are tunable) and a rolling snapshot of `drone/telemetry` +
`drone/stability` to each `POST /ai/layout` request — exactly as Reachy does.
The endpoint stays domain-agnostic; it forwards context + instructions verbatim.

---

## 8. Frontend Design

### 8.1 Widget layout (initial)

| Region       | Widget(s)                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------- |
| header       | RunControls (Gentle/Aggressive presets, Start/Stop/Reset)                                          |
| sidebar-left | TrajectoryView (top-down x/y path) + ParameterController                                           |
| main         | StabilityStatus banner + Chart (attitude roll/pitch, altitude) + DataTable (stability per segment) |
| bottom       | LogViewer (`drone/log`)                                                                            |
| status-bar   | ConnectionStatus                                                                                   |

All widgets are the **existing** `@app-framework/core-ui` ones except
`TrajectoryView` and `StabilityStatus`, which are thin **example-local** widgets
(like Reachy's `RobotView`/`SafetyStatus`) — `TrajectoryView` draws the x/y path
from buffered telemetry on a `<canvas>`; `StabilityStatus` is a colored PASS/FAIL
card driven by `drone/state`.

### 8.2 Widget configuration (highlights)

- **Chart** on `drone/telemetry`: series `roll`, `pitch` (deg) and `z` (m).
- **DataTable** on `drone/stability`: columns segment / status / peak_tilt_deg /
  settling_time_s / overshoot_pct, with `statusVariants` colouring
  (violation=error, warning=warning, ok=success) — reused verbatim from Reachy.
- **ParameterController** on `drone/control`: `setpoint_step_m` (slider),
  `change_frequency_hz` (slider), `num_segments` (input).

### 8.3 Presets & lifecycle

`RunControls`-style buttons publish `{ preset: "gentle" | "aggressive" }` and
`{ command: "start" | "stop" | "reset" }` to `drone/control` — same contract as
Reachy, so the widget is near-identical.

**Optimistic state sync (as in Reachy).** The backend is the source of truth, but
the UI stays responsive by displaying optimistically: the ws-bridge echoes every
publish back to all subscribers (including the publisher), so a `useDrone` hook
derives the live parameters from the `drone/control` echo. A preset click shows
the preset's values immediately (optimistic local display) — the preset
magnitudes are mirrored in the frontend for that instant render — and the backend
applies the same values on receipt and confirms via the echo. This keeps sliders
and the active-preset highlight in sync without waiting for a round-trip.

---

## 9. Testing Strategy

- **Python** (`examples/drone/tests/`): `stability.assess` returns correct
  status/margins for crafted telemetry (tilt over/under limit, slow/fast
  settling, overshoot); manoeuvre segmentation from params; preset values map to
  expected PASS/FAIL. The FMU loop is tested against a **stub FMU** (a small fake
  exposing the same set/doStep/get interface) so tests don't require the compiled
  binary.
- **Frontend** (Vitest): `useDrone` buffers/derives snapshot correctly;
  TrajectoryView renders a path from samples; StabilityStatus reflects verdict.
- **Quality gate:** `ruff`/`mypy`/`pytest` + `npm run typecheck`/`lint`/`test:ui`/
  `format:check`.

---

## 10. Dependencies

- **Python (new):** `fmpy` (FMU co-simulation; may pull `numpy`, and needs a C
  toolchain to recompile the FMU on non-Windows — documented in the example
  README). Pin Python per FMPy's supported range in the example `pyproject.toml`.
- **Vendoring:** `Drone.fmu` from ALSETLab/Modelica-Drone-3D-FMI (MIT-compatible
  license check at implementation), committed under `examples/drone/backend/` or
  fetched by a setup script.
- **TypeScript:** none new for v1 (TrajectoryView uses a plain `<canvas>`).

---

## 11. Implementation Checklist

```
- [x] Task 0: Verify setpoint causality in modelDescription.xml — DONE: they are
      FMI inputs (`xcoord`/`ycoord`/`zcoord`), FMI 2.0 CoSimulation; per-step
      injection works, no fallback needed (§4.1)
- [ ] Task 1: Backend scaffolding (examples/drone/backend, pyproject, vendored FMU)
- [ ] Task 2: DroneFmuRunner — FMPy co-sim loop, setpoint injection, telemetry publish
- [ ] Task 3: stability.assess — §4.3 limits, margins, status
- [ ] Task 4: consumers.py — drone/control (params/preset/command) + presets
- [ ] Task 5: main.py — create_app wiring, lifespan on Aggressive preset, port 8002
- [ ] Task 6: Frontend — useDrone hook + channel types
- [ ] Task 7: Example widgets — TrajectoryView, StabilityStatus, RunControls
- [ ] Task 8: main.tsx — layout + AI_INSTRUCTIONS + widget config
- [ ] Task 9: Python tests (stub FMU) + frontend tests
- [ ] Task 10: README (macOS FMPy build notes) + quality gate
```

---

## 12. Next Steps (after v1)

- Node-based waypoint manoeuvre editor (generalise `ChoreographyFlow`).
- 3D drone visualisation from the FMU geometry variables.
- A reusable framework "FMU runner" once the abstraction is justified by ≥2 FMUs.
