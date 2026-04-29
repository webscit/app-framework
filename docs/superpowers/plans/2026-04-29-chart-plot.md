# Chart / Plot Widget — Implementation Plan

**Goal:** Provide a built-in widget that visualises live time-series and convergence data streamed from the backend over the EventBus. Covers the two most common simulation output patterns — a scrolling time-series line chart and a convergence curve — without requiring any custom widget.

**Architecture:** Follows the same pattern as `LogViewer` and `ParameterController`. The widget is a `WidgetDefinition` in `defaultWidgets.ts` whose `factory` returns `ChartComponent`. The component subscribes to a configurable EventBus channel, appends incoming scalar values to a rolling buffer, and re-renders the chart on every update.

**Tech Stack:** TypeScript — React, shadcn `Chart` component (`ChartContainer`, `ChartTooltipContent`) wrapping Recharts. CSS class names prefixed with `sct-Chart-`. Added via:

```bash
npx shadcn@latest add chart
```

This generates `src/components/ui/chart.tsx` — consistent with how `input.tsx`, `slider.tsx`, and `select.tsx` were added. Recharts is the underlying library but is never imported directly in `Chart.tsx`; only shadcn wrappers are used.

**Library choice rationale:** shadcn's Chart component handles CSS variable theming (`var(--chart-1)` etc.), responsive sizing via `ChartContainer`, and tooltip styling out of the box — no manual wiring needed. Recharts SVG rendering is performant for rolling windows of ≤ 500 points which covers all common simulation streaming rates (10 Hz backend = 200 points in 20 s at default `maxPoints`).

---

## 1. Problem Statement

Simulation engineers need to see output data as it arrives — not after the run finishes. Today there is no built-in way to visualise a live stream from the backend. Engineers either build their own chart component every time or poll a REST endpoint. Both approaches require custom code and do not integrate with the EventBus.

The Chart widget solves this by providing a ready-made time-series viewer that subscribes to any EventBus channel and plots incoming scalar values in real time.

**Best example:** The existing `start_sine_wave_producer` in the backend publishes `{ value: float }` to `data/sine` every 100 ms. The Chart widget subscribes to `data/sine`, extracts the `value` field, and renders a scrolling line chart. When the engineer adjusts `frequency` or `amplitude` via the `ParameterController`, the chart immediately reflects the change — completing the full round-trip:

```
ParameterController → params/control → backend producer
backend producer    → data/sine      → Chart widget
```

**What this solves:**

- Live visualisation of any scalar EventBus stream without custom code
- Scrolling window keeps memory bounded — old points are dropped automatically
- Multiple series on one chart by subscribing to multiple channels
- Works with any backend event that carries a numeric field

**What this does not solve (out of scope):**

- Non-scalar data (2D arrays, images, meshes)
- Pan/zoom interaction (out of scope for v1)
- Exporting chart data to CSV
- Bar, pie, or scatter chart types (line only for v1)

---

## 2. Scope

**In scope:**

- `ChartComponent` — React component rendering a live scrolling line chart from one or more EventBus channels
- `CHART` widget definition in `defaultWidgets.ts`
- Rolling buffer with configurable `maxPoints` (default 200)
- Multiple series support — each series maps a channel + field path to a line
- Configurable Y-axis domain (auto or fixed)
- Chart title prop
- `Chart.css` for layout styles consistent with `LogViewer.css`
- Full unit tests

**Out of scope for v1:**

- Pan/zoom
- Bar, pie, scatter chart types
- CSV export
- Annotations / threshold lines
- Legend toggle (show/hide individual series)

---

## 3. Chart Types

v1 ships one chart type: **line chart** (time-series).

| Use case              | X axis        | Y axis        | Example channel  |
| --------------------- | ------------- | ------------- | ---------------- |
| Time-series streaming | Elapsed time  | Scalar float  | `data/sine`      |
| Convergence curve     | Iteration     | Residual norm | `data/residual`  |
| Any scalar stream     | Elapsed time  | Scalar float  | `data/*`         |

The X axis is always elapsed time in seconds since the first received point. This avoids requiring the backend to include a timestamp in every event.

---

## 4. Data Model

### 4.1 Series config

Each series describes one line on the chart:

```typescript
export interface SeriesConfig {
  /** EventBus channel to subscribe to. */
  channel: string;
  /**
   * Dot-separated path to the numeric field inside the event payload.
   * Example: "value", "data.residual", "metrics.loss"
   * Default: "value"
   */
  field?: string;
  /** Display label shown in the chart legend. Default: channel name. */
  label?: string;
  /**
   * Line colour. Any valid CSS colour string.
   * Default: auto from shadcn chart palette (var(--chart-1), var(--chart-2), …)
   */
  color?: string;
}
```

### 4.2 Props interface

```typescript
export interface ChartProps {
  /**
   * One or more series to plot.
   * Each series subscribes to its own EventBus channel.
   */
  series: SeriesConfig[];
  /**
   * Chart title shown above the plot area.
   */
  title?: string;
  /**
   * Maximum number of data points to keep per series.
   * Older points are dropped when the buffer exceeds this limit.
   * Default: 200
   */
  maxPoints?: number;
  /**
   * Y-axis domain.
   * - "auto" (default): Recharts auto-fits to the data range.
   * - [min, max]: Fixed domain, e.g. [-1, 1] for a normalised signal.
   */
  yDomain?: "auto" | [number, number];
  /**
   * Y-axis label shown to the left of the axis.
   */
  yLabel?: string;
}
```

### 4.3 Internal data point

Each received event produces one merged data point containing all series values at that timestamp:

```typescript
interface DataPoint {
  /** Elapsed seconds from the first received point across all series. */
  t: number;
  /** One key per series label, e.g. { "sin(t)": 0.84 } */
  [seriesLabel: string]: number;
}
```

Storing all series in a single flat object per time step lets Recharts render multiple `<Line>` components from a single `data` array.

### 4.4 Field path extraction

The `field` prop supports dot-notation for nested payloads:

```typescript
// field = "data.residual"
// payload = { data: { residual: 0.003 } }
// extracted = 0.003
```

Non-numeric or missing fields are silently dropped — no point added, no error thrown.

---

## 5. Component Behaviour

### 5.1 Mount

On mount the component initialises an empty `DataPoint[]` buffer and subscribes to each series channel via `useChannel`. Records `startTime = null` — set to `Date.now()` on first received point.

### 5.2 Incoming event

On each event:
1. Extract the numeric value at `field` path from the payload.
2. If the value is not a finite number, drop silently.
3. If `startTime` is null, set `startTime = Date.now()`.
4. Compute `t = (Date.now() - startTime) / 1000` (elapsed seconds).
5. Append or merge `{ t, [seriesLabel]: value }` into the buffer.
6. If `buffer.length > maxPoints`, drop the oldest point.
7. Trigger a re-render.

### 5.3 Empty state

When the buffer is empty, renders a placeholder:

```
Waiting for data on <channel>…
```

### 5.4 Chart rendering

Uses shadcn's `ChartContainer` wrapping Recharts `LineChart`:

```tsx
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

<ChartContainer config={chartConfig} className="sct-Chart-plot">
  <LineChart data={buffer}>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="t" tickFormatter={(v) => `${v.toFixed(1)}s`} />
    <YAxis domain={yDomain === "auto" ? ["auto", "auto"] : yDomain} label={yLabel} />
    <Tooltip content={<ChartTooltipContent />} />
    {series.map((s, i) => (
      <Line
        key={s.channel}
        type="monotone"
        dataKey={s.label ?? s.channel}
        stroke={s.color ?? `var(--chart-${i + 1})`}
        dot={false}
        isAnimationActive={false}
      />
    ))}
  </LineChart>
</ChartContainer>
```

`isAnimationActive={false}` is required for live streaming — Recharts animation conflicts with rapid updates.

### 5.5 Unsubscribe on unmount

The component unsubscribes from all channels on unmount to prevent memory leaks.

---

## 6. shadcn Chart Config

The `chartConfig` object maps each series label to its display name and colour token:

```typescript
const chartConfig = Object.fromEntries(
  series.map((s, i) => [
    s.label ?? s.channel,
    {
      label: s.label ?? s.channel,
      color: s.color ?? `var(--chart-${i + 1})`,
    },
  ])
);
```

---

## 7. Widget Definition

```typescript
export const CHART: WidgetDefinition = {
  name: "Chart",
  description:
    "Live time-series line chart. Subscribes to one or more EventBus channels " +
    "and plots incoming scalar values in a scrolling window.",
  channelPattern: "data/*",
  consumes: ["application/x-scalar+json"],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    title: { type: "string", default: "" },
    maxPoints: { type: "integer", default: 200, minimum: 10, maximum: 2000 },
  },
  factory: () => ChartComponent,
};
```

---

## 8. Example Usage (Frontend)

```tsx
import { CHART } from "@app-framework/core-ui";

registry.register(CHART);

const layout: ShellLayout = {
  regions: {
    ...createDefaultShellLayout().regions,
    main: {
      visible: true,
      items: [
        {
          id: "sine-chart",
          type: "Chart",
          props: {
            title: "Sine Wave",
            maxPoints: 300,
            yDomain: [-1.1, 1.1],
            yLabel: "Amplitude",
            series: [
              {
                channel: "data/sine",
                field: "value",
                label: "sin(t)",
                color: "var(--chart-1)",
              },
            ],
          },
          order: 0,
        },
      ],
    },
  },
};
```

---

## 9. Backend Contract (Example)

The existing `start_sine_wave_producer` already publishes the correct shape — no backend changes required for the basic demo:

```python
class SineReading(BaseEvent):
    value: float

async def start_sine_wave_producer(bus: EventBus) -> None:
    t = 0.0
    while True:
        await bus.publish("data/sine", SineReading(value=math.sin(t)))
        t += 0.1
        await asyncio.sleep(0.1)
```

The `ParameterController` integration (making `frequency` and `amplitude` tunable) will be added as part of the backend example update described in the parameter controller plan.

---

## 10. File Structure

```
packages/framework-core-ui/src/
  Chart.tsx                      # Component + props interface + SeriesConfig type
  Chart.css                      # Layout styles (sct-Chart- prefix)
  Chart.test.tsx                 # Unit tests
  components/ui/chart.tsx        # Generated by: npx shadcn@latest add chart
  defaultWidgets.ts              # Add CHART export
  index.ts                       # Export CHART + ChartProps + SeriesConfig
```

---

## 11. Dependencies

Add the shadcn chart component to `framework-core-ui` (this also adds `recharts` to `package.json`):

```bash
cd packages/framework-core-ui
npx shadcn@latest add chart
```

No other new dependencies are required. The shadcn chart component uses Recharts v3 internally — `var(--chart-N)` tokens (not `hsl(var(--chart-N))`) must be used when referencing colour tokens.

---

## 12. Implementation Checklist

```
- [ ] Task 0: Add shadcn chart component
      - [ ] Run: npx shadcn@latest add chart in packages/framework-core-ui
      - [ ] Verify src/components/ui/chart.tsx generated correctly
      - [ ] Verify recharts added to package.json

- [ ] Task 1: Types
      - [ ] SeriesConfig interface
      - [ ] ChartProps interface
      - [ ] DataPoint internal type
      - [ ] getFieldValue(payload, field) utility — dot-notation extractor

- [ ] Task 2: ChartComponent
      - [ ] Subscribe to each series channel via useChannel on mount
      - [ ] Record startTime on first received point
      - [ ] Append DataPoint on each event, drop non-finite values silently
      - [ ] Enforce maxPoints rolling buffer
      - [ ] Build chartConfig from series prop for shadcn ChartContainer
      - [ ] Render ChartContainer > LineChart with CartesianGrid, XAxis, YAxis, Tooltip
      - [ ] X axis: elapsed seconds formatted as "Ns"
      - [ ] Y axis: auto or fixed domain from yDomain prop
      - [ ] Y axis label from yLabel prop
      - [ ] Chart title from title prop
      - [ ] Set isAnimationActive={false} on all Lines (required for live streaming)
      - [ ] Series colours via var(--chart-N) or explicit color prop
      - [ ] Empty state placeholder when buffer is empty
      - [ ] Unsubscribe from all channels on unmount

- [ ] Task 3: Chart.css
      - [ ] sct-Chart-container
      - [ ] sct-Chart-title
      - [ ] sct-Chart-empty
      - [ ] sct-Chart-plot (ChartContainer wrapper — must have min-h set)

- [ ] Task 4: CHART widget definition
      - [ ] Add to defaultWidgets.ts
      - [ ] Export from index.ts

- [ ] Task 5: Backend example update
      - [ ] Extend start_sine_wave_producer to accept frequency + amplitude from params/control
      - [ ] Add consumer in consumers.py to receive params/control and update producer state

- [ ] Task 6: Tests
      - [ ] renders empty placeholder when no data received
      - [ ] appends a data point when a matching channel event arrives
      - [ ] drops non-numeric field values silently
      - [ ] enforces maxPoints rolling buffer (oldest point dropped)
      - [ ] renders one Line per series config entry
      - [ ] supports dot-notation field path extraction
      - [ ] unsubscribes from channel on unmount

- [ ] Task 7: Quality gate
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test
      - [ ] npm run format:check
```