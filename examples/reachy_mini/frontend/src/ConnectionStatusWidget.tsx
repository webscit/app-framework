import { useEventBusStatus } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";

const APPEARANCE: Record<string, { label: string; color: string }> = {
  connected: { label: "Connected", color: "#34d399" },
  connecting: { label: "Connecting…", color: "#fbbf24" },
  disconnected: { label: "Disconnected", color: "#f87171" },
};

/**
 * Widget body: a compact live connection indicator for the shell status bar.
 *
 * Reads the shared EventBus websocket state via {@link useEventBusStatus} and
 * shows a coloured dot plus a label so users can see at a glance whether the
 * live data feed is healthy. The label is text (not colour-only) for
 * accessibility, and the dot pulses while connecting.
 *
 * @returns The connection-status indicator.
 */
function ConnectionStatusComponent(): React.ReactElement {
  const status = useEventBusStatus();
  const look = APPEARANCE[status] ?? APPEARANCE.disconnected;

  return (
    <span
      role="status"
      aria-live="polite"
      className="reachy-conn"
      // Connection colour is data-driven; expose it as a CSS variable.
      style={{ "--conn-color": look.color } as React.CSSProperties}
    >
      <span aria-hidden className="reachy-conn-dot" />
      Event bus: {look.label}
    </span>
  );
}

/**
 * Example widget definition for the live connection indicator. Registered into
 * the shell's {@link WidgetRegistry} and placed in the status-bar region.
 */
export const CONNECTION_STATUS: WidgetDefinition = {
  name: "ConnectionStatus",
  description:
    "Live EventBus connection indicator (connected/connecting/disconnected) " +
    "for the status bar.",
  channelPattern: "",
  consumes: [],
  priority: 10,
  defaultRegion: "status-bar",
  parameters: {},
  factory: () => ConnectionStatusComponent,
};
