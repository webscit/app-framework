import { useChannel } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { DroneStability } from "./useDrone";

/** Visual treatment for each stability status. */
interface Appearance {
  /** Heading shown on the card. */
  title: string;
  /** Accent / border colour. */
  color: string;
  /** Tinted card background. */
  background: string;
}

const APPEARANCE: Record<DroneStability["status"], Appearance> = {
  ok: {
    title: "Manoeuvre within stability limits",
    color: "#10b981",
    background: "#ecfdf5",
  },
  warning: {
    title: "Approaching stability limits",
    color: "#f59e0b",
    background: "#fffbeb",
  },
  violation: {
    title: "STABILITY VIOLATION",
    color: "#ef4444",
    background: "#fef2f2",
  },
};

/**
 * Joins offending metric names into a readable sentence, e.g.
 * `["tilt", "settling"]` → `"tilt and settling"`.
 */
function metricSummary(metrics: string[]): string {
  if (metrics.length === 0) return "";
  if (metrics.length === 1) return metrics[0];
  return `${metrics.slice(0, -1).join(", ")} and ${metrics[metrics.length - 1]}`;
}

/**
 * Widget body: a prominent card reflecting the latest per-segment stability
 * assessment streamed on ``drone/stability``.
 *
 * The status is taken straight from the backend's ``status`` field rather than
 * recomputed in the browser — the limits live in one place (the backend), and
 * the widget simply reacts. The card turns green / amber / red so a failing
 * manoeuvre is obvious at a glance.
 *
 * @returns The stability status card, or an idle placeholder before the first
 *   segment is assessed.
 */
function StabilityStatusComponent(): React.ReactElement {
  const stability = useChannel<DroneStability>("drone/stability");

  if (!stability) {
    return (
      <div className="drone-safety-idle">
        Stability status — start a run to assess each manoeuvre segment against the
        limits.
      </div>
    );
  }

  const look = APPEARANCE[stability.status];
  const offending =
    stability.status === "violation"
      ? stability.violated
      : stability.status === "warning"
        ? stability.warnings
        : [];

  return (
    <div
      role="status"
      aria-live="polite"
      className="drone-safety-card"
      // Data-driven accent/background come from the backend status; pass them as
      // CSS custom properties so the rule itself lives in shell.css.
      style={
        {
          "--safety-accent": look.color,
          "--safety-bg": look.background,
        } as React.CSSProperties
      }
    >
      <strong className="drone-safety-card-title">{look.title}</strong>
      <span className="drone-safety-card-detail">
        Segment {stability.segment} — peak tilt {stability.peak_tilt_deg.toFixed(1)}°
        {offending.length > 0 ? ` · ${metricSummary(offending)}` : ""}
      </span>
    </div>
  );
}

/**
 * Example widget definition for the prominent stability-status card. Registered
 * into the shell's {@link WidgetRegistry} so it is a first-class,
 * AI-rearrangeable widget like every other panel.
 */
export const STABILITY_STATUS: WidgetDefinition = {
  name: "StabilityStatus",
  description:
    "Prominent card reflecting the latest per-segment stability assessment " +
    "from drone/stability — turns green/amber/red so a failing run is obvious.",
  channelPattern: "drone/stability",
  consumes: [],
  priority: 10,
  defaultRegion: "main",
  parameters: {},
  factory: () => StabilityStatusComponent,
};
