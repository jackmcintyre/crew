import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";
import { BmadAdapter } from "../src/adapters/bmad/index.js";
import { PluginManifestSchema, SEMVER_REGEX } from "../src/schemas/plugin-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "../../.claude-plugin/plugin.json");

describe("plugin skeleton smoke", () => {
  it("instantiates the MCP server with zero tools (AC6a, AC6b)", () => {
    const server = createServer();
    expect(server.getRegisteredToolNames()).toEqual([]);
  });

  it("parses .claude-plugin/plugin.json against its Zod schema (AC6c)", () => {
    const parsed = PluginManifestSchema.safeParse(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toMatch(SEMVER_REGEX);
    }
  });

  it("BmadAdapter.listSourceStories returns [] (AC6d)", async () => {
    const stories = await BmadAdapter.listSourceStories();
    expect(stories).toEqual([]);
  });
});
