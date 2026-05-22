/**
 * Integration tests for the inner dev → reviewer cycle through tool composition
 * — Story 4.3b Task 10.
 *
 * Composes `processDevTranscript` and `processReviewerTranscript` in the order
 * the SKILL.md prose will compose them: processDevTranscript →
 * processReviewerTranscript → (maybe loop). The Claude Code `Task` tool is NOT
 * in the loop — this is a unit-level integration test of the MCP layer's
 * composition correctness.
 *
 * Each test case seeds a fixture tmpdir with:
 *   - `.crew/config.yaml` (native adapter)
 *   - `.crew/state/in-progress/<ref>.yaml` (pre-claimed manifest)
 *   - `team/generalist-dev/PERSONA.md`
 *   - `team/generalist-reviewer/PERSONA.md`
 *
 * Covers the AC4 branches (a)–(g):
 *   (a) Happy handoff + READY FOR MERGE.
 *   (b) Rework loop: NEEDS CHANGES × 1 → READY FOR MERGE.
 *   (c) Grammar drift (handoff drift).
 *   (d) Two-iteration rework convergence.
 *   (e) Reviewer grammar drift.
 *   (f) Reviewer BLOCKED passthrough.
 *   (g) Tool count assertion (22 tools, contains new tools, does not contain runDevSession).
 *
 * Story 4.3b Task 10.1–10.4.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { processDevTranscript } from "../process-dev-transcript.js";
import { processReviewerTranscript } from "../process-reviewer-transcript.js";
import { registerAllTools } from "../register.js";
import { createServer } from "../../server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ExecutionManifest } from "../../schemas/execution-manifest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4GHI";
const SESSION_ULID = "01HZSESSION00000000000003";
const HANDOFF_PHRASE = `Handoff to reviewer — story ${STORY_REF} ready for review.`;
const READY_FOR_MERGE = `**Verdict: READY FOR MERGE**`;
const NEEDS_CHANGES = `**Verdict: NEEDS CHANGES** [2 issues]`;
const BLOCKED_VERDICT = `**Verdict: BLOCKED**`;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeBaseManifest(ref: string): ExecutionManifest {
  return {
    ref,
    status: "in-progress",
    adapter: "native",
    source_path: `.crew/native-stories/${ref}.yaml`,
    source_hash: "a".repeat(64),
    depends_on: [],
    acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
    title: "Integration Test Story",
    narrative: "As a dev, I want to integrate test.",
    withdrawn: false,
    claimed_by: SESSION_ULID,
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

Implements stories.

## Mandate

- Implement.

## Out of mandate

- Review.

## Prompt

You are the dev.

## Knowledge

None.
`;

const FIXTURE_REVIEWER_PERSONA_MD = `---
role: generalist-reviewer
domain: "code review in a story scope"
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

# Generalist Reviewer

## Domain

Reviews stories.

## Mandate

- Review.

## Out of mandate

- Implement.

## Prompt

You are the reviewer.

## Knowledge

None.
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-inner-cycle-integration-"));

  // .crew state dirs
  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "to-do"), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "done"), { recursive: true });

  // .crew/config.yaml (native adapter)
  await atomicWriteFile(
    path.join(tmpRoot, ".crew", "config.yaml"),
    "adapter: native\n",
  );

  manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`);
  await seedManifest(makeBaseManifest(STORY_REF));

  // team personas
  await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, "team", "generalist-reviewer"), { recursive: true });
  await atomicWriteFile(
    path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"),
    FIXTURE_DEV_PERSONA_MD,
  );
  await atomicWriteFile(
    path.join(tmpRoot, "team", "generalist-reviewer", "PERSONA.md"),
    FIXTURE_REVIEWER_PERSONA_MD,
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

function makeDevOpts(devTranscript: string) {
  return { targetRepoRoot: tmpRoot, sessionUlid: SESSION_ULID, ref: STORY_REF, devTranscript };
}

function makeReviewerOpts(reviewerTranscript: string) {
  return {
    targetRepoRoot: tmpRoot,
    sessionUlid: SESSION_ULID,
    ref: STORY_REF,
    manifestPath,
    reviewerTranscript,
  };
}

// ---------------------------------------------------------------------------
// AC4(a): Happy handoff + READY FOR MERGE
// ---------------------------------------------------------------------------

describe("AC4(a): happy handoff + READY FOR MERGE", () => {
  it("full cycle: spawn-reviewer → done-ready-for-merge, no manifest mutations, verbatim chatLog", async () => {
    const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));

    expect(devResult.next).toBe("spawn-reviewer");
    if (devResult.next !== "spawn-reviewer") return;

    const reviewerResult = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
    expect(reviewerResult.next).toBe("done-ready-for-merge");

    // Cumulative chatLog contains AC1 verbatim line.
    const allChatLog = [...devResult.chatLog, ...reviewerResult.chatLog];
    expect(allChatLog).toContain(
      `handoff received — story ${STORY_REF} — spawning generalist-reviewer subagent (clean context)`,
    );
    // READY FOR MERGE line.
    expect(allChatLog).toContain(
      `reviewer verdict: READY FOR MERGE — story ${STORY_REF} ready for merge gate`,
    );

    // No rework_count, no blocked_by.
    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBeUndefined();
    expect(onDisk.blocked_by).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4(b): Rework loop — one NEEDS CHANGES → READY FOR MERGE
// ---------------------------------------------------------------------------

describe("AC4(b): NEEDS CHANGES (rework_count undefined → 1) → second cycle READY FOR MERGE", () => {
  it("rework-dev → reworkIteration: 1, then done-ready-for-merge; manifest rework_count: 1; verbatim AC2 line", async () => {
    // First dev turn: happy handoff.
    const devResult1 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    expect(devResult1.next).toBe("spawn-reviewer");
    if (devResult1.next !== "spawn-reviewer") return;

    // First reviewer turn: NEEDS CHANGES.
    const reviewerResult1 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
    expect(reviewerResult1.next).toBe("rework-dev");
    if (reviewerResult1.next !== "rework-dev") return;
    expect(reviewerResult1.reworkIteration).toBe(1);

    // Second dev turn: happy handoff again.
    const devResult2 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    expect(devResult2.next).toBe("spawn-reviewer");
    if (devResult2.next !== "spawn-reviewer") return;

    // Second reviewer turn: READY FOR MERGE.
    const reviewerResult2 = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
    expect(reviewerResult2.next).toBe("done-ready-for-merge");

    // Cumulative chatLog contains AC2 verbatim line with <n>=1.
    const allChatLog = [
      ...devResult1.chatLog,
      ...reviewerResult1.chatLog,
      ...devResult2.chatLog,
      ...reviewerResult2.chatLog,
    ];
    expect(allChatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`,
    );

    // Manifest final state: rework_count: 1.
    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBe(1);
    expect(onDisk.blocked_by).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4(c): Grammar drift (handoff drift)
// ---------------------------------------------------------------------------

describe("AC4(c): handoff grammar drift → done-blocked-handoff-grammar", () => {
  it("processReviewerTranscript is NOT called; manifest blocked_by: 'handoff-grammar'; verbatim AC3 line", async () => {
    const devResult = await processDevTranscript(
      makeDevOpts("story is ready for review — handing off!"),
    );

    expect(devResult.next).toBe("done-blocked-handoff-grammar");
    expect(devResult.chatLog).toContain(
      `handoff grammar drift — story ${STORY_REF} blocked. expected verbatim phrase: "Handoff to reviewer — story ${STORY_REF} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`,
    );

    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBe("handoff-grammar");
  });
});

// ---------------------------------------------------------------------------
// AC4(d): Two-iteration rework convergence
// ---------------------------------------------------------------------------

describe("AC4(d): two-iteration rework: NEEDS CHANGES × 2 → READY FOR MERGE", () => {
  it("final manifest rework_count: 2; AC2 line appears twice with <n>=1 and <n>=2", async () => {
    const allChatLog: string[] = [];

    // Cycle 1: dev handoff → NEEDS CHANGES.
    const dev1 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    allChatLog.push(...dev1.chatLog);
    expect(dev1.next).toBe("spawn-reviewer");
    if (dev1.next !== "spawn-reviewer") return;

    const rev1 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
    allChatLog.push(...rev1.chatLog);
    expect(rev1.next).toBe("rework-dev");
    if (rev1.next !== "rework-dev") return;
    expect(rev1.reworkIteration).toBe(1);

    // Cycle 2: dev handoff → NEEDS CHANGES.
    const dev2 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    allChatLog.push(...dev2.chatLog);
    expect(dev2.next).toBe("spawn-reviewer");
    if (dev2.next !== "spawn-reviewer") return;

    const rev2 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
    allChatLog.push(...rev2.chatLog);
    expect(rev2.next).toBe("rework-dev");
    if (rev2.next !== "rework-dev") return;
    expect(rev2.reworkIteration).toBe(2);

    // Cycle 3: dev handoff → READY FOR MERGE.
    const dev3 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    allChatLog.push(...dev3.chatLog);
    if (dev3.next !== "spawn-reviewer") return;

    const rev3 = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
    allChatLog.push(...rev3.chatLog);
    expect(rev3.next).toBe("done-ready-for-merge");

    // AC2 line appears twice.
    const n1Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`;
    const n2Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`;
    expect(allChatLog).toContain(n1Line);
    expect(allChatLog).toContain(n2Line);

    // Final manifest: rework_count: 2, no blocked_by.
    const onDisk = await readOnDiskManifest();
    expect(onDisk.rework_count).toBe(2);
    expect(onDisk.blocked_by).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4(e): Reviewer grammar drift
// ---------------------------------------------------------------------------

describe("AC4(e): reviewer grammar drift → done-blocked-reviewer-grammar", () => {
  it("stamps blocked_by: 'reviewer-grammar'; verbatim reviewer-grammar-drift line", async () => {
    const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    expect(devResult.next).toBe("spawn-reviewer");
    if (devResult.next !== "spawn-reviewer") return;

    // Reviewer emits an unrecognised sentinel (not bold-wrapped).
    const reviewerResult = await processReviewerTranscript(
      makeReviewerOpts("Verdict: APPROVED"),
    );
    expect(reviewerResult.next).toBe("done-blocked-reviewer-grammar");
    expect(reviewerResult.chatLog).toContain(
      `reviewer grammar drift — story ${STORY_REF} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`,
    );

    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBe("reviewer-grammar");
  });
});

// ---------------------------------------------------------------------------
// AC4(f): Reviewer BLOCKED passthrough
// ---------------------------------------------------------------------------

describe("AC4(f): reviewer BLOCKED passthrough → done-blocked-reviewer-verdict", () => {
  it("manifest NOT mutated; chatLog has verbatim BLOCKED line", async () => {
    const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
    expect(devResult.next).toBe("spawn-reviewer");
    if (devResult.next !== "spawn-reviewer") return;

    const reviewerResult = await processReviewerTranscript(makeReviewerOpts(BLOCKED_VERDICT));
    expect(reviewerResult.next).toBe("done-blocked-reviewer-verdict");
    expect(reviewerResult.chatLog).toContain(
      `reviewer verdict: BLOCKED — story ${STORY_REF} awaiting human`,
    );

    const onDisk = await readOnDiskManifest();
    expect(onDisk.blocked_by).toBeUndefined();
    expect(onDisk.rework_count).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4(g): Tool count — 21 tools, contains new tools, does NOT contain runDevSession
// ---------------------------------------------------------------------------

describe("AC4(g): tool count and required tools present", () => {
  it("registered tool list has exactly 22 entries and contains the three new tools but NOT runDevSession", async () => {
    const server = createServer();
    registerAllTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "ac4g-test-client", version: "0.0.0" },
      { capabilities: {} },
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.request(
        { method: "tools/list", params: {} },
        ListToolsResultSchema,
      );

      const toolNames = result.tools.map((t) => t.name);

      expect(toolNames).toContain("claimNextStory");
      expect(toolNames).toContain("processDevTranscript");
      expect(toolNames).toContain("processReviewerTranscript");
      expect(toolNames).not.toContain("runDevSession");
      expect(toolNames.length).toBe(22);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
