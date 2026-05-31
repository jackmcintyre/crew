/**
 * Story 8.4 — stateless CLI shim dispatch smoke test.
 *
 * The `drain` workflow's seam-agents shell out to
 *   `node dist/cli.js <tool> --json <args>`
 * with NO persistent MCP server on the drain path. This verifies the dispatch
 * contract the seam-agents depend on: a known tool round-trips a single JSON
 * line; an unknown tool exits 64 with a typed error; the two newly-wired seam
 * tools (processReviewerYield, scanOrphanedInProgress) are registered; malformed
 * args exit 65. Requires a built `dist/` (same precondition as the dist-shipping
 * test).
 */
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "dist", "cli.js");

async function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args]);
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "" };
  }
}

describe("Story 8.4 — stateless CLI shim dispatch", () => {
  it("a known no-arg tool round-trips a single JSON line (mintSessionUlid)", async () => {
    const { code, stdout } = await runCli(["mintSessionUlid"]);
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });

  it("an unknown tool exits 64 with a typed unknown-tool error", async () => {
    const { code, stdout } = await runCli(["bogusToolDoesNotExist"]);
    expect(code).toBe(64);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error.kind).toBe("unknown-tool");
  });

  it("the two newly-wired seam tools are registered", async () => {
    // An unknown-tool error lists the known tool names — proves M3's wiring.
    const { stdout } = await runCli(["bogusToolDoesNotExist"]);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error.known).toContain("processReviewerYield");
    expect(parsed.error.known).toContain("scanOrphanedInProgress");
  });

  it("malformed JSON args exit 65 with a bad-json error", async () => {
    const { code, stdout } = await runCli(["getStatus", "--json", "{not valid"]);
    expect(code).toBe(65);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error.kind).toBe("bad-json");
  });
});
