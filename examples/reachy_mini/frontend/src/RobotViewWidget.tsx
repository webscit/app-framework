import { useChannel } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { ReachyFrame } from "./useReachy";

/**
 * Widget body: shows the latest robot frame streamed on ``reachy/frame``,
 * or a placeholder until the first frame of a run arrives.
 *
 * @returns The robot image, or a "press Start" placeholder.
 */
function RobotViewComponent(): React.ReactElement {
  const frame = useChannel<ReachyFrame>("reachy/frame");

  return (
    <div
      style={{
        // Size to the image (not 100%) so sibling widgets in the same region
        // — e.g. the parameter sliders — remain visible below it.
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 12,
          color: "var(--muted-foreground)",
        }}
      >
        Robot (MuJoCo studio camera)
      </span>
      {frame ? (
        <img
          src={frame.image}
          alt="Live render of the Reachy Mini robot"
          style={{
            width: "100%",
            borderRadius: 6,
            background: "#000",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            borderRadius: 6,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
            fontFamily: "monospace",
            fontSize: 13,
            textAlign: "center",
            padding: 16,
          }}
        >
          Press Start to run a choreography — the robot will appear here.
        </div>
      )}
    </div>
  );
}

/**
 * Example widget definition for the live robot render. Registered into the
 * shell's {@link WidgetRegistry} so the robot view is a first-class,
 * AI-rearrangeable widget rather than fixed app chrome.
 */
export const ROBOT_VIEW: WidgetDefinition = {
  name: "RobotView",
  description:
    "Live MuJoCo render of the Reachy Mini robot, updated after each executed " +
    "choreography step.",
  channelPattern: "reachy/frame",
  consumes: [],
  priority: 10,
  defaultRegion: "sidebar-left",
  parameters: {},
  factory: () => RobotViewComponent,
};
