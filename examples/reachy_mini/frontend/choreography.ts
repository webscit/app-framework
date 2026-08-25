import type { Edge, Node } from "@xyflow/react";

import type { StepSpecPayload } from "./useReachy";

/**
 * Pure graph logic for the Choreography Flow widget.
 *
 * Kept free of React and React Flow *runtime* imports (types only) so the graph
 * behaviour can be unit-tested without a DOM. Steps are laid out left→right and
 * wired **into a chain** — each step connects to the next, and the last step
 * into the Robot node — so the choreography order is visible. Order is the
 * steps' horizontal position; the chain edges are *derived* from it
 * ({@link chainEdges}), so dragging a step to reorder re-links the chain.
 */

const ROBOT_ID = "robot";
const NODE_GAP_X = 320;

/**
 * Data carried by a `step` node — one editable {@link StepSpecPayload}. The
 * fields keep their `…Factor` names for wire compatibility, but now hold the
 * **absolute** per-step values (the backend uses them directly, no amplitude
 * multiply).
 */
export interface StepNodeData {
  /** Human-readable step name, e.g. `"tilt_right"`. */
  label: string;
  /** Absolute head roll for this step (degrees). */
  rollFactor: number;
  /** Absolute head vertical position for this step (mm). */
  zFactor: number;
  /** Absolute antenna position for this step. */
  antennaFactor: number;
  /** Duration of this step in seconds. */
  duration: number;
}

/** Fallback per-step duration (seconds) when a sequence entry omits one. */
export const DEFAULT_STEP_DURATION_S = 0.5;

/** Per-axis control config for a step node: absolute range, step, and display. */
export interface AxisConfig {
  /** Which {@link StepNodeData} field this axis edits. */
  key: "rollFactor" | "zFactor" | "antennaFactor" | "duration";
  /** Slider label. */
  label: string;
  /** Inclusive minimum (absolute). */
  min: number;
  /** Inclusive maximum (absolute). */
  max: number;
  /** Slider increment. */
  step: number;
  /** Decimal places to show in the value readout. */
  decimals: number;
}

/** The three editable axes on a step node, in display order. */
export const STEP_AXES: AxisConfig[] = [
  { key: "rollFactor", label: "Roll (°)", min: -45, max: 45, step: 5, decimals: 0 },
  { key: "zFactor", label: "Z (mm)", min: -50, max: 50, step: 5, decimals: 0 },
  {
    key: "antennaFactor",
    label: "Antenna",
    min: -0.6,
    max: 0.6,
    step: 0.05,
    decimals: 2,
  },
  {
    key: "duration",
    label: "Duration (s)",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    decimals: 2,
  },
];

/** Clamp a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stepId(index: number): string {
  return `step-${index}`;
}

function orderedSteps(nodes: Node[]): Node[] {
  return nodes
    .filter((n) => n.type === "step")
    .slice()
    .sort((a, b) => a.position.x - b.position.x);
}

/** Build the initial nodes from a sequence: step nodes left→right + a robot. */
export function buildInitialGraph(sequence: StepSpecPayload[]): Node[] {
  const nodes: Node[] = sequence.map((step, i) => ({
    id: stepId(i),
    type: "step",
    position: { x: i * NODE_GAP_X, y: 0 },
    data: {
      label: step.label,
      rollFactor: step.roll_factor ?? 0,
      zFactor: step.z_factor ?? 0,
      antennaFactor: step.antenna_factor ?? 0,
      duration: step.duration_s ?? DEFAULT_STEP_DURATION_S,
    },
  }));

  nodes.push({
    id: ROBOT_ID,
    type: "robot",
    position: { x: sequence.length * NODE_GAP_X, y: 0 },
    data: {},
  });

  return nodes;
}

/**
 * Derive the chain edges from the current node positions: each step (ordered
 * left→right) links to the next, and the last step links into the robot.
 */
export function chainEdges(nodes: Node[]): Edge[] {
  const steps = orderedSteps(nodes);
  return steps.map((step, i) => {
    const target = i < steps.length - 1 ? steps[i + 1].id : ROBOT_ID;
    return { id: `${step.id}->${target}`, source: step.id, target };
  });
}

/** Emit one {@link StepSpecPayload} per step node, ordered left→right by x. */
export function serializeSequence(nodes: Node[]): StepSpecPayload[] {
  return orderedSteps(nodes).map((n) => {
    const data = n.data as unknown as StepNodeData;
    return {
      label: data.label,
      roll_factor: data.rollFactor,
      z_factor: data.zFactor,
      antenna_factor: data.antennaFactor,
      duration_s: data.duration,
    };
  });
}

/** Append a new default step at the end of the chain (robot shifts right). */
export function addStep(nodes: Node[]): Node[] {
  const steps = nodes.filter((n) => n.type === "step");
  const usedIndexes = steps
    .map((n) => Number.parseInt(n.id.replace("step-", ""), 10))
    .filter((n) => !Number.isNaN(n));
  const nextIndex = (usedIndexes.length ? Math.max(...usedIndexes) : -1) + 1;

  const newNode: Node = {
    id: stepId(nextIndex),
    type: "step",
    position: { x: steps.length * NODE_GAP_X, y: 0 },
    data: {
      label: `step_${nextIndex}`,
      rollFactor: 0,
      zFactor: 0,
      antennaFactor: 0,
      duration: DEFAULT_STEP_DURATION_S,
    },
  };

  // Push the robot one slot to the right so it stays at the tail of the chain.
  const shifted = nodes.map((n) =>
    n.type === "robot"
      ? { ...n, position: { ...n.position, x: (steps.length + 1) * NODE_GAP_X } }
      : n,
  );

  return [...shifted, newNode];
}

/** Remove a step node (the chain re-links via {@link chainEdges}). */
export function removeStep(nodes: Node[], id: string): Node[] {
  return nodes.filter((n) => n.id !== id);
}
