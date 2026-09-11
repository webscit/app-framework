import { describe, expect, it } from "vitest";

import { LOG_VIEWER, STATUS_INDICATOR, SIMULATION_CONTROLS } from "./defaultWidgets";

describe("LOG_VIEWER", () => {
  it("has defaultRegion set to bottom", () => {
    expect(LOG_VIEWER.defaultRegion).toBe("bottom");
  });

  it("factory returns a React component (not null, not a Promise)", () => {
    const result = LOG_VIEWER.factory({ parameters: {} });
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
    // Must be synchronous (not a Promise)
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe("STATUS_INDICATOR", () => {
  it("has defaultRegion set to status-bar", () => {
    expect(STATUS_INDICATOR.defaultRegion).toBe("status-bar");
  });
});

describe("SIMULATION_CONTROLS", () => {
  it("has defaultRegion set to header", () => {
    expect(SIMULATION_CONTROLS.defaultRegion).toBe("header");
  });

  it("factory returns a React component (not null, not a Promise)", () => {
    const result = SIMULATION_CONTROLS.factory({ parameters: {} });
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("declares stateChannel, controlChannel, runningPhase, and title parameters", () => {
    const params = SIMULATION_CONTROLS.parameters as Record<
      string,
      { default: unknown }
    >;
    expect(params.stateChannel.default).toBe("sim/state");
    expect(params.controlChannel.default).toBe("sim/control");
    expect(params.runningPhase.default).toBe("running");
    expect(params.title.default).toBe("Simulation Controls");
  });
});
