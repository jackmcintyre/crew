/**
 * Story 8.5 — drain workflow integrity.
 *
 * The stateless drain runs under the Workflow primitive (`export const meta`,
 * top-level `await`/`return`), so it cannot be unit-executed here. This is a
 * structure/integrity anchor: the script parses, declares its meta, wires the
 * load-bearing seam tools via the one-shot CLI, switches on the verified
 * discriminants, and accounts for every ref in a structured return (the
 * no-silent-failures surface). End-to-end behaviour is exercised in M5.
 */
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRAIN = path.resolve(HERE, "..", "..", "workflows", "drain.workflow.js");
const SRC = readFileSync(DRAIN, "utf8");

describe("Story 8.5 — drain workflow integrity", () => {
  it("parses as a Workflow-runtime script (export/meta/top-level await+return)", () => {
    // Wrap the body in an async fn so top-level await/return are valid for parse.
    const wrapped = "(async()=>{" + SRC.replace("export const meta", "const meta") + "})()";
    expect(() => new vm.Script(wrapped)).not.toThrow();
  });

  it("declares meta.name = crew-drain with a drain phase", () => {
    expect(SRC).toMatch(/export const meta\s*=/);
    expect(SRC).toContain("name: 'crew-drain'");
    expect(SRC).toContain("title: 'drain'");
  });

  it("wires the load-bearing seam tools via the one-shot CLI", () => {
    for (const tool of [
      "mintSessionUlid",
      "buildPersonaSpawnPrompt",
      "claimNextStory",
      "runDevTerminalAction",
      "processDevTranscript",
      "runReviewerSession",
      "processReviewerTranscript",
      "runAutoMergeGate",
    ]) {
      expect(SRC).toContain(tool);
    }
  });

  it("switches on the verified seam discriminants", () => {
    for (const arm of [
      "spawn-dev",
      "spawn-reviewer",
      "done-ready-for-merge",
      "done-blocked-reviewer-needs-changes",
      "auto-merge",
    ]) {
      expect(SRC).toContain(arm);
    }
  });

  it("accounts for every ref in a structured return (no silent failures)", () => {
    for (const field of ["completed", "merged", "pausedForHuman", "blocked", "drainedReason"]) {
      expect(SRC).toContain(field);
    }
  });

  it("uses haiku couriers for seams; v1 dev runs in targetRepoRoot (no isolated worktree)", () => {
    expect(SRC).toContain("model: 'haiku'");
    // v1 is single-story serial: the dev runs directly in targetRepoRoot so
    // runDevTerminalAction's cwd aligns (an isolated worktree mismatches — first-run fix).
    expect(SRC).not.toContain("isolation: 'worktree'");
  });
});
