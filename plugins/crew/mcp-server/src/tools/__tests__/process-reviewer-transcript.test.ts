/**
 * Unit tests for `processReviewerTranscript` — Story 4.3b Task 9.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules.
 *
 * Covers:
 *   (a) READY FOR MERGE → `next: "done-ready-for-merge"`, manifest NOT mutated.
 *   (b) NEEDS CHANGES (first rework) → `next: "rework-dev"`, reworkIteration: 1,
 *       manifest `rework_count: 1`, devPrompt populated.
 *   (c) NEEDS CHANGES (second rework) → reworkIteration: 2, manifest `rework_count: 2`.
 *   (d) BLOCKED → `next: "done-blocked-reviewer-verdict"`, manifest NOT mutated.
 *   (e) Drift / empty / unknown-sentinel → `next: "done-blocked-reviewer-grammar"`,
 *       manifest `blocked_by: "reviewer-grammar"`.
 *
 * Story 4.3b Task 9.1–9.2.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { processReviewerTranscript } from "../process-reviewer-transcript.js";
import type { ExecutionManifest } from "../../schemas/execution-manifest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4DEF";
const SESSION_ULID = "01HZSESSION00000000000002";

const READY_FOR_MERGE = `**Verdict: READY FOR MERGE**`;
const NEEDS_CHANGES = `**Verdict: NEEDS CHANGES** [2 issues]`;
const BLOCKED_VERDICT = `**Verdict: BLOCKED**`;
const READY_WITH_BRACKET = `**Verdict: READY FOR MERGE** [lgtm]`;
const BLOCKED_WITH_BRACKET = `**Verdict: BLOCKED** [under-specified story]`;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeBaseManifest(ref: string, reworkCount?: number): ExecutionManifest {
  return {
    ref,
    status: "in-progress",
    adapter: "native",
    source_path: `.crew/native-stories/${ref}.yaml`,
    source_hash: "a".repeat(64),
    depends_on: [],
    acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
    title: "Test Story",
    narrative: "As a dev, I want to test.",
    withdrawn: false,
    claimed_by: SESSION_ULID,
    ...(reworkCount !== undefined ? { rework_count: reworkCount } : {}),
  };
}

const FIXTURE_DEV_PERSONA_MD = `---
role: generalist-dev
domain: "feature implementation in a story scope"
model_tier: sonnet
tools_allow:
  - Read
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Dev

## Domain

Implements one story.

## Mandate

- Implement.

## Out of mandate

- Review.

## Prompt

You are the dev.

## Knowledge

No knowledge.
`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot: string;
let manifestPath: string;

async function seedManifest(manifest: ExecutionManifest): Promise<void> {
  await atomicWriteFile(manifestPath, yamlStringify(manifest, { lineWidth: 0 }));
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-process-reviewer-transcript-"));
  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
  manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`);
  await seedManifest(makeBaseManifest(STORY_REF));

  await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), { recursive: true });
  await atomicWriteFile(
    path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"),
    FIXTURE_DEV_PERSONA_MD,
  );
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readOnDiskManifest(): Promise<ExecutionManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  return parseExecutionManifest(yamlParse(raw) as unknown, { absPath: manifestPath });
}

function makeOpts(reviewerTranscript: string) {
  return {
    targetRepoRoot: tmpRoot,
    sessionUlid: SESSION_ULID,
    ref: STORY_REF,
    manifestPath,
    reviewerTranscript,
  };
}

// ---------------------------------------------------------------------------
// (a) READY FOR MERGE
// ---------------------------------------------------------------------------

describe("(a) READY FOR MERGE → done-ready-for-merge", () => {
  it("no manifest mutation, chatLog has verbatim line (without bracket)", async () => {
    const result = await processReviewerTranscript(makeOpts(READY_FOR_MERGE));

    expect(result.next).toBe("done-ready-for-merge");
    expect(result.chatLog).toContain(
      `reviewer verdict: READY FOR MERGE — story ${STORY_REF} ready for merge gate`,
    );
    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBeUndefined();
    expect(onDisk.blocked_by).toBeUndefined();
  });

  it("no manifest mutation with bracket trailer", async () => {
    const result = await processReviewerTranscript(makeOpts(READY_WITH_BRACKET));
    expect(result.next).toBe("done-ready-for-merge");
    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (b) NEEDS CHANGES — first rework
// ---------------------------------------------------------------------------

describe("(b) NEEDS CHANGES (rework_count: undefined → 1)", () => {
  it("returns rework-dev with reworkIteration: 1, manifest rework_count: 1, devPrompt populated", async () => {
    const result = await processReviewerTranscript(makeOpts(NEEDS_CHANGES));

    expect(result.next).toBe("rework-dev");
    if (result.next !== "rework-dev") return;

    expect(result.reworkIteration).toBe(1);
    expect(result.devPrompt.length).toBeGreaterThan(0);
    expect(result.devPrompt).toContain("Generalist Dev");

    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`,
    );

    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBe(1);
    expect(onDisk.blocked_by).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (c) NEEDS CHANGES — second rework
// ---------------------------------------------------------------------------

describe("(c) NEEDS CHANGES (rework_count: 1 → 2)", () => {
  it("returns rework-dev with reworkIteration: 2, manifest rework_count: 2", async () => {
    // Seed manifest with rework_count: 1 already.
    await seedManifest(makeBaseManifest(STORY_REF, 1));

    const result = await processReviewerTranscript(makeOpts(NEEDS_CHANGES));

    expect(result.next).toBe("rework-dev");
    if (result.next !== "rework-dev") return;

    expect(result.reworkIteration).toBe(2);

    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`,
    );

    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (d) BLOCKED
// ---------------------------------------------------------------------------

describe("(d) BLOCKED → done-blocked-reviewer-verdict", () => {
  it("no manifest mutation, chatLog has verbatim BLOCKED line (without bracket)", async () => {
    const result = await processReviewerTranscript(makeOpts(BLOCKED_VERDICT));

    expect(result.next).toBe("done-blocked-reviewer-verdict");
    expect(result.chatLog).toContain(
      `reviewer verdict: BLOCKED — story ${STORY_REF} awaiting human`,
    );
    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBeUndefined();
    expect(onDisk.rework_count).toBeUndefined();
  });

  it("no manifest mutation with bracket trailer", async () => {
    const result = await processReviewerTranscript(makeOpts(BLOCKED_WITH_BRACKET));
    expect(result.next).toBe("done-blocked-reviewer-verdict");
    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (e) Drift / empty / unknown-sentinel
// ---------------------------------------------------------------------------

describe("(e) drift → done-blocked-reviewer-grammar", () => {
  it("drift (unrecognised paraphrase) stamps blocked_by: 'reviewer-grammar'", async () => {
    const result = await processReviewerTranscript(makeOpts("Looks good to me!"));

    expect(result.next).toBe("done-blocked-reviewer-grammar");
    expect(result.chatLog).toContain(
      `reviewer grammar drift — story ${STORY_REF} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`,
    );
    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBe("reviewer-grammar");
  });

  it("empty transcript stamps blocked_by: 'reviewer-grammar'", async () => {
    const result = await processReviewerTranscript(makeOpts(""));
    expect(result.next).toBe("done-blocked-reviewer-grammar");
    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBe("reviewer-grammar");
  });

  it("unknown sentinel ('Verdict: APPROVED') stamps blocked_by: 'reviewer-grammar'", async () => {
    const result = await processReviewerTranscript(makeOpts("Verdict: APPROVED"));
    expect(result.next).toBe("done-blocked-reviewer-grammar");
    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBe("reviewer-grammar");
  });
});
