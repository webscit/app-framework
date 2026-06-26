import { useChannel } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import type { ReachyFrame, ReachyState } from "./useReachy";

/**
 * Widget body: shows the latest robot frame streamed on ``reachy/frame``,
 * or a placeholder until the first frame of a run arrives. Shows a pulsing
 * "LIVE" badge while a run is actively streaming frames.
 *
 * @returns The robot image, or a "press Start" placeholder.
 */
function RobotViewComponent(): React.ReactElement {
  const frame = useChannel<ReachyFrame>("reachy/frame");
  const state = useChannel<ReachyState>("reachy/state");
  const live = state?.phase === "running";

  return (
    <div className="reachy-robotview">
      <span className="reachy-robotview-header">
        Robot (MuJoCo studio camera)
        {live && (
          <span className="reachy-live-badge">
            <span aria-hidden className="reachy-live-badge-dot" />
            LIVE
          </span>
        )}
      </span>
      {frame ? (
        <img
          src={frame.image}
          alt="Live render of the Reachy Mini robot"
          className="reachy-robotview-img"
        />
      ) : (
        <div className="reachy-robotview-placeholder">
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
