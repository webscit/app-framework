import * as React from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartContainer, ChartTooltipContent } from "./components/ui/chart";
import type { ChartConfig } from "./components/ui/chart";
import { useChannel } from "./useChannel";
import "./Chart.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface ChartProps {
  series: SeriesConfig[];
  title?: string;
  maxPoints?: number;
  yDomain?: "auto" | [number, number];
  /** Y-axis label. Configurable by the user via widget parameters. */
  yLabel?: string;
  /** X-axis label. Configurable by the user via widget parameters. */
  xLabel?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface DataPoint {
  t: number;
  [seriesLabel: string]: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract a value from a nested object using dot-notation.
 * Returns undefined if the path is missing or the value is not a finite number.
 */
export function getFieldValue(payload: unknown, field = "value"): number | undefined {
  const parts = field.split(".");
  let cursor: unknown = payload;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (typeof cursor === "number" && isFinite(cursor)) return cursor;
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-series subscriber
//
// useChannel<T>(channel): T | null — returns the latest payload or null.
// We watch for changes with useEffect and forward new numeric points upward.
// One component per series keeps hook calls at the top level (rules of hooks).
// ---------------------------------------------------------------------------

interface SeriesSubscriberProps {
  config: SeriesConfig;
  startTimeRef: React.MutableRefObject<number | null>;
  onPoint: (label: string, t: number, value: number) => void;
}

function SeriesSubscriber({ config, startTimeRef, onPoint }: SeriesSubscriberProps) {
  const seriesLabel = config.label ?? config.channel;
  const latest = useChannel<Record<string, unknown>>(config.channel);

  React.useEffect(() => {
    if (latest === null) return;

    const value = getFieldValue(latest, config.field);
    if (value === undefined) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }
    const t = (Date.now() - startTimeRef.current) / 1000;
    onPoint(seriesLabel, t, value);
  }, [latest]); // latest is the only value that drives new data points

  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChartComponent({
  series,
  title,
  maxPoints = 200,
  yDomain = "auto",
  yLabel,
  xLabel = "Elapsed time (s)",
}: ChartProps) {
  const [buffer, setBuffer] = React.useState<DataPoint[]>([]);
  const startTimeRef = React.useRef<number | null>(null);

  const handlePoint = React.useCallback(
    (label: string, t: number, value: number) => {
      setBuffer((prev) => {
        const next = [...prev, { t, [label]: value }];
        return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
      });
    },
    [maxPoints],
  );

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.label ?? s.channel,
      {
        label: s.label ?? s.channel,
        color: s.color ?? `var(--chart-${i + 1})`,
      },
    ]),
  );

  const resolvedYDomain: [number | string, number | string] =
    yDomain === "auto" ? ["auto", "auto"] : yDomain;

  const primaryChannel = series[0]?.channel ?? "channel";
  const bottomMargin = xLabel ? 28 : 8;
  const leftMargin = yLabel ? 28 : 8;

  return (
    <div className="sct-Chart-container">
      {series.map((s) => (
        <SeriesSubscriber
          key={s.channel}
          config={s}
          startTimeRef={startTimeRef}
          onPoint={handlePoint}
        />
      ))}

      {title && <div className="sct-Chart-title">{title}</div>}

      {buffer.length === 0 ? (
        <div className="sct-Chart-empty">Waiting for data on {primaryChannel}…</div>
      ) : (
        <ChartContainer config={chartConfig} className="sct-Chart-plot">
          <LineChart
            data={buffer}
            margin={{ top: 4, right: 16, bottom: bottomMargin, left: leftMargin }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(v: number) => `${v.toFixed(1)}s`}
              label={
                xLabel
                  ? { value: xLabel, position: "insideBottom", offset: -10 }
                  : undefined
              }
            />
            <YAxis
              domain={resolvedYDomain}
              label={
                yLabel
                  ? { value: yLabel, angle: -90, position: "insideLeft", offset: 10 }
                  : undefined
              }
            />
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
      )}
    </div>
  );
}
