import { describe, expect, it } from "vitest";
import { buildWebSocketUrl } from "@app-framework/core-ui";

/**
 * Smoke tests for the example frontend wiring.
 *
 * Full channel integration is covered in ``packages/framework-core-ui/src/client.test.ts``.
 * These tests focus on example-app-specific concerns: the path passed to
 * ``EventBusProvider`` and the URL derivation logic that depends on it.
 */
describe("example frontend wiring", () => {
  it("derives a ws URL from an http origin", () => {
    expect(
      buildWebSocketUrl("/ws", { protocol: "http:", host: "localhost:8000" }),
    ).toBe("ws://localhost:8000/ws");
  });

  it("derives a wss URL from an https origin", () => {
    expect(buildWebSocketUrl("/ws", { protocol: "https:", host: "example.com" })).toBe(
      "wss://example.com/ws",
    );
  });

  it("normalises a path that is missing its leading slash", () => {
    expect(buildWebSocketUrl("ws", { protocol: "http:", host: "localhost:8000" })).toBe(
      "ws://localhost:8000/ws",
    );
  });
});
