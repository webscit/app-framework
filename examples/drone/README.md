# Drone — Flight Manoeuvre Stability Validator

A worked example built on the app-framework. It flies a commanded **manoeuvre**
(a profile of position setpoints) on a quadcopter **FMI co-simulation**
(`Drone.fmu`, driven by [FMPy](https://github.com/CATIA-Systems/FMPy)), assesses
each segment against stability/responsiveness limits, streams live telemetry to
the dashboard, and lets an engineer ask the AI assistant to diagnose an unstable
run and suggest corrected commands.

It is the drone analogue of the Reachy Mini example — same _pattern_ (author a
motion, verify it against the machine's physical limits), different machine and a
completely different physics backend (an FMU rather than a bespoke simulator).

## Layout

- `backend/` — FastAPI app: the FMU co-simulation runner (`fmu_runner.py`),
  per-segment stability assessment (`stability.py`), manoeuvre definition
  (`manoeuvre.py`), the `drone/control` consumer, and the FMPy adapter
  (`fmpy_model.py`).
- `frontend/` — React dashboard built on `@app-framework/core-ui`.

## Prerequisites

**The FMU is not committed** (it is a ~3.5 MB binary). Fetch it once:

```bash
python -m drone_example.fetch_fmu
```

FMPy publishes wheels for CPython **3.11–3.12**, and on macOS/Linux it
**recompiles the FMU's bundled C sources** on first run (the FMU ships a Windows
binary only), so a **C toolchain** is required. Use a dedicated 3.11/3.12
environment — **not** the repo's `uv` venv (3.14, outside FMPy's range):

```bash
python3.12 -m venv .venv-drone
source .venv-drone/bin/activate
pip install fmpy fastapi "uvicorn[standard]"   # [standard] → websockets, for /ws
pip install -e pypackages/framework-core       # the framework_core package
```

> macOS note: the first run compiles `Drone.fmu` for your platform (needs Xcode
> command-line tools — `xcode-select --install`). This can take a few seconds;
> subsequent runs reuse the compiled binary.

## Running

**1. Backend** (repo root, using the 3.11/3.12 env above) — serves on port 8002,
which the frontend dev server proxies to:

```bash
export OPENROUTER_API_KEY=...        # required for the AI assistant
PYTHONPATH=. python -m uvicorn drone_example.main:app --port 8002
```

**2. Frontend** (repo root, in another terminal):

```bash
npm run dev:drone
```

Open the printed URL (typically <http://localhost:5173>). The dashboard
auto-starts the default (Aggressive) manoeuvre, so it opens directly into a
running, visibly unstable **FAIL**.

## Try it

1. The app starts in the **Aggressive preset** (setpoint rate ~18 m/s, far past
   the controller's ~1 m/s tracking limit). After the hover warm-up the tilt
   runs away, the trajectory diverges, and the run is aborted **FAIL** on the
   first violated segment.
2. Click **Gentle Preset → Start** — the ramp rate is 0.75 m/s, tilt stays ~10°,
   every segment settles, and the run ends **PASS**.
3. Open the **AI assistant** (right-edge tab) on a failed run and ask _"this
   manoeuvre looks unstable — what's wrong, and can you suggest command settings
   that keep it stable?"_ — it reads the telemetry snapshot, explains that the
   setpoint rate exceeds what the controller can track, and proposes corrected
   parameters you can approve.

The key knob is the **setpoint rate** = `setpoint_step_m × change_frequency_hz`:
below ~1 m/s the drone tracks the ramp and stays stable; above it, it loses
control.

## Stability limits

| Metric                          | Warning | Violation       |
| ------------------------------- | ------- | --------------- |
| Peak tilt (max\|roll,pitch\|)   | > 20°   | ≥ 35°           |
| Settling time (to ±5% of step)  | > 3 s   | ≥ 6 s           |
| Overshoot (beyond target)       | > 20%   | ≥ 50%           |
| Divergence (\|pos\|/non-finite) | —       | loss of control |

## Testing

The Python tests run a **stub FMU** (no compiled binary or FMPy needed), so they
run in the repo's default environment:

```bash
uv run pytest examples/drone/tests -q      # backend
npm run test -w @app-framework/drone-frontend -- --run   # frontend
```

The FMPy adapter itself (`fmpy_model.py`) is not unit-tested — it requires the
real FMU + a 3.11/3.12 env + a C toolchain, exercised by running the app.
