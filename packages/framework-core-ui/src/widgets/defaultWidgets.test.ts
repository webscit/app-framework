import { describe, expect, it } from "vitest";

import { LOG_VIEWER, STATUS_INDICATOR } from "./defaultWidgets";

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
