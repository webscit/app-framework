import { describe, expect, it } from "vitest";

import {
  addStep,
  buildInitialGraph,
  clampFactor,
  removeStep,
  serializeSequence,
} from "./choreography";
import type { StepSpecPayload } from "./useReachy";

const SEQ: StepSpecPayload[] = [
  { label: "tilt_right", roll_factor: 1.0 },
  { label: "tilt_left", roll_factor: -1.0 },
];

describe("clampFactor", () => {
  it("clamps above 1 to 1", () => {
    expect(clampFactor(2)).toBe(1);
  });

  it("clamps below -1 to -1", () => {
    expect(clampFactor(-5)).toBe(-1);
  });

  it("leaves in-range values untouched", () => {
    expect(clampFactor(0.5)).toBe(0.5);
  });
});

describe("buildInitialGraph", () => {
  it("creates a step node per entry and a single robot, with no start node", () => {
    const { nodes } = buildInitialGraph(SEQ);
    expect(nodes.filter((n) => n.type === "step")).toHaveLength(2);
    expect(nodes.filter((n) => n.type === "robot")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "start")).toHaveLength(0);
  });

  it("wires every step directly into the robot (fan-in)", () => {
    const { edges } = buildInitialGraph(SEQ);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.target === "robot")).toBe(true);
  });

  it("handles an empty sequence (just the robot)", () => {
    const { nodes, edges } = buildInitialGraph([]);
    expect(nodes.filter((n) => n.type === "step")).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

describe("serializeSequence", () => {
  it("returns steps top-to-bottom with factors defaulted to 0", () => {
    const { nodes } = buildInitialGraph(SEQ);
    expect(serializeSequence(nodes)).toEqual([
      { label: "tilt_right", roll_factor: 1, z_factor: 0, antenna_factor: 0 },
      { label: "tilt_left", roll_factor: -1, z_factor: 0, antenna_factor: 0 },
    ]);
  });
});

describe("addStep", () => {
  it("appends a step wired into the robot and grows the sequence by one", () => {
    const g0 = buildInitialGraph(SEQ);
    const g1 = addStep(g0.nodes, g0.edges);
    expect(g1.nodes.filter((n) => n.type === "step")).toHaveLength(3);
    expect(g1.edges.filter((e) => e.target === "robot")).toHaveLength(3);
    expect(serializeSequence(g1.nodes)).toHaveLength(3);
  });
});

describe("removeStep", () => {
  it("removes the step and its edge into the robot", () => {
    const g0 = buildInitialGraph(SEQ);
    const firstStepId = g0.nodes.find((n) => n.type === "step")!.id;
    const g1 = removeStep(g0.nodes, g0.edges, firstStepId);
    expect(g1.nodes.filter((n) => n.type === "step")).toHaveLength(1);
    expect(g1.edges).toHaveLength(1);
    expect(serializeSequence(g1.nodes)).toEqual([
      { label: "tilt_left", roll_factor: -1, z_factor: 0, antenna_factor: 0 },
    ]);
  });
});
