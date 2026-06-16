# Reachy Mini — Head Choreography Safety Validator

**Goal:** Add a real engineering example alongside the existing sine-wave demo, built on the Reachy Mini MuJoCo simulation. An engineer designs a head movement sequence ("greeting dance"), runs it in simulation, and verifies it is safe to deploy on the physical robot — with the AI assistant helping diagnose problems and optimise parameters when the engineer asks it to.

**Architecture:** A Python backend drives the Reachy Mini simulation via the official SDK (`reachy-mini`), publishing live telemetry, safety margins, and simulation state to the EventBus. The frontend visualises the motion in real time using the existing widget set (Chart, LogViewer, ParameterController, DataTable) plus two new widgets (StatusIndicator for simulation phase, a planned Gauge for safety margins). When a violation is detected, a new AI endpoint (`POST /ai/analyze`) sends a data snapshot to OpenRouter and returns a plain-English diagnosis and concrete parameter fix suggestions that the user can approve.

**Tech Stack:**

- Backend — Python, FastAPI, `reachy-mini[mujoco]` SDK, existing `framework_core` EventBus + AI helpers.
- Frontend — TypeScript, React, existing `@app-framework/core-ui` widgets. No new framework widgets required for v1.
- Simulation runtime — MuJoCo via `reachy-mini-daemon --sim` (macOS M2: `mjpython -m reachy_mini.daemon.app.main --sim`).

---

## 1. Problem Statement

### 1.1 Engineer persona

A robotics engineer at a product company has a Reachy Mini on their desk. They want to program a "greeting" head sequence — nods, tilts, and antenna wiggles — to run at a trade show. Before deploying to the physical robot they need to verify:

1. The head never exceeds its mechanical roll limit (risk of motor saturation or body collision).
2. The head never moves faster than the servo system can track (too short a `duration` per step causes oscillation).
3. The vertical travel stays within the safe z-range.

Today they would have to read log files or write ad-hoc scripts. **With this example they get a live dashboard, an automatic pass/fail verdict per run, and an AI they can ask "something seems off, can you look at the data and tell me what's wrong?" — and then ask it to suggest corrected parameters — all in one tool.**

### 1.2 The built-in failure mode (required by the framework demo goals)

The scenario ships two parameter presets:

| Preset         | `roll_amplitude_deg` | `step_duration_s` | `z_amplitude_mm` | Expected outcome                                             |
| -------------- | -------------------- | ----------------- | ---------------- | ------------------------------------------------------------ |
| **Safe**       | 15°                  | 1.0 s             | 15 mm            | All steps within limits — PASS                               |
| **Aggressive** | 38°                  | 0.3 s             | 32 mm            | Roll violation on step 1, speed warning on every step — FAIL |

The **Aggressive** preset is the default so the demo starts in a visibly broken state. The engineer notices the chart looks wrong or the status shows FAIL, and asks the AI: "Something seems off with this run — can you look at the telemetry and tell me what's going wrong?" The AI reads the data snapshot and explains the issue. The engineer then asks: "Can you suggest parameter values that would fix this?" — and the AI proposes a correction the engineer can approve.

**The AI does not self-trigger.** The engineer initiates the conversation. This is intentional — the AI is a tool the engineer reaches for, not an alarm system.

### 1.3 What this solves

- A realistic, non-trivial example added **alongside** the existing sine-wave demo (sine wave stays as the basic framework example — not removed).
- A user-initiated AI diagnosis loop wired into real simulation telemetry (not synthetic data).
- AI-driven parameter optimisation: engineer asks the AI to fix the parameters, AI proposes values, engineer approves.
- A concrete showcase of AI features #3 (AI with data context) and #4 (AI commands to the simulation) from the meeting backlog.
- A demo narrative that is self-contained and makes an impression without explaining the framework internals.

### 1.4 Next steps after v1

These are not permanent exclusions — they are the planned follow-on work once this example is shipped:

1. **Drone (OpenModelica FMU) example** — next example after this one; same framework structure, separate branch and spec.
2. **Replay of past runs** — engineer can re-examine a previous run without re-running the simulation. Requires an event store / run history persistence layer; to be specced separately.
3. **Mock / no-SDK mode** — run the example without `reachy-mini` installed (e.g. in CI, on a laptop without the daemon). A mock `ReachyMini` replays pre-recorded trajectories so the framework demo works anywhere.
4. **New widgets** — Gauge/KPI card for safety margins, State Machine indicator for run phase, Robot Pose Visualiser (2D SVG of head position). Existing widgets are sufficient for v1; these make the dashboard richer.
5. **3D visualisation** — full 3D robot body render using MuJoCo geometry data; separate widget spec.

---

## 2. Scope

**In scope for v1:**

- Reachy Mini example added alongside the existing sine-wave demo (sine wave is not removed).
- Backend choreography runner with configurable parameters and safety checking.
- Five EventBus channels (`reachy/telemetry`, `reachy/safety`, `reachy/state`, `reachy/log`, `reachy/control`).
- Frontend dashboard wired to those channels using existing widgets.
- New AI endpoint `POST /ai/analyze` in `framework_core/ai_layout.py` (reusing `call_openrouter`).
- User-initiated two-level AI interaction: Level 1 — engineer asks "what's wrong?" → diagnosis; Level 2 — engineer asks "how to fix it?" → parameter suggestion with approve/reject.
- Two presets (Safe, Aggressive) selectable from the frontend.
- Unit tests for the producer and the new AI endpoint helper.

**Next steps after v1 (not in this branch):**

- Drone (OpenModelica FMU) example — separate branch/spec.
- Replay of past runs — needs an event store; separate task.
- Mock / no-SDK mode — run without `reachy-mini` installed; separate task.
- New widget types (Gauge, State Machine, Robot Pose Visualiser).
- Streaming AI responses.

---

## 3. Architecture

### 3.1 System diagram

```
Browser (React)                           Backend (FastAPI / framework-core)
┌─────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│  ParameterController                │   │  ChoreographyRunner (producer)            │
│  (reachy/control channel)           │──►│  - reads params from reachy/control       │
│                                     │   │  - drives ReachyMini.goto_target()        │
│  Chart (reachy/telemetry)           │◄──│  - publishes reachy/telemetry per step    │
│  DataTable (reachy/safety)          │◄──│  - publishes reachy/safety per step       │
│  LogViewer (reachy/log)             │◄──│  - publishes reachy/log                   │
│  StatusIndicator (reachy/state)     │◄──│  - publishes reachy/state transitions     │
│                                     │   └───────────────────────────────────────────┘
│  AIChatPanel                        │   ┌───────────────────────────────────────────┐
│  (POST /ai/analyze)                 │──►│  POST /ai/analyze (new endpoint)          │
│  (POST /ai/layout)                  │──►│  POST /ai/layout  (existing endpoint)     │
└─────────────────────────────────────┘   └───────────────────────────────────────────┘
                                                         │
                                                         ▼
                                               OpenRouter API
                                          (Claude / GPT-4o / Gemini)
```

### 3.2 Data flow — normal run

```
1. User sets parameters in ParameterController → publishes to reachy/control
2. ChoreographyRunner receives params, sets state → running
3. For each step in the sequence:
   a. goto_target() called on ReachyMini (sim or real robot)
   b. After each step: publish reachy/telemetry (actual pose)
   c. Compute safety margins → publish reachy/safety
   d. If any margin < 0: publish reachy/state { phase: "violation" }, stop run
4. On completion without violation: publish reachy/state { phase: "done", verdict: "PASS" }
```

### 3.3 Data flow — user-initiated AI diagnosis loop

```
1. Run completes with FAIL verdict (or engineer notices chart looks wrong)
2. Engineer opens AIChatPanel and types freely, e.g.:
   "Something seems off with this run — can you look at the data and tell me what's going wrong?"
3. Frontend attaches a snapshot of recent telemetry + safety events to the request automatically
4. POST /ai/analyze { snapshot: last N events, params: current, history: [] }
5. Backend builds prompt (system + snapshot + current params) → call_openrouter()
6. AI returns Level 1: plain-English diagnosis
   e.g. "The head roll reached 38° on step 1, which exceeds the 35 mm violation threshold.
         The step duration of 0.3 s is also below the safe minimum of 0.5 s."
7. Frontend displays diagnosis in chat bubble
8. Engineer follows up: "What parameter values would fix this?"
   (or: "Can you optimise the parameters so the robot moves correctly?")
9. POST /ai/analyze → AI returns Level 2: { suggested_params: { roll_amplitude_deg: 18, step_duration_s: 0.7 } }
10. Frontend shows parameter diff in ParameterController (same approve/reject UX as layout diff)
11. Engineer approves → params published to reachy/control → next run uses safe values → PASS
```

The snapshot is attached automatically by the frontend on every `/ai/analyze` call — the engineer does not need to manually copy data into the chat. The AI has all the context it needs from the first message.

---

## 4. Reachy Mini SDK Integration

### 4.1 SDK primitives used

From `https://huggingface.co/docs/reachy_mini/platforms/simulation/get_started`:

```python
from reachy_mini import ReachyMini
from reachy_mini.utils import create_head_pose

with ReachyMini() as mini:
    # Move head: z = vertical mm, roll = tilt degrees
    mini.goto_target(
        head=create_head_pose(z=20, roll=10, mm=True, degrees=True),
        duration=1.0,
    )
    # Wiggle antennas: list of two floats [-0.6, 0.6]
    mini.goto_target(antennas=[0.6, -0.6], duration=0.3)
```

The simulation daemon must be running before the backend starts:

```bash
# macOS M2 (required — standard mjpython launcher)
mjpython -m reachy_mini.daemon.app.main --sim

# Other platforms
reachy-mini-daemon --sim
```

### 4.2 Safety limits (derived from SDK coordinate system)

| Axis                   | Safe range  | Warning threshold | Violation threshold |
| ---------------------- | ----------- | ----------------- | ------------------- | --- | --- |
| `roll_deg` (head tilt) | ±20°        | ±30°              | ±40°                |
| `z_mm` (head height)   | 0–25 mm     | 25–35 mm          | >35 mm              |
| `step_duration_s`      | ≥0.5 s      | 0.3–0.5 s         | <0.3 s              |
| `antenna`              | [-0.6, 0.6] | n/a               | >                   | 0.6 |     |

These limits will be confirmed once the simulation is running locally. They are encoded as named constants in `producers.py` so they can be adjusted without touching the logic.

### 4.3 Choreography sequence (4 steps, repeated `num_loops` times)

| Step | Head pose                                               | Antennas                                  | Description           |
| ---- | ------------------------------------------------------- | ----------------------------------------- | --------------------- |
| 1    | `roll = +roll_amplitude_deg`                            | `[0, 0]`                                  | Tilt right            |
| 2    | `roll = -roll_amplitude_deg`                            | `[0, 0]`                                  | Tilt left             |
| 3    | `z = +z_amplitude_mm, roll = +roll_amplitude_deg * 0.5` | `[antenna_amplitude, -antenna_amplitude]` | Raise + tilt + wiggle |
| 4    | `z = 0, roll = 0`                                       | `[0, 0]`                                  | Return to home        |

---

## 5. EventBus Channel Design

### 5.1 Channel list

| Channel            | Direction          | Publisher                            | Subscriber(s)                        |
| ------------------ | ------------------ | ------------------------------------ | ------------------------------------ |
| `reachy/telemetry` | backend → frontend | `ChoreographyRunner`                 | Chart, DataTable                     |
| `reachy/safety`    | backend → frontend | `ChoreographyRunner`                 | DataTable, AI analyze                |
| `reachy/state`     | backend → frontend | `ChoreographyRunner`                 | StatusIndicator, AIChatPanel trigger |
| `reachy/log`       | backend → frontend | `ChoreographyRunner`                 | LogViewer                            |
| `reachy/control`   | frontend → backend | ParameterController + preset buttons | `ControlConsumer`                    |

### 5.2 Event schemas

```python
class ReachyTelemetryEvent(BaseEvent):
    """Live head pose sample published after each goto_target() call."""

    step: int
    loop: int
    roll_deg: float
    z_mm: float
    antenna_l: float
    antenna_r: float
    duration_s: float


class ReachySafetyEvent(BaseEvent):
    """Safety margin assessment for a single movement step."""

    step: int
    loop: int
    roll_margin_deg: float   # positive = safe, negative = violation
    z_margin_mm: float       # positive = safe, negative = violation
    duration_margin_s: float # positive = safe, negative = too fast
    status: str              # "ok" | "warning" | "violation"
    violated_axes: list[str] # e.g. ["roll", "duration"]


class ReachyStateEvent(BaseEvent):
    """Simulation phase transition."""

    phase: str   # "idle" | "running" | "warning" | "violation" | "done"
    verdict: str # "PASS" | "FAIL" | "" (empty when not yet determined)
    message: str


class ReachyLogEvent(BaseEvent):
    """Human-readable log message from the choreography runner."""

    level: str    # "info" | "warning" | "error"
    message: str


class ReachyControlEvent(BaseEvent):
    """Parameter update or command published by the frontend."""

    # Parameters (all optional — only changed fields need to be set)
    roll_amplitude_deg: float | None = None
    z_amplitude_mm: float | None = None
    step_duration_s: float | None = None
    antenna_amplitude: float | None = None
    num_loops: int | None = None
    preset: str | None = None   # "safe" | "aggressive" | None

    # Lifecycle command (optional)
    command: str | None = None  # "start" | "stop" | "reset"
```

---

## 6. Backend Design

### 6.1 File structure

```
examples/reachy_mini/
  backend/
    __init__.py
    main.py          # FastAPI app wiring + lifespan
    producers.py     # ChoreographyRunner + all event types
    consumers.py     # ControlConsumer (handles reachy/control)
  frontend/
    index.html
    vite.config.ts
    src/
      main.tsx       # app wiring, widget registry, initial layout
      shell.css
```

### 6.2 `producers.py` — ChoreographyRunner

```python
# Key classes and functions — full implementation in task checklist

ROLL_WARN_DEG = 30.0
ROLL_VIOLATION_DEG = 40.0
Z_WARN_MM = 25.0
Z_VIOLATION_MM = 35.0
DURATION_WARN_S = 0.5
DURATION_VIOLATION_S = 0.3

SAFE_PRESET = ChoreographyParams(
    roll_amplitude_deg=15.0,
    z_amplitude_mm=15.0,
    step_duration_s=1.0,
    antenna_amplitude=0.4,
    num_loops=2,
)

AGGRESSIVE_PRESET = ChoreographyParams(
    roll_amplitude_deg=38.0,
    z_amplitude_mm=32.0,
    step_duration_s=0.3,
    antenna_amplitude=0.6,
    num_loops=2,
)


@dataclass
class ChoreographyParams:
    roll_amplitude_deg: float = 15.0
    z_amplitude_mm: float = 15.0
    step_duration_s: float = 1.0
    antenna_amplitude: float = 0.4
    num_loops: int = 2


async def run_choreography(bus: EventBus, params: ChoreographyParams) -> None:
    """Connect to the Reachy Mini simulation, execute the sequence, publish telemetry."""
    ...
```

### 6.3 `main.py` — wiring

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    params = ChoreographyParams(**AGGRESSIVE_PRESET.__dict__)  # start in broken state
    register_consumers(app.state.bus, params)
    # ChoreographyRunner starts idle — waits for "start" command from frontend
    yield


app = create_app(lifespan=lifespan)
mount_ai_routes(app)   # existing layout endpoint
mount_analyze_route(app)  # new analyze endpoint (see Section 7)
```

---

## 7. New AI Endpoint — `POST /ai/analyze`

This endpoint lives in `framework_core/ai_layout.py` alongside the existing `mount_ai_routes`. It reuses `call_openrouter` and `extract_json` from `ai.py`.

### 7.1 Request / Response models

```python
class AnalyzeRequest(BaseModel):
    """Telemetry snapshot + current params sent to the AI for diagnosis."""

    telemetry_snapshot: list[dict]   # last N ReachyTelemetryEvent dicts
    safety_snapshot: list[dict]      # last N ReachySafetyEvent dicts
    current_params: dict             # current ChoreographyParams as dict
    history: list[dict[str, str]] = []  # prior chat turns


class AnalyzeResponse(BaseModel):
    """AI diagnosis + optional parameter suggestions."""

    explanation: str             # plain-English Level 1 diagnosis
    suggested_params: dict | None = None  # Level 2: parameter values, if requested
```

### 7.2 System prompt strategy

```
You are a robotics safety advisor for a Reachy Mini robot simulation.
You are given:
1. A snapshot of recent joint telemetry (head roll, z height, antenna positions, step durations).
2. Safety margin data (how close each step came to the limits).
3. The current choreography parameters.

SAFETY LIMITS:
- Head roll: safe ≤ ±20°, warning ≤ ±30°, violation > ±40°
- Head height (z): safe 0–25 mm, warning 25–35 mm, violation > 35 mm
- Step duration: safe ≥ 0.5 s, warning 0.3–0.5 s, violation < 0.3 s

TASK:
If asked to diagnose, return:
{
  "explanation": "1-3 sentence plain-English summary of what went wrong and which axis/step caused it"
}

If asked for a parameter fix, return:
{
  "explanation": "...",
  "suggested_params": {
    "roll_amplitude_deg": <value>,
    "z_amplitude_mm": <value>,
    "step_duration_s": <value>
  }
}

Only suggest parameters that are needed — do not change parameters that are already within safe limits.
Keep suggested values within the safe zone, not just below the violation threshold.
```

### 7.3 Frontend — how the AI chat is triggered

The AI panel is **not** auto-opened. The engineer opens it manually via the "AI" button (same as the existing layout chat button). The panel is always available; there is no automatic trigger.

When the engineer sends any message, the frontend **automatically attaches** a data snapshot to the request body:

- Last 20 `reachy/telemetry` events (buffered in frontend state from the `reachy/telemetry` channel).
- Last 20 `reachy/safety` events (same pattern).
- Current parameter values from the `ParameterController` state.

The engineer does not need to ask for the data to be included — it is always there. This means any free-form question ("what's wrong?", "why did it fail?", "optimise the parameters") automatically gives the AI full context.

On Level 2 response (when `suggested_params` is present), the frontend:

1. Renders the suggested values as a diff in the ParameterController (same visual diff as layout approval).
2. Approve → publishes new params to `reachy/control` + resets the simulation to idle.
3. Reject → discards, engineer can rephrase.

---

## 8. Frontend Design

### 8.1 Widget layout (initial)

```
┌─────────────────────────────────────────────────────────┐
│  header: "Reachy Mini — Head Safety Validator"  [AI ▶]  │
├────────────────────┬────────────────────────────────────┤
│  sidebar-left      │  main                              │
│  ParameterCtrl     │  Chart: roll_deg + z_mm over steps │
│  (reachy/control)  │  DataTable: safety margins         │
│  [Safe] [Aggressive│                                    │
│  [Start] [Stop]    │                                    │
│  [Reset]           │                                    │
├────────────────────┴────────────────────────────────────┤
│  bottom: LogViewer (reachy/log)                         │
├─────────────────────────────────────────────────────────┤
│  status-bar: StatusIndicator (reachy/state phase)       │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Widget configuration

**Chart** — subscribes to `reachy/telemetry`, two series:

```json
{
  "type": "Chart",
  "props": {
    "title": "Head Pose",
    "series": [
      {
        "channel": "reachy/telemetry",
        "field": "roll_deg",
        "label": "Roll (°)",
        "color": "var(--chart-1)"
      },
      {
        "channel": "reachy/telemetry",
        "field": "z_mm",
        "label": "Z (mm)",
        "color": "var(--chart-2)"
      }
    ],
    "yLabel": "Value",
    "xLabel": "Step"
  }
}
```

**DataTable** — subscribes to `reachy/safety`, columns: `step`, `roll_margin_deg`, `z_margin_mm`, `duration_margin_s`, `status`.

**ParameterController** — publishes to `reachy/control`:

```json
{
  "parameters": {
    "roll_amplitude_deg": {
      "title": "Roll Amplitude (°)",
      "type": "number",
      "minimum": 0,
      "maximum": 45,
      "default": 38
    },
    "z_amplitude_mm": {
      "title": "Z Amplitude (mm)",
      "type": "number",
      "minimum": 0,
      "maximum": 40,
      "default": 32
    },
    "step_duration_s": {
      "title": "Step Duration (s)",
      "type": "number",
      "minimum": 0.2,
      "maximum": 3.0,
      "multipleOf": 0.1,
      "default": 0.3
    },
    "antenna_amplitude": {
      "title": "Antenna Amplitude",
      "type": "number",
      "minimum": 0,
      "maximum": 0.6,
      "multipleOf": 0.05,
      "default": 0.6
    },
    "num_loops": {
      "title": "Loops",
      "type": "number",
      "minimum": 1,
      "maximum": 5,
      "default": 2
    }
  }
}
```

**LogViewer** — subscribes to `reachy/log`.

**StatusIndicator** — subscribes to `reachy/state`.

### 8.3 Preset buttons and Start/Stop/Reset

These are rendered as plain buttons inside `Dashboard` (same pattern as the existing AI Layout button in `main.tsx`). They publish directly to `reachy/control`:

```typescript
// Preset: Aggressive
publishToChannel("reachy/control", { preset: "aggressive" });
// Start
publishToChannel("reachy/control", { command: "start" });
```

The `usePublish` hook from `@app-framework/core-ui` is used for this.

---

## 9. Testing Strategy

### 9.1 Python unit tests (`examples/reachy_mini/tests/test_producers.py`)

| Test                                   | What it checks                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `test_safety_check_ok`                 | Params within safe range → status "ok", no violated axes               |
| `test_safety_check_warning`            | Roll near threshold → status "warning"                                 |
| `test_safety_check_violation`          | Roll exceeds limit → status "violation", violated_axes includes "roll" |
| `test_safe_preset_all_pass`            | All steps of safe preset → no violations                               |
| `test_aggressive_preset_violates`      | Aggressive preset → at least one violation on step 1                   |
| `test_control_consumer_updates_params` | `reachy/control` event → params mutated correctly                      |
| `test_control_consumer_preset`         | `{ preset: "safe" }` → params match SAFE_PRESET                        |

### 9.2 Python unit tests (`pypackages/framework-core/tests/test_ai_analyze.py`)

| Test                                             | What it checks                                             |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `test_analyze_endpoint_returns_explanation`      | Valid snapshot → 200 with explanation                      |
| `test_analyze_endpoint_returns_suggested_params` | Snapshot with violations → suggested_params present        |
| `test_analyze_endpoint_missing_api_key`          | No env var → 500 with clear message                        |
| `test_build_analyze_prompt_structure`            | Messages array has correct role sequence and snapshot JSON |

### 9.3 Frontend unit tests

| Test                                   | What it checks                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Snapshot attached on every AI request  | `/ai/analyze` request body always contains `telemetry_snapshot` + `safety_snapshot` + `current_params` |
| Param diff renders on suggested_params | Diff viewer shows parameter changes when AI returns `suggested_params`                                 |
| Approve applies params                 | `reachy/control` published with suggested values on approve                                            |
| Reject discards suggestion             | No `reachy/control` publish on reject                                                                  |

---

## 10. File Structure

```
examples/reachy_mini/
  backend/
    __init__.py
    main.py                    # FastAPI app + lifespan, mount_ai_routes + mount_analyze_route
    producers.py               # ChoreographyParams, SAFE_PRESET, AGGRESSIVE_PRESET,
                               # ReachyTelemetryEvent, ReachySafetyEvent, ReachyStateEvent,
                               # ReachyLogEvent, run_choreography()
    consumers.py               # ControlConsumer — handles reachy/control events
  frontend/
    index.html
    vite.config.ts             # /ws + /ai proxies to backend
    tsconfig.json
    src/
      main.tsx                 # App, AppShell, Dashboard, widget registry, initial layout
      shell.css
  tests/
    test_producers.py
  README.md                    # how to install reachy-mini[mujoco] + run the daemon

pypackages/framework-core/src/framework_core/
  ai_layout.py                 # add mount_analyze_route(), AnalyzeRequest, AnalyzeResponse,
                               # build_analyze_prompt()

pypackages/framework-core/tests/
  test_ai_analyze.py
```

---

## 11. Dependencies

### Python (new)

Add to `examples/reachy_mini/backend/pyproject.toml` (separate from the framework package — keep demo deps out of framework):

```toml
[project]
dependencies = [
    "reachy-mini[mujoco]",
    "framework-core",   # local editable
    "fastapi",
    "uvicorn",
]
```

macOS M2 note: use `pip install` not `uv pip install` for `reachy-mini[mujoco]` due to MuJoCo + uv compatibility issues on Apple Silicon (documented in the official setup guide).

### TypeScript (no new dependencies)

The Reachy Mini example frontend uses the same `@app-framework/core-ui` package as the existing demo — no new npm packages needed.

---

## 12. Implementation Checklist

```
- [ ] Task 0: Setup
      - [ ] Create examples/reachy_mini/ directory structure
      - [ ] Create examples/reachy_mini/backend/pyproject.toml with reachy-mini[mujoco] dep
      - [ ] Verify reachy-mini-daemon --sim launches on macOS M2 via mjpython
      - [ ] Confirm joint limits from simulation (update constants in producers.py if needed)

- [ ] Task 1: Event types + ChoreographyParams (producers.py)
      - [ ] ReachyTelemetryEvent
      - [ ] ReachySafetyEvent (with violated_axes list)
      - [ ] ReachyStateEvent (phase + verdict + message)
      - [ ] ReachyLogEvent
      - [ ] ReachyControlEvent (params + preset + command fields)
      - [ ] ChoreographyParams dataclass
      - [ ] SAFE_PRESET and AGGRESSIVE_PRESET constants
      - [ ] Safety limit constants (ROLL_WARN_DEG, etc.)
      - [ ] compute_safety() pure function (no bus side effects — easier to unit test)

- [ ] Task 2: ChoreographyRunner (producers.py)
      - [ ] run_choreography(bus, params) — drives ReachyMini.goto_target() for each step
      - [ ] Publishes reachy/telemetry after each step
      - [ ] Calls compute_safety() and publishes reachy/safety after each step
      - [ ] Transitions reachy/state: idle → running → (warning|violation|done)
      - [ ] Stops on violation (does not continue remaining steps)
      - [ ] Publishes reachy/log messages throughout
      - [ ] Unit tests: test_producers.py (all cases in Section 9.1)

- [ ] Task 3: ControlConsumer (consumers.py)
      - [ ] Subscribes to reachy/control
      - [ ] Handles preset selection (safe / aggressive)
      - [ ] Handles parameter updates (individual fields)
      - [ ] Handles lifecycle commands (start / stop / reset)
      - [ ] start triggers asyncio.create_task(run_choreography(...))
      - [ ] stop cancels the running task (if any)
      - [ ] reset re-publishes reachy/state { phase: "idle" } and clears telemetry

- [ ] Task 4: Backend wiring (main.py)
      - [ ] lifespan sets up ChoreographyParams with AGGRESSIVE_PRESET (demo starts broken)
      - [ ] register_consumers() called with params
      - [ ] mount_ai_routes(app) (existing)
      - [ ] mount_analyze_route(app) (new — Task 5)
      - [ ] No background tasks at startup — runner starts on "start" command only

- [ ] Task 5: POST /ai/analyze endpoint (framework_core/ai_layout.py)
      - [ ] AnalyzeRequest model
      - [ ] AnalyzeResponse model
      - [ ] build_analyze_prompt() — system prompt + snapshot + history
      - [ ] mount_analyze_route(app) function
      - [ ] POST /ai/analyze handler — calls call_openrouter, extracts JSON, returns AnalyzeResponse
      - [ ] Unit tests: test_ai_analyze.py (all cases in Section 9.2)

- [ ] Task 6: Frontend — main.tsx
      - [ ] Widget registry: PARAMETER_CONTROLLER, CHART, LOG_VIEWER, DATA_TABLE
      - [ ] Initial layout matching Section 8.1 diagram
      - [ ] Preset buttons (Safe / Aggressive) publishing to reachy/control
      - [ ] Start / Stop / Reset buttons publishing to reachy/control
      - [ ] Auto-open AI chat on reachy/state violation (useChannel hook)
      - [ ] Pre-fill AI input with diagnosis prompt on violation
      - [ ] Level 2: render suggested_params as ParameterController diff
      - [ ] Approve → publish to reachy/control + reset simulation
      - [ ] vite.config.ts: proxy /ws and /ai to backend
      - [ ] Unit tests: Section 9.3 cases

- [ ] Task 7: Quality gate
      - [ ] ruff check .
      - [ ] mypy pypackages/framework-core/src
      - [ ] pytest -q
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test:ui
      - [ ] npm run format:check
      - [ ] Manual smoke test: start daemon, start backend, open frontend,
            click Start with Aggressive preset, confirm violation fires,
            confirm AI diagnosis returns, confirm param fix + re-run passes
```

---

## 13. Open Questions / Decisions Needed

| #   | Question                                                                                          | Impact                                             | Suggested default                                                                           |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | What are the exact joint limits for the physical Reachy Mini?                                     | Safety constants in producers.py                   | Confirm from simulation output once running; use conservative values until confirmed        |
| 2   | Does `goto_target()` block until the move is complete, or is it fire-and-forget?                  | Telemetry timing — when to publish after each step | Assume blocking (duration-based) until tested; add `await asyncio.sleep(duration)` fallback |
| 3   | Should the AI chat pre-fill auto-send, or require the user to press Send?                         | UX surprise factor                                 | Require user to press Send — Frederic's demo story needs a human beat at this moment        |
| 4   | Where do preset buttons live — in `ParameterController` props or as standalone UI in `Dashboard`? | Layout complexity                                  | Standalone buttons in Dashboard (simpler, same pattern as AI Layout button)                 |
| 5   | Should `POST /ai/analyze` share the conversation history with `POST /ai/layout`?                  | Context coherence                                  | Separate histories for v1 — layout and analysis are different tasks                         |

---

## 14. Next Steps (after v1)

These are the planned follow-on items in priority order:

1. **Drone (OpenModelica FMU) example** — same framework structure, separate branch and spec.
2. **Replay of past runs / run comparison** — engineer re-examines a previous run without re-simulating. Needs an event store.
3. **Mock / no-SDK mode** — run the example without `reachy-mini` installed (CI, laptops without the daemon). Mock `ReachyMini` replays pre-recorded trajectories.
4. **Gauge / KPI widget** — single big number with threshold colouring for safety margin ("distance to limit").
5. **State Machine widget** — phase indicator (Idle → Running → Warning → Violation → Done) to replace the plain StatusIndicator.
6. **Robot Pose Visualiser** — 2D SVG of head roll + z position over time.
7. **3D visualisation** — full robot body render using MuJoCo geometry.
