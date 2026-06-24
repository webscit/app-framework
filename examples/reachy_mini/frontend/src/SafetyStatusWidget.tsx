import { useChannel } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { ReachySafety } from "./useReachy";

/** Visual treatment for each safety status. */
interface Appearance {
  /** Heading shown on the card. */
  title: string;
  /** Accent / border colour. */
  color: string;
  /** Tinted card background. */
  background: string;
}

const APPEARANCE: Record<ReachySafety["status"], Appearance> = {
  ok: {
    title: "All steps within safe limits",
    color: "#10b981",
    background: "#ecfdf5",
  },
  warning: {
    title: "Approaching safety limits",
    color: "#f59e0b",
    background: "#fffbeb",
  },
  violation: {
    title: "SAFETY VIOLATION",
    color: "#ef4444",
    background: "#fef2f2",
  },
};

/**
 * Joins offending axis names into a readable sentence, e.g.
 * `"roll, z"` → `"roll and z"`.
 */
function axisSummary(axes: string[]): string {
  if (axes.length === 0) return "";
  if (axes.length === 1) return axes[0];
  return `${axes.slice(0, -1).join(", ")} and ${axes[axes.length - 1]}`;
}

/**
 * Widget body: a prominent card that reflects the latest per-step safety
 * assessment streamed on ``reachy/safety``.
 *
 * The status is taken straight from the backend's ``status`` field rather than
 * recomputed in the browser — the safety criteria live in one place (the
 * backend), and the widget simply listens to the event and reacts. The card
 * turns green / amber / red so a failing run is obvious at a glance, beyond the
 * inline status text in the header.
 *
 * @returns The safety status card, or an idle placeholder before the first run.
 */
function SafetyStatusComponent(): React.ReactElement {
  const safety = useChannel<ReachySafety>("reachy/safety");

  if (!safety) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--muted)",
          color: "var(--muted-foreground)",
          fontFamily: "var(--font-sans, sans-serif)",
          fontSize: 13,
        }}
      >
        Safety status — start a run to begin checking each step against the limits.
      </div>
    );
  }

  const look = APPEARANCE[safety.status];
  const offending =
    safety.status === "violation"
      ? safety.violated_axes
      : safety.status === "warning"
        ? safety.warning_axes
        : [];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${look.color}`,
        borderLeft: `6px solid ${look.color}`,
        background: look.background,
        color: "#1e1e1e",
        fontFamily: "var(--font-sans, sans-serif)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <strong style={{ color: look.color, fontSize: 15 }}>{look.title}</strong>
      <span style={{ fontSize: 13 }}>
        Loop {safety.loop}, step {safety.step}
        {offending.length > 0 ? ` — ${axisSummary(offending)}` : ""}
      </span>
    </div>
  );
}

/**
 * Example widget definition for the prominent safety-status card. Registered
 * into the shell's {@link WidgetRegistry} so it is a first-class,
 * AI-rearrangeable widget like every other panel.
 */
export const SAFETY_STATUS: WidgetDefinition = {
  name: "SafetyStatus",
  description:
    "Prominent card reflecting the latest per-step safety assessment from " +
    "reachy/safety — turns green/amber/red so a failing run is obvious.",
  channelPattern: "reachy/safety",
  consumes: [],
  priority: 10,
  defaultRegion: "main",
  parameters: {},
  factory: () => SafetyStatusComponent,
};
