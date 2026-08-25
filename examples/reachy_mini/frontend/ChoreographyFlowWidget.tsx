import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodeId,
  useNodesState,
} from "@xyflow/react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { useChannel, useProfileState, usePublish } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import "@xyflow/react/dist/style.css";
import "./ChoreographyFlowWidget.css";

import {
  STEP_AXES,
  addStep,
  buildInitialGraph,
  chainEdges,
  clamp,
  removeStep,
  serializeSequence,
} from "./choreography";
import type { StepNodeData } from "./choreography";
import type { ReachyFrame, StepSpecPayload } from "./useReachy";

// ─── Step-node actions (via context, so custom nodes can edit/delete) ───────────

/** Actions a `step` node can perform on itself, keyed by its own id. */
interface ChoreoActions {
  /** Merge a partial data patch into the step node with `id`. */
  updateStep: (id: string, patch: Partial<StepNodeData>) => void;
  /** Remove the step node with `id`. */
  deleteStep: (id: string) => void;
}

const ChoreoActionsContext = createContext<ChoreoActions | null>(null);

function useChoreoActions(): ChoreoActions {
  const ctx = useContext(ChoreoActionsContext);
  if (!ctx) throw new Error("useChoreoActions must be used within the widget");
  return ctx;
}

// ─── Custom nodes ───────────────────────────────────────────────────────────────

/** A single axis control — a labelled range slider in real units. */
function FactorRow({
  label,
  value,
  min,
  max,
  step,
  decimals,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="reachy-choreo-factor">
      <span className="reachy-choreo-factor-label">{label}</span>
      <input
        type="range"
        // `nodrag` so dragging the slider adjusts the value instead of moving
        // the React Flow node.
        className="nodrag"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(e.currentTarget.valueAsNumber, min, max))}
      />
      <span className="reachy-choreo-factor-value">{value.toFixed(decimals)}</span>
    </label>
  );
}

/** Editable choreography step: label + roll/z/antenna/duration sliders. */
function StepNode({ data }: NodeProps) {
  const id = useNodeId();
  const { updateStep, deleteStep } = useChoreoActions();
  const step = data as unknown as StepNodeData;
  const patch = (p: Partial<StepNodeData>) => id && updateStep(id, p);

  return (
    <div className="reachy-choreo-node">
      <Handle type="target" position={Position.Left} />
      <div className="reachy-choreo-node-header">
        <input
          className="reachy-choreo-node-label nodrag"
          aria-label="Step label"
          value={step.label}
          onChange={(e) => patch({ label: e.currentTarget.value })}
        />
        <button
          type="button"
          className="reachy-choreo-node-delete nodrag"
          aria-label={`Delete step ${step.label}`}
          onClick={() => id && deleteStep(id)}
        >
          ×
        </button>
      </div>
      {STEP_AXES.map((axis) => (
        <FactorRow
          key={axis.key}
          label={axis.label}
          value={step[axis.key]}
          min={axis.min}
          max={axis.max}
          step={axis.step}
          decimals={axis.decimals}
          onChange={(v) => patch({ [axis.key]: v })}
        />
      ))}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/**
 * Terminal sink at the end of the chain. Shows the live MuJoCo render (the same
 * `reachy/frame` stream as the sidebar), so a run's motion is visible here.
 */
function RobotNode() {
  const frame = useChannel<ReachyFrame>("reachy/frame");
  return (
    <div className="reachy-choreo-robot">
      <Handle type="target" position={Position.Left} />
      <div className="reachy-choreo-robot-title">Robot</div>
      {frame ? (
        <img
          src={frame.image}
          alt="Live render of the Reachy Mini robot"
          className="reachy-choreo-robot-img"
        />
      ) : (
        <div className="reachy-choreo-robot-placeholder">
          Send a choreography and press Start to see the robot move.
        </div>
      )}
    </div>
  );
}

// ─── Widget ─────────────────────────────────────────────────────────────────────

/** Props for {@link ChoreographyFlowComponent}. */
export interface ChoreographyFlowProps {
  /** EventBus channel to publish the authored sequence to. Default `reachy/control`. */
  channel?: string;
  /** Initial choreography shown on the canvas. Default `[]` (just the Robot). */
  defaultSequence?: StepSpecPayload[];
}

const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed },
};

function ChoreographyFlowInner({
  channel = "reachy/control",
  defaultSequence = [],
}: ChoreographyFlowProps) {
  const publish = usePublish();
  const initialNodes = useMemo(
    () => buildInitialGraph(defaultSequence),
    [defaultSequence],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  // Edges are derived from the node order — each step links to the next, the
  // last into the robot — so dragging a step to reorder re-links the chain.
  const edges = useMemo(() => chainEdges(nodes), [nodes]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Opt the choreography box positions into layout profiles: dragging a box to
  // a new spot is captured when a profile is saved, and restored when it's
  // loaded — the general useProfileState mechanism, one line for this widget.
  const nodePositions = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n.position])),
    [nodes],
  );
  const applyNodePositions = useCallback(
    (saved: Record<string, { x: number; y: number }>) => {
      setNodes((nds) =>
        nds.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n)),
      );
    },
    [setNodes],
  );
  useProfileState("choreo.nodePositions", nodePositions, applyNodePositions);

  const actions = useMemo<ChoreoActions>(
    () => ({
      updateStep: (id, p) =>
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)),
        ),
      deleteStep: (id) => setNodes((nds) => removeStep(nds, id)),
    }),
    [setNodes],
  );

  const handleAddStep = useCallback(() => setNodes((nds) => addStep(nds)), [setNodes]);

  // Publish the authored sequence (each step carries its own duration) *and*
  // start a run, so the robot immediately performs the edited choreography.
  const handleSend = useCallback(() => {
    publish(channel, {
      sequence: serializeSequence(nodesRef.current),
      command: "start",
    });
  }, [channel, publish]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({ step: StepNode, robot: RobotNode }),
    [],
  );

  return (
    <ChoreoActionsContext.Provider value={actions}>
      <div className="reachy-choreo">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <Panel position="top-left" className="reachy-choreo-toolbar">
            <button type="button" className="reachy-btn" onClick={handleAddStep}>
              Add step
            </button>
            <button
              type="button"
              className="reachy-btn reachy-btn--primary"
              onClick={handleSend}
            >
              Send to robot
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </ChoreoActionsContext.Provider>
  );
}

/**
 * Node-based choreography editor for the Reachy Mini.
 *
 * Renders the robot's movement sequence as a React Flow **chain** of step-nodes
 * (`step → step → … → Robot`) so the order is visible, ending in a Robot node
 * that shows the live MuJoCo render. Pressing **Send to robot** publishes
 * `{ sequence, command: "start" }` to the control channel, so the robot runs the
 * edited choreography immediately.
 *
 * @param props See {@link ChoreographyFlowProps}.
 * @returns The choreography canvas.
 * @example
 * ```tsx
 * <ChoreographyFlowComponent
 *   channel="reachy/control"
 *   defaultSequence={[{ label: "tilt_right", roll_factor: 40, duration_s: 0.25 }]}
 * />
 * ```
 */
export function ChoreographyFlowComponent(props: ChoreographyFlowProps) {
  return (
    <ReactFlowProvider>
      <ChoreographyFlowInner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * Example widget definition for the choreography editor. Registered into the
 * shell so it lives in the `main` region like every other widget.
 */
export const CHOREOGRAPHY_FLOW: WidgetDefinition = {
  name: "ChoreographyFlow",
  description:
    "Node-based choreography editor (React Flow). Author the robot's movement " +
    "sequence as a chain of step nodes and publish it to reachy/control.",
  channelPattern: "reachy/control",
  consumes: [],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    channel: { type: "string", default: "reachy/control" },
  },
  factory: () => ChoreographyFlowComponent as ComponentType,
};
