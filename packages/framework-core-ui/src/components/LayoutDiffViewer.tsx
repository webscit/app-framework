import { useState } from "react";

import { Button } from "./ui/button";
import type { RegionId, ShellLayout } from "../shellTypes";
import "./LayoutDiffViewer.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Props for {@link LayoutDiffViewer}.
 */
export interface LayoutDiffViewerProps {
  /** The current active shell layout shown on the left. */
  current: ShellLayout;
  /** The AI-proposed shell layout shown on the right. */
  proposed: ShellLayout;
  /** Short human-readable summary from the AI explaining the proposed layout. */
  explanation: string;
  /** Called when the user clicks Approve. */
  onApprove: () => void;
  /** Called when the user clicks Reject. */
  onReject: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REGION_ORDER: RegionId[] = [
  "header",
  "sidebar-left",
  "main",
  "sidebar-right",
  "bottom",
  "status-bar",
];

/** Short display labels that fit inside narrow wireframe cells. */
const REGION_SHORT_LABELS: Record<RegionId, string> = {
  header: "header",
  "sidebar-left": "left",
  main: "main",
  "sidebar-right": "right",
  bottom: "bottom",
  "status-bar": "status",
};

/**
 * Returns true if the region differs between current and proposed.
 * Compares by serialising to JSON so nested objects are compared by value.
 */
function isRegionChanged(
  layout1: ShellLayout,
  layout2: ShellLayout,
  id: RegionId,
): boolean {
  return JSON.stringify(layout1.regions[id]) !== JSON.stringify(layout2.regions[id]);
}

/** Returns a comma-separated string of widget names in the region, or empty string. */
function widgetNames(layout: ShellLayout, id: RegionId): string {
  return layout.regions[id]?.items.map((item) => item.type).join(", ") ?? "";
}

// ─── RegionCell ───────────────────────────────────────────────────────────────

interface RegionCellProps {
  /** Region identifier used as the CSS grid-area name. */
  regionId: RegionId;
  /** Widget names to display inside the cell. */
  names: string;
  /** Whether this region differs from its counterpart. */
  changed: boolean;
}

/**
 * A single region cell in the layout wireframe grid.
 *
 * @param props - {@link RegionCellProps}
 * @returns A div styled as a miniature shell region.
 */
function RegionCell({ regionId, names, changed }: RegionCellProps): React.ReactElement {
  const base = "sct-LayoutDiffViewer-cell";
  const className = changed ? `${base} ${base}--changed` : base;

  return (
    <div className={className} style={{ gridArea: regionId }}>
      <span className="sct-LayoutDiffViewer-cell-label">
        {REGION_SHORT_LABELS[regionId]}
      </span>
      {names && <span className="sct-LayoutDiffViewer-cell-widgets">{names}</span>}
    </div>
  );
}

// ─── Wireframe ────────────────────────────────────────────────────────────────

interface WireframeProps {
  /** Layout to render. */
  layout: ShellLayout;
  /** Title shown above the wireframe ("Current" or "Proposed"). */
  title: string;
  /** Set of region IDs that differ between current and proposed. */
  changedRegions: Set<RegionId>;
  /** Whether to highlight changed regions (only applies to the proposed side). */
  highlightChanged: boolean;
}

/**
 * Miniature CSS-grid wireframe of all six shell regions.
 *
 * @param props - {@link WireframeProps}
 * @returns A labelled wireframe grid.
 */
function Wireframe({
  layout,
  title,
  changedRegions,
  highlightChanged,
}: WireframeProps): React.ReactElement {
  return (
    <div className="sct-LayoutDiffViewer-wireframe">
      <p className="sct-LayoutDiffViewer-wireframe-title">{title}</p>
      <div className="sct-LayoutDiffViewer-grid">
        {REGION_ORDER.map((id) => (
          <RegionCell
            key={id}
            regionId={id}
            names={widgetNames(layout, id)}
            changed={highlightChanged && changedRegions.has(id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── LayoutDiffViewer ─────────────────────────────────────────────────────────

/**
 * Side-by-side visual wireframe diff of two shell layouts.
 *
 * Renders the AI's explanation above a pair of miniature CSS grid wireframes
 * (current on the left, proposed on the right). Changed regions in the proposed
 * wireframe are highlighted with an accent border and background. A "Show JSON"
 * toggle reveals the raw proposed layout for power users. Approve/Reject buttons
 * are provided at the bottom.
 *
 * Intentionally has no built-in heading — consumers (e.g. {@link AIChatPanel})
 * supply context through the surrounding UI.
 *
 * @param props - {@link LayoutDiffViewerProps}
 * @returns The diff viewer element.
 * @example
 * ```tsx
 * <LayoutDiffViewer
 *   current={currentLayout}
 *   proposed={proposedLayout}
 *   explanation="Added a Chart to main and a ParameterController to the left sidebar."
 *   onApprove={() => applyLayout(proposedLayout)}
 *   onReject={() => setProposed(null)}
 * />
 * ```
 */
export function LayoutDiffViewer({
  current,
  proposed,
  explanation,
  onApprove,
  onReject,
}: LayoutDiffViewerProps): React.ReactElement {
  const [showJson, setShowJson] = useState(false);

  const changedRegions = new Set<RegionId>(
    REGION_ORDER.filter((id) => isRegionChanged(current, proposed, id)),
  );

  return (
    <div className="sct-LayoutDiffViewer">
      <p className="sct-LayoutDiffViewer-explanation">{explanation}</p>

      <div className="sct-LayoutDiffViewer-side-by-side">
        <Wireframe
          layout={current}
          title="Current"
          changedRegions={changedRegions}
          highlightChanged={false}
        />
        <Wireframe
          layout={proposed}
          title="Proposed"
          changedRegions={changedRegions}
          highlightChanged={true}
        />
      </div>

      <button
        className="sct-LayoutDiffViewer-json-toggle"
        onClick={() => setShowJson((prev) => !prev)}
        aria-expanded={showJson}
      >
        {showJson ? "Hide JSON" : "Show JSON"}
      </button>

      {showJson && (
        <pre className="sct-LayoutDiffViewer-json">
          {JSON.stringify(proposed, null, 2)}
        </pre>
      )}

      <div className="sct-LayoutDiffViewer-actions">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={onApprove}>Approve</Button>
      </div>
    </div>
  );
}
