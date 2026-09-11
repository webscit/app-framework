# Shared SimulationControls widget — design

GitHub issue: #33

## Problem

`examples/drone/frontend/RunControlsWidget.tsx` and
`examples/reachy_mini/frontend/RunControlsWidget.tsx` each implement their own
start/stop widget, and each backend (`examples/drone/backend/drone_example/consumers.py`,
`examples/reachy_mini/backend/reachy_mini_example/consumers.py`) implements its
own `ControlConsumer` with near-identical task-lifecycle logic (cancel-then-launch
on start, cancel on stop) wrapped around domain-specific parameter application
and simulation code.

## Goal

Add a shared `SimulationControls` widget to `framework-core-ui`, plus a minimal
backend lifecycle/control-channel convention in `framework-core`, so future
examples (and, later, drone/reachy_mini) can drive start/stop for a simulation
without re-implementing task-lifecycle bookkeeping.

## Scope

In scope:
- A new `LifecycleConsumer` base class and `SimulationStateEvent` model in
  `pypackages/framework-core`.
- A new `SimulationControls` widget in `packages/framework-core-ui`, registered
  as a sixth default widget alongside `LOG_VIEWER`, `STATUS_INDICATOR`,
  `PARAMETER_CONTROLLER`, `CHART`, `DATA_TABLE`.
- Unit/component tests for both.

Out of scope (left for follow-up issues, per the GitHub issue's "Dependencies"
note that example retrofits depend on this one):
- Retrofitting `examples/drone` and `examples/reachy_mini` to use the new
  widget/base class.
- Reset command (both examples have a "Reset" button that cancels and restores
  a default preset; not part of this issue's start/stop scope).
- Preset selection (both examples have preset buttons; parameter tuning is
  already covered by the existing `PARAMETER_CONTROLLER` widget).
- The new widget don't renders
  the `phase` string; a domain wanting richer status styling pairs this
  widget with `STATUS_INDICATOR`.

## Backend: `sci_framework_core.lifecycle`

New module: `pypackages/framework-core/src/sci_framework_core/lifecycle.py`.

### `SimulationStateEvent(BaseEvent)`

Generic state payload published on a simulation's state channel:

```python
class SimulationStateEvent(BaseEvent):
    phase: str
    message: str = ""
```

Domain apps may subclass to add fields (e.g. `verdict`), the same way
`DroneStateEvent`/`ReachyStateEvent` do today — this class only needs to
satisfy `LifecycleConsumer`'s bookkeeping, not replace domain event types.

### `LifecycleConsumer`

Abstract base class that owns the running-task lifecycle currently duplicated
in `examples/drone/backend/drone_example/consumers.py` and
`examples/reachy_mini/backend/reachy_mini_example/consumers.py`:

```python
class LifecycleConsumer(ABC):
    def __init__(self, bus: EventBus, state_channel: str) -> None:
        self._bus = bus
        self.state_channel = state_channel
        self._task: asyncio.Task[None] | None = None

    async def __call__(self, channel: str, message: BaseEvent) -> None:
        data = message.model_dump()
        payload = data.get("payload", data)
        if not isinstance(payload, dict):
            return
        self.apply_params(payload)
        await self._handle_command(payload.get("command"))

    async def _handle_command(self, command: str | None) -> None:
        if command == "start":
            await self._cancel_running()
            self._task = asyncio.create_task(self.run())
        elif command == "stop":
            await self._cancel_running()

    async def _cancel_running(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Simulation task raised during cancellation")
        self._task = None

    @abstractmethod
    def apply_params(self, payload: dict[str, Any]) -> None:
        """Apply domain-specific parameter overrides from a control payload."""

    @abstractmethod
    async def run(self) -> None:
        """Run one simulation to completion, publishing SimulationStateEvents."""
```

Notes:
- The `payload.get("payload", data)` unwrap step matches the existing
  `_ClientPublishEvent` unwrapping convention in both examples' consumers.
- `apply_params` and `run` are abstract — all domain logic (FMU stepping,
  choreography sequencing, param validation) stays in example code. The base
  class only removes the duplicated cancel/launch bookkeeping.
- No `reset` handling; `command` values other than `"start"`/`"stop"` are
  ignored by `_handle_command` (a no-op), leaving room for a subclass to
  intercept `apply_params` for its own commands like `"reset"` without
  conflicting with the base class.

### Testing

`pypackages/framework-core/tests/test_lifecycle.py`:
- A minimal concrete subclass (e.g. one that increments a counter and awaits
  an `asyncio.Event` in `run()`) verifies:
  - `"start"` launches `run()`.
  - `"stop"` cancels the running task.
  - A second `"start"` while one is running cancels the first before starting
    the second.
  - `apply_params` is invoked on every message, `run` is not invoked for a
    command other than `"start"`.
  - Malformed payloads (non-dict `payload`) are ignored, not raised.

## Frontend: `SimulationControls` widget

New files under `packages/framework-core-ui/src/widgets/SimulationControls/`,
following the existing per-widget subfolder convention (`ParameterController/`,
`StatusIndicator/`, etc.):
- `SimulationControls.tsx`
- `SimulationControls.test.tsx`

### Component

```tsx
export interface SimulationControlsProps {
  /** Channel to read simulation state from. */
  stateChannel: string;
  /** Channel to publish start/stop commands to. */
  controlChannel: string;
  /** Value of `phase` that means "a run is in flight". */
  runningPhase: string;
  /** Title shown above the controls. */
  title?: string;
}
```

Behavior:
- `useChannel<SimulationStatePayload>(stateChannel)` for `{ phase, message }`.
- `usePublish()` to send `{ command: "start" }` / `{ command: "stop" }` to
  `controlChannel`.
- `isRunning = state?.phase === runningPhase`.
- Renders: `title` (optionally), a Start button (disabled
  when `isRunning`), a Stop button (disabled when `!isRunning`).
- Accessible labels on both buttons (`aria-label="Start simulation"` /
  `"Stop simulation"`), matching the project's accessibility-selector
  convention for tests.

### `SIMULATION_CONTROLS` widget definition

Added to `packages/framework-core-ui/src/widgets/defaultWidgets.ts` and
exported from `index.ts`, alongside the other five default widgets:

```ts
export const SIMULATION_CONTROLS: WidgetDefinition = {
  name: "SimulationControls",
  description:
    "Generic start/stop controls for a simulation run. Reads phase/message " +
    "from a state channel and publishes start/stop commands to a control " +
    "channel.",
  channelPattern: "*/state",
  consumes: [],
  priority: 10,
  defaultRegion: "header",
  parameters: {
    stateChannel: { type: "string", default: "sim/state" },
    controlChannel: { type: "string", default: "sim/control" },
    runningPhase: { type: "string", default: "running" },
    title: { type: "string", default: "Simulation Controls" },
  },
  factory: () => SimulationControlsComponent as ComponentType,
};
```

Opt-in via `registry.register(SIMULATION_CONTROLS)`, same registration
pattern examples already use for `PARAMETER_CONTROLLER`/`LOG_VIEWER`. Not
auto-registered by default — not every app has a start/stop-shaped
simulation.

### Testing

`SimulationControls.test.tsx` (Vitest + `react-test-renderer`, matching
`StatusIndicator.test.tsx`/`ParameterController.test.tsx` patterns):
- Start button disabled when `phase === runningPhase`, enabled otherwise
  (and vice versa for Stop).
- Clicking Start/Stop calls `usePublish`'s publish function with
  `{ command: "start" }` / `{ command: "stop" }` on `controlChannel`.

## Documentation

- JSDoc on `SimulationControlsProps`, its fields, and `SIMULATION_CONTROLS`
  (description, `@example` on the component), per `CLAUDE.md`'s public-API
  doc requirement.
- Python docstrings on `SimulationStateEvent` and `LifecycleConsumer`
  (summary + `Args`/`Returns` on each method), per `CLAUDE.md`.
