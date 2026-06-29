import { Button } from "./ui/button";
import "./ParamDiffViewer.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Props for {@link ParamDiffViewer}.
 */
export interface ParamDiffViewerProps {
  /** The simulation's current parameter values, keyed by field name. */
  current: Record<string, unknown>;
  /** AI-suggested parameter values. Only changed fields need to be present. */
  suggested: Record<string, unknown>;
  /** Short human-readable summary from the AI explaining the suggestion. */
  explanation: string;
  /** Called when the user clicks Approve. */
  onApprove: () => void;
  /** Called when the user clicks Reject. */
  onReject: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders a value for display, falling back to JSON for non-primitives. */
function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

// ─── ParamDiffViewer ──────────────────────────────────────────────────────────

/**
 * A simple before/after list diff of suggested parameter changes.
 *
 * Renders the AI's explanation above a list of `field: current → suggested`
 * rows for every key present in `suggested`, followed by Approve/Reject
 * buttons. Unlike {@link LayoutDiffViewer}, this has no wireframe — parameter
 * values are flat scalars, so a list is sufficient.
 *
 * @param props - {@link ParamDiffViewerProps}
 * @returns The diff viewer element.
 * @example
 * ```tsx
 * <ParamDiffViewer
 *   current={{ gain: 42, window_ms: 200 }}
 *   suggested={{ gain: 18 }}
 *   explanation="Reduced gain to keep the value within range."
 *   onApprove={() => publish(suggested)}
 *   onReject={() => setProposed(null)}
 * />
 * ```
 */
export function ParamDiffViewer({
  current,
  suggested,
  explanation,
  onApprove,
  onReject,
}: ParamDiffViewerProps): React.ReactElement {
  const fields = Object.keys(suggested);

  return (
    <div className="sct-ParamDiffViewer">
      <p className="sct-ParamDiffViewer-explanation">{explanation}</p>

      <table className="sct-ParamDiffViewer-table">
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Current</th>
            <th scope="col">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <td className="sct-ParamDiffViewer-field">{field}</td>
              <td className="sct-ParamDiffViewer-current">
                {formatValue(current[field])}
              </td>
              <td className="sct-ParamDiffViewer-suggested">
                {formatValue(suggested[field])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sct-ParamDiffViewer-actions">
        <Button
          className="sct-ParamDiffViewer-reject-btn"
          variant="outline"
          size="default"
          onClick={onReject}
        >
          Reject
        </Button>
        <Button
          className="sct-ParamDiffViewer-approve-btn"
          size="default"
          onClick={onApprove}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
