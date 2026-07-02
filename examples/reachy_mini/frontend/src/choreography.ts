import type { Edge, Node } from "@xyflow/react";

import type { StepSpecPayload } from "./useReachy";

/**
 * Pure graph logic for the Choreography Flow widget.
 *
 * Kept free of React and React Flow *runtime* imports (types only) so the
 * sequence/graph behaviour can be unit-tested without a DOM. The layout mirrors
 * reactflow.dev's "inputs → output": each step is an input node that flows
 * directly into a single Robot node (no chain between steps). The sequence
 * order is the steps' top-to-bottom position.
 */

/** Inclusive lower bound for a step's amplitude factors. */
export const FACTOR_MIN = -1;
/** Inclusive upper bound for a step's amplitude factors. */
export const FACTOR_MAX = 1;

const ROBOT_ID = "robot";
const STEP_X = 0;
const ROBOT_X = 420;
const ROW_GAP_Y = 130;

/** Data carried by a `step` node — one editable {@link StepSpecPayload}. */
export interface StepNodeData {
  /** Human-readable step name, e.g. `"tilt_right"`. */
  label: string;
  /** Multiplier applied to `roll_amplitude_deg`. Range −1…1. */
  rollFactor: number;
  /** Multiplier applied to `z_amplitude_mm`. Range −1…1. */
  zFactor: number;
  /** Multiplier applied to `antenna_amplitude`. Range −1…1. */
  antennaFactor: number;
}

/** A React Flow graph: the nodes and edges the canvas renders. */
export interface ChoreoGraph {
  nodes: Node[];
  edges: Edge[];
}

/** Clamp a factor to the allowed −1…1 range. */
export function clampFactor(value: number): number {
  return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, value));
}

function stepId(index: number): string {
  return `step-${index}`;
}

function edgeToRobot(source: string): Edge {
  return { id: `${source}->${ROBOT_ID}`, source, target: ROBOT_ID };
}

function stepDataFrom(step: StepSpecPayload): StepNodeData {
  return {
    label: step.label,
    rollFactor: step.roll_factor ?? 0,
    zFactor: step.z_factor ?? 0,
    antennaFactor: step.antenna_factor ?? 0,
  };
}

function robotY(stepCount: number): number {
  return (Math.max(0, stepCount - 1) * ROW_GAP_Y) / 2;
}

/**
 * Build the initial graph from a choreography sequence: one `step` node per
 * entry stacked vertically, each wired straight into a single terminal `robot`
 * node. There is no `start` node and no step-to-step chain.
 */
export function buildInitialGraph(sequence: StepSpecPayload[]): ChoreoGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  sequence.forEach((step, i) => {
    const id = stepId(i);
    nodes.push({
      id,
      type: "step",
      position: { x: STEP_X, y: i * ROW_GAP_Y },
      data: { ...stepDataFrom(step) },
    });
    edges.push(edgeToRobot(id));
  });

  nodes.push({
    id: ROBOT_ID,
    type: "robot",
    position: { x: ROBOT_X, y: robotY(sequence.length) },
    data: {},
  });

  return { nodes, edges };
}

/**
 * Emit one {@link StepSpecPayload} per step node, ordered top-to-bottom by
 * vertical position. `robot` contributes nothing to the payload.
 */
export function serializeSequence(nodes: Node[]): StepSpecPayload[] {
  return nodes
    .filter((n) => n.type === "step")
    .slice()
    .sort((a, b) => a.position.y - b.position.y)
    .map((n) => {
      const data = n.data as unknown as StepNodeData;
      return {
        label: data.label,
        roll_factor: data.rollFactor,
        z_factor: data.zFactor,
        antenna_factor: data.antennaFactor,
      };
    });
}

/** Append a new default step node below the others, wired into the robot. */
export function addStep(nodes: Node[], edges: Edge[]): ChoreoGraph {
  const stepNodes = nodes.filter((n) => n.type === "step");
  const usedIndexes = stepNodes
    .map((n) => Number.parseInt(n.id.replace("step-", ""), 10))
    .filter((n) => !Number.isNaN(n));
  const nextIndex = (usedIndexes.length ? Math.max(...usedIndexes) : -1) + 1;
  const id = stepId(nextIndex);
  const nextCount = stepNodes.length + 1;

  const newNode: Node = {
    id,
    type: "step",
    position: { x: STEP_X, y: stepNodes.length * ROW_GAP_Y },
    data: { label: `step_${nextIndex}`, rollFactor: 0, zFactor: 0, antennaFactor: 0 },
  };

  // Keep the robot vertically centred on the (now larger) column.
  const recentred = nodes.map((n) =>
    n.type === "robot"
      ? { ...n, position: { ...n.position, y: robotY(nextCount) } }
      : n,
  );

  return { nodes: [...recentred, newNode], edges: [...edges, edgeToRobot(id)] };
}

/** Remove a step node and its edge into the robot. */
export function removeStep(nodes: Node[], edges: Edge[], id: string): ChoreoGraph {
  return {
    nodes: nodes.filter((n) => n.id !== id),
    edges: edges.filter((e) => e.source !== id && e.target !== id),
  };
}
