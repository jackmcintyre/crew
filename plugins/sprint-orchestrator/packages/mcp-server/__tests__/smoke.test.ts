import { describe, it, expect } from "vitest";
import { PLUGIN_NAME, buildServer } from "../src/index.js";

describe("mcp-server skeleton", () => {
  it("exports plugin name", () => {
    expect(PLUGIN_NAME).toBe("sprint-orchestrator");
  });

  it("builds a server without throwing", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });
});
