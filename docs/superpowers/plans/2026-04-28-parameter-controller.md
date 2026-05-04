# Parameter Controller Widget — Implementation Plan

**Goal:** Provide a built-in widget that lets engineers send simulation parameters to the backend over the EventBus. Supports three control types — **slider**, **number input**, and **dropdown** - covering the most common simulation tuning patterns without requiring any custom widget.

**Architecture:** Follows the same pattern as `LogViewer`. The widget is a `WidgetDefinition` in `defaultWidgets.ts` whose `factory` returns `ParameterControllerComponent`. The component publishes `application/x-params+json` payloads to a configurable channel whenever any control value changes.

**Tech Stack:** TypeScript — React, Zustand (via existing EventBus publish hook `usePublish`), CSS class names prefixed with `sct-ParameterController-`.

---

## 1. Problem Statement

Simulation engineers need to tune parameters at runtime — adjusting time steps, damping coefficients, convergence tolerances — without restarting the simulation. Today there is no built-in way to send parameter updates from the dashboard to the backend. Engineers either hard-code values or build their own ad-hoc form every time.

The Parameter Controller widget solves this by providing a ready-made control panel that publishes parameter updates over the EventBus. The backend subscribes to the same channel and applies the incoming values to the running simulation.

**Best example:** A simulation model running as a subprocess in the backend exposes three tunable parameters — `timestep` (slider, 0.001–1.0), `max_iterations` (number input, 1–10000), and `solver` (dropdown, `"euler" | "rk4" | "adams"`). The engineer opens the Parameter Controller panel, adjusts the slider, and the backend receives the update immediately over the WebSocket without any page reload.

**What this solves:**

- Runtime parameter tuning without restarting the simulation
- No custom widget needed for the most common control patterns
- Parameters are sent as a single JSON payload so the backend can apply them atomically

**What this does not solve (out of scope for now):**

- Persisting parameter values across page reloads (out of scope — see JSON layout persistence)
- Reading current parameter values back from the backend (unidirectional for now)
- Validation beyond min/max/required (no cross-field validation)
- File or array parameter types

---

## 2. Scope

**In scope:**

- `ParameterControllerComponent` — React component rendering sliders, number inputs, and dropdowns from a declarative `parameters` config prop
- `PARAMETER_CONTROLLER` widget definition in `defaultWidgets.ts`
- Publishes to a configurable EventBus channel on every value change
- Debounced publish for slider controls (300 ms) to avoid flooding the backend
- `ParameterController.css` for styles consistent with `LogViewer.css`
- Full unit tests

**Out of scope:**

- Reading current values from the backend
- Persisting values to localStorage
- Cross-field validation
- File, color, or date picker control types

---

## 3. Control Types

Each parameter in the config produces one control:

| Control type | When to use                        | Props                           |
| ------------ | ---------------------------------- | ------------------------------- |
| `slider`     | Continuous numeric range           | `min`, `max`, `step`, `default` |
| `number`     | Precise numeric entry              | `min`, `max`, `step`, `default` |
| `select`     | Fixed set of string/number options | `options: string[]`, `default`  |

---

## 4. Data Model

### 4.1 Parameter config schema

Each entry in the `parameters` prop describes one control:

```typescript
export type ParameterType = "string" | "number";
export type ParameterWidget = "slider" | "input" | "select";

export interface ParameterConfig {
  /** Display label shown above the control. */
  title: string;
  /** Control type. */
  type: ParameterType;
  /** Default value applied on mount. */
  default: number | string;
  /** Minimum value — required for slider and number. */
  minimum?: number;
  /** Maximum value — required for slider and number. */
  maximum?: number;
  /** Step increment — optional for slider and number. */
  multipleOf?: number;
  /** Options list — required for select. */
  enum?: string[];
  /** Parameter widget options */
  x-options?: {
    /** Widget to use */
    widget?: ParameterWidget;
  }
}
```

### 4.2 Props interface

```typescript
export interface ParameterControllerProps {
  /**
   * EventBus channel to publish parameter updates to.
   * Default: "params/control"
   */
  channel?: string;
  /**
   * Parameter definitions keyed by parameter name.
   * The key is used as the field name in the published payload.
   * Example: { timestep: { label: "Time Step", type: "slider", min: 0.001, max: 1, default: 0.01 } }
   */
  parameters?: Record<string, ParameterConfig>;
  /**
   * Debounce delay in milliseconds for slider controls.
   * Default: 300
   */
  debounceMs?: number;
}
```

### 4.3 Published payload

Every time any control value changes, the component publishes the full current parameter state as a single JSON object to the configured channel:

```json
{
  "timestep": 0.05,
  "max_iterations": 500,
  "solver": "rk4"
}
```

Content type: `application/x-params+json`

Publishing the full state (not just the changed key) lets the backend apply all values atomically and avoids partial-update race conditions.

---

## 5. Component Behaviour

### 5.1 Mount

On mount, the component initialises local state from each parameter's `default` value. It does NOT publish on mount — the backend is assumed to already have sensible defaults.

### 5.2 Value change

When the user changes a control:

- **select / number** — publishes immediately
- **slider** — debounces by `debounceMs` (default 300 ms), then publishes

### 5.3 Empty parameters

When `parameters` is `undefined` or `{}`, renders a placeholder: `"No parameters configured"` with `data-testid="parameter-controller-empty"`.

### 5.4 Publish lifecycle

Uses the existing `usePublish` hook to send to the EventBus. If the EventBus is disconnected, the publish is a no-op (same behaviour as the rest of the framework).

---

## 6. Widget Definition

```typescript
export const PARAMETER_CONTROLLER: WidgetDefinition = {
  name: "ParameterController",
  description:
    "Interactive control panel for tuning simulation parameters at runtime. " +
    "Publishes parameter updates to a configurable EventBus channel as " +
    "application/x-params+json payloads.",
  channelPattern: "params/*",
  consumes: [],
  priority: 10,
  defaultRegion: "sidebar-left",
  parameters: {
    channel: { type: "string", default: "params/control" },
    debounceMs: { type: "integer", default: 300, minimum: 0, maximum: 2000 },
  },
  factory: () => ParameterControllerComponent,
};
```

Note: the `parameters` field on the widget definition describes the widget's own configuration props (channel, debounce). The simulation parameter definitions (`timestep`, `solver`, etc.) are passed via the `parameters` prop on the component itself at layout configuration time.

---

## 7. Example Usage (Frontend)

```tsx
import { PARAMETER_CONTROLLER } from "@app-framework/core-ui";

registry.register(PARAMETER_CONTROLLER);

const layout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    "sidebar-left": {
      visible: true,
      items: [
        {
          id: "sim-params",
          type: "ParameterController",
          props: {
            channel: "params/control",
            parameters: {
              timestep: {
                label: "Time Step",
                type: "slider",
                min: 0.001,
                max: 1.0,
                step: 0.001,
                default: 0.01,
              },
              max_iterations: {
                label: "Max Iterations",
                type: "number",
                min: 1,
                max: 10000,
                step: 1,
                default: 1000,
              },
              solver: {
                label: "Solver",
                type: "select",
                options: ["euler", "rk4", "adams"],
                default: "rk4",
              },
            },
          },
          order: 0,
        },
      ],
    },
  },
};
```

---

## 8. Backend Contract (Example)

The backend subscribes to the same channel and applies incoming values:

```python
# examples/backend/consumers.py
async def on_params(payload: dict):
    simulation.timestep = payload.get("timestep", simulation.timestep)
    simulation.max_iterations = payload.get("max_iterations", simulation.max_iterations)
    simulation.solver = payload.get("solver", simulation.solver)
```

The backend example will be updated to subscribe to `"params/control"` and forward values to the running simulation subprocess.

---

## 9. File Structure

```
packages/framework-core-ui/src/
  ParameterController.tsx       # Component + props interface + ParameterConfig type
  ParameterController.css       # Styles (sct-ParameterController- prefix)
  ParameterController.test.tsx  # Unit tests
  defaultWidgets.ts             # Add PARAMETER_CONTROLLER export
  index.ts                      # Export PARAMETER_CONTROLLER + ParameterControllerProps
```

---

## 10. Implementation Checklist

```
- [ ] Task 1: ParameterConfig type + ParameterControllerProps interface
      - [ ] Define ParameterType union: "slider" | "number" | "select"
      - [ ] Define ParameterConfig interface
      - [ ] Define ParameterControllerProps interface

- [ ] Task 2: ParameterControllerComponent
      - [ ] Initialise state from default values on mount
      - [ ] Render slider control with label + current value display
      - [ ] Render number input control with label
      - [ ] Render select/dropdown control with label
      - [ ] Debounce slider publish by debounceMs
      - [ ] Publish full state on every change via usePublish
      - [ ] Render empty placeholder when no parameters configured
      - [ ] data-testid attributes on all controls and container

- [ ] Task 3: ParameterController.css
      - [ ] sct-ParameterController-container
      - [ ] sct-ParameterController-empty
      - [ ] sct-ParameterController-row
      - [ ] sct-ParameterController-label
      - [ ] sct-ParameterController-control
      - [ ] sct-ParameterController-value (slider current value display)

- [ ] Task 4: PARAMETER_CONTROLLER widget definition
      - [ ] Add to defaultWidgets.ts
      - [ ] Export from index.ts

- [ ] Task 5: Backend example update
      - [ ] Subscribe to "params/control" in consumers.py
      - [ ] Apply received values to the running simulation

- [ ] Task 6: Tests
      - [ ] renders empty placeholder when parameters is undefined
      - [ ] renders empty placeholder when parameters is {}
      - [ ] renders slider for type "slider"
      - [ ] renders number input for type "number"
      - [ ] renders select for type "select"
      - [ ] initialises values from defaults on mount
      - [ ] does NOT publish on mount
      - [ ] publishes full state immediately on select change
      - [ ] publishes full state immediately on number input change
      - [ ] debounces publish on slider change
      - [ ] published payload contains all current parameter values

- [ ] Task 7: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```
