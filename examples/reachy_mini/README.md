# Reachy Mini — Head Choreography Safety Validator

A worked example built on the app-framework. It runs a head-movement
choreography against an **in-process MuJoCo simulation** of the Reachy Mini,
checks each step against safety limits, renders the robot straight into the
dashboard, and lets an engineer ask the AI assistant to diagnose a failed run
and suggest corrected parameters.

There is **no separate daemon or viewer window** — the backend simulates and
renders the robot itself and streams frames to the browser over the EventBus.

## Layout

- `backend/` — FastAPI app: choreography runner, safety checks, and the
  in-process MuJoCo simulator/renderer (`sim.py`).
- `frontend/` — React dashboard built on `@app-framework/core-ui`.

## Prerequisites

The backend's native dependencies (`mujoco`, `reachy-mini[mujoco]`) only ship
wheels for the Python version the Reachy Mini stack targets (**3.11** at time
of writing), so the backend must run under a Python 3.11 environment — **not**
the repo's `uv` venv (which is 3.14 and cannot install these wheels).

```bash
python3.11 -m venv .venv-reachy
source .venv-reachy/bin/activate
pip install "reachy-mini[mujoco]" fastapi uvicorn pillow
pip install -e pypackages/framework-core   # the framework_core package
```

## Running

**1. Backend** (from the repo root, using the 3.11 env above) — serves on
port 8001, which the frontend dev server proxies to:

```bash
export OPENROUTER_API_KEY=...        # required for the AI assistant
PYTHONPATH=. python -m uvicorn examples.reachy_mini.backend.main:app --port 8001
```

**2. Frontend** (from the repo root, in another terminal):

```bash
npm run dev:reachy-mini
```

Open the printed URL (typically <http://localhost:5173>). The robot appears at
rest immediately.

## Try it

1. The app starts in the **Aggressive preset** (intentionally unsafe). Click
   **Start** — the first step violates the roll/duration limits, so the move is
   refused: the robot stays put and the run is marked **FAIL**.
2. Click **Safe Preset → Start** — every step passes; the robot animates
   through the sequence and the run ends **PASS**.
3. Open the **AI assistant** (right-edge tab) on a failed run and ask
   _"what's wrong with this run, and can you suggest safe parameters?"_ — it
   diagnoses the violation and proposes corrected parameters you can approve.

## Safety limits

| Axis            | Warning | Violation |
| --------------- | ------- | --------- |
| Head roll       | > ±30°  | ≥ ±40°    |
| Head height (z) | > 25 mm | ≥ 35 mm   |
| Step duration   | < 0.5 s | ≤ 0.3 s   |
