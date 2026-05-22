/**
 * Content-structure tests for AC6 anchors — Story 4.3b Task 11.2.
 *
 * Reads the source files for the two new transcript-processor tools and
 * register.ts, asserting the verbatim anchor strings required by AC6(ix)–(xi).
 *
 * AC6(ix):  `process-dev-transcript.ts` contains `handoff received — story`
 *           and `handoff grammar drift — story`, but NOT
 *           `re-spawning generalist-dev subagent (rework iteration`.
 * AC6(x):   `process-reviewer-transcript.ts` contains
 *           `re-spawning generalist-dev subagent (rework iteration`,
 *           `reviewer verdict: READY FOR MERGE`,
 *           `reviewer verdict: BLOCKED`,
 *           `reviewer grammar drift — story`.
 * AC6(xi):  `register.ts` contains zero occurrences of the literal `"runDevSession"`.
 *
 * Story 4.3b Task 11.2.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(HERE, ".."); // src/tools/

const PROCESS_DEV_FILE = path.join(TOOLS_DIR, "process-dev-transcript.ts");
const PROCESS_REVIEWER_FILE = path.join(TOOLS_DIR, "process-reviewer-transcript.ts");
const REGISTER_FILE = path.join(TOOLS_DIR, "register.ts");

describe("AC6(ix) — process-dev-transcript.ts content structure", () => {
  let source: string;

  beforeAll(async () => {
    source = await fs.readFile(PROCESS_DEV_FILE, "utf8");
  });

  it("contains the verbatim substring 'handoff received — story'", () => {
    expect(source).toContain("handoff received — story");
  });

  it("contains the verbatim substring 'handoff grammar drift — story'", () => {
    expect(source).toContain("handoff grammar drift — story");
  });

  it("does NOT contain the rework-dev chat line (that belongs to process-reviewer-transcript.ts)", () => {
    expect(source).not.toContain("re-spawning generalist-dev subagent (rework iteration");
  });
});

describe("AC6(x) — process-reviewer-transcript.ts content structure", () => {
  let source: string;

  beforeAll(async () => {
    source = await fs.readFile(PROCESS_REVIEWER_FILE, "utf8");
  });

  it("contains the verbatim substring 're-spawning generalist-dev subagent (rework iteration'", () => {
    expect(source).toContain("re-spawning generalist-dev subagent (rework iteration");
  });

  it("contains the verbatim substring 'reviewer verdict: READY FOR MERGE'", () => {
    expect(source).toContain("reviewer verdict: READY FOR MERGE");
  });

  it("contains the verbatim substring 'reviewer verdict: BLOCKED'", () => {
    expect(source).toContain("reviewer verdict: BLOCKED");
  });

  it("contains the verbatim substring 'reviewer grammar drift — story'", () => {
    expect(source).toContain("reviewer grammar drift — story");
  });
});

describe("AC6(xi) — register.ts contains zero occurrences of 'runDevSession'", () => {
  let source: string;

  beforeAll(async () => {
    source = await fs.readFile(REGISTER_FILE, "utf8");
  });

  it("does NOT contain the literal string \"runDevSession\" anywhere", () => {
    expect(source).not.toContain('"runDevSession"');
    expect(source).not.toContain("runDevSession");
  });
});
