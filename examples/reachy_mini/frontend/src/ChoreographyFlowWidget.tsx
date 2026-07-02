import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodeId,
  useNodesState,
} from "@xyflow/react";
import type { Connection, NodeProps, NodeTypes } from "@xyflow/react";
import { useChannel, usePublish } from "@app-framework/core-ui";
import type { WidgetDefinition } from "@app-framework/core-ui";
import "@xyflow/react/dist/style.css";
import "./ChoreographyFlowWidget.css";

import {
  FACTOR_MAX,
  FACTOR_MIN,
  addStep,
  buildInitialGraph,
  clampFactor,
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
  /** Remove the step node with `id` and heal the chain. */
  deleteStep: (id: string) => void;
}

const ChoreoActionsContext = createContext<ChoreoActions | null>(null);

function useChoreoActions(): ChoreoActions {
  const ctx = useContext(ChoreoActionsContext);
  if (!ctx) throw new Error("useChoreoActions must be used within the widget");
  return ctx;
}

// ─── Custom nodes ───────────────────────────────────────────────────────────────

/** A single factor control (labelled range slider, clamped to −1…1). */
function FactorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="reachy-choreo-factor">
      <span className="reachy-choreo-factor-label">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={FACTOR_MIN}
        max={FACTOR_MAX}
        step={0.1}
        value={value}
        onChange={(e) => onChange(clampFactor(e.currentTarget.valueAsNumber))}
      />
      <span className="reachy-choreo-factor-value">{value.toFixed(1)}</span>
    </label>
  );
}

/** Editable choreography step: label + roll/z/antenna factor sliders. */
function StepNode({ data }: NodeProps) {
  const id = useNodeId();
  const { updateStep, deleteStep } = useChoreoActions();
  const step = data as unknown as StepNodeData;
  const patch = (p: Partial<StepNodeData>) => id && updateStep(id, p);

  return (
    <div className="reachy-choreo-node">
      <div className="reachy-choreo-node-header">
        <input
          className="reachy-choreo-node-label"
          aria-label="Step label"
          value={step.label}
          onChange={(e) => patch({ label: e.currentTarget.value })}
        />
        <button
          type="button"
          className="reachy-choreo-node-delete"
          aria-label={`Delete step ${step.label}`}
          onClick={() => id && deleteStep(id)}
        >
          ×
        </button>
      </div>
      <FactorRow
        label="Roll"
        value={step.rollFactor}
        onChange={(v) => patch({ rollFactor: v })}
      />
      <FactorRow
        label="Z"
        value={step.zFactor}
        onChange={(v) => patch({ zFactor: v })}
      />
      <FactorRow
        label="Antenna"
        value={step.antennaFactor}
        onChange={(v) => patch({ antennaFactor: v })}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/**
 * Terminal sink — every step flows into the robot. Shows the live MuJoCo render
 * (the same `reachy/frame` stream as the sidebar), so a run's motion is visible
 * right here in the flow.
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
  /** Initial choreography shown on the canvas. Default `[]` (just Start → Robot). */
  defaultSequence?: StepSpecPayload[];
}

function ChoreographyFlowInner({
  channel = "reachy/control",
  defaultSequence = [],
}: ChoreographyFlowProps) {
  const publish = usePublish();
  const initial = useMemo(() => buildInitialGraph(defaultSequence), [defaultSequence]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  // Mirror the latest state so callbacks invoked from child nodes (via context)
  // always read current nodes/edges without going stale.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const actions = useMemo<ChoreoActions>(
    () => ({
      updateStep: (id, p) =>
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)),
        ),
      deleteStep: (id) => {
        const next = removeStep(nodesRef.current, edgesRef.current, id);
        setNodes(next.nodes);
        setEdges(next.edges);
      },
    }),
    [setNodes, setEdges],
  );

  const handleAddStep = useCallback(() => {
    const next = addStep(nodesRef.current, edgesRef.current);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [setNodes, setEdges]);

  const handleSend = useCallback(() => {
    publish(channel, { sequence: serializeSequence(nodesRef.current) });
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
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
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
 * Renders the robot's movement sequence as a React Flow graph of step-nodes
 * flowing into a terminal Robot node. Editing the graph and pressing
 * **Send to robot** publishes `{ sequence }` to the control channel, where the
 * backend applies it on the next run.
 *
 * @param props See {@link ChoreographyFlowProps}.
 * @returns The choreography canvas.
 * @example
 * ```tsx
 * <ChoreographyFlowComponent
 *   channel="reachy/control"
 *   defaultSequence={[{ label: "tilt_right", roll_factor: 1 }]}
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
    "sequence as a wired graph of step nodes and publish it to reachy/control.",
  channelPattern: "reachy/control",
  consumes: [],
  priority: 10,
  defaultRegion: "main",
  parameters: {
    channel: { type: "string", default: "reachy/control" },
  },
  factory: () => ChoreographyFlowComponent as ComponentType,
};
