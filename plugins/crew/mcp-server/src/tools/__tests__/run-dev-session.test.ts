/**
 * Integration tests for `runDevSession` — Story 4.3 Task 10.
 *
 * End-to-end with all real wiring EXCEPT the Claude Code Task tool, which is
 * faked. Covers AC4 branches (a)–(d).
 *
 * Each fixture seeds a target-repo tmpdir with:
 *   - `.crew/config.yaml` (native adapter)
 *   - `.crew/state/to-do/` with one or more refs
 *   - `team/generalist-dev/PERSONA.md`
 *   - `team/generalist-reviewer/PERSONA.md`
 *
 * The fake Task spawn records its call args (system prompt, initial context)
 * and returns whatever transcript the test case scripted.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { runDevSession } from "../run-dev-session.js";
import type { TaskSpawnWithTranscriptArgs } from "../../skills/dev-reviewer-cycle.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_HASH = "a".repeat(64);
const SESSION_ULID = "01HZSESSION00000000000001";

const FIXTURE_DEV_PERSONA_MD = `---
role: generalist-dev
domain: "feature implementation in a story scope"
model_tier: sonnet
tools_allow:
  - Read
  - Edit
  - Bash
  - Task
gh_allow:
  - pr-create
  - pr-view
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Dev

## Domain

Implements one story at a time.

## Mandate

- Claim and implement.

## Out of mandate

- Reviewing.

## Prompt

You are the generalist dev.

## Knowledge

(empty)
`;

const FIXTURE_REVIEWER_PERSONA_MD = `---
role: generalist-reviewer
domain: "code review and quality verification"
model_tier: sonnet
tools_allow:
  - Read
  - Bash
gh_allow:
  - pr-view
  - pr-comment
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Reviewer

## Domain

Reviews one story at a time.

## Mandate

- Review and verdict.

## Out of mandate

- Implementing.

## Prompt

You are the generalist reviewer.

## Knowledge

(empty)
`;

const FIXTURE_CONFIG_YAML = `adapter: native\n`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifestYaml(ref: string): string {
  return yamlStringify(
    {
      ref,
      status: "to-do",
      adapter: "native",
      source_path: `.crew/native-stories/${ref.replace("native:", "")}.md`,
      source_hash: SOURCE_HASH,
      depends_on: [],
      acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
      title: `Story ${ref}`,
      narrative: "As a dev, I want to test.",
      withdrawn: false,
    },
    { lineWidth: 0 },
  );
}

async function seedRepo(root: string, refs: string[]): Promise<void> {
  // Config
  await fs.mkdir(path.join(root, ".crew"), { recursive: true });
  await atomicWriteFile(path.join(root, ".crew", "config.yaml"), FIXTURE_CONFIG_YAML);

  // State dirs
  for (const dir of ["to-do", "in-progress", "done", "blocked"]) {
    await fs.mkdir(path.join(root, ".crew", "state", dir), { recursive: true });
  }

  // Source stories dir (native adapter requires this)
  await fs.mkdir(path.join(root, ".crew", "native-stories"), { recursive: true });

  // To-do manifests
  for (const ref of refs) {
    const p = path.join(root, ".crew", "state", "to-do", `${ref}.yaml`);
    await atomicWriteFile(p, makeManifestYaml(ref));

    // Write a source story file (native adapter reads this)
    const storyId = ref.replace("native:", "");
    const storyPath = path.join(root, ".crew", "native-stories", `${storyId}.md`);
    await atomicWriteFile(
      storyPath,
      `# Story ${ref}\n\nAs a dev, I want to test.\n\n## Acceptance Criteria\n\n- AC1\n`,
    );
  }

  // Persona files
  await fs.mkdir(path.join(root, "team", "generalist-dev"), { recursive: true });
  await atomicWriteFile(
    path.join(root, "team", "generalist-dev", "PERSONA.md"),
    FIXTURE_DEV_PERSONA_MD,
  );

  await fs.mkdir(path.join(root, "team", "generalist-reviewer"), { recursive: true });
  await atomicWriteFile(
    path.join(root, "team", "generalist-reviewer", "PERSONA.md"),
    FIXTURE_REVIEWER_PERSONA_MD,
  );
}

async function readInProgressManifest(root: string, ref: string): Promise<unknown> {
  const p = path.join(root, ".crew", "state", "in-progress", `${ref}.yaml`);
  const raw = await fs.readFile(p, "utf8");
  return parseExecutionManifest(yamlParse(raw) as unknown, { absPath: p });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-run-dev-session-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC4(a): happy handoff + READY FOR MERGE
// ---------------------------------------------------------------------------

describe("AC4(a) — happy handoff + READY FOR MERGE", () => {
  it("two spawns (dev then reviewer), AC1 line in chatLog, no blocked_by", async () => {
    const ref = "native:01HZABC0000000000000000001";
    await seedRepo(tmpRoot, [ref]);

    const handoffPhrase = `Handoff to reviewer — story ${ref} ready for review.`;
    const spawnRecords: Array<{ systemPrompt: string }> = [];

    const result = await runDevSession({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      taskSpawnWithTranscript: async (args: TaskSpawnWithTranscriptArgs) => {
        spawnRecords.push({ systemPrompt: args.systemPrompt });
        const isReviewer = args.systemPrompt.includes("Generalist Reviewer");
        if (isReviewer) {
          return { transcript: "**Verdict: READY FOR MERGE**" };
        }
        return { transcript: handoffPhrase };
      },
    });

    // Two spawns: dev, reviewer
    expect(spawnRecords).toHaveLength(2);
    expect(spawnRecords[0]!.systemPrompt).toContain("Generalist Dev");
    expect(spawnRecords[1]!.systemPrompt).toContain("Generalist Reviewer");

    // AC1 verbatim chat line
    expect(result.chatLog).toContain(
      `handoff received — story ${ref} — spawning generalist-reviewer subagent (clean context)`,
    );

    // No blocked_by in manifest
    const manifest = await readInProgressManifest(tmpRoot, ref);
    expect((manifest as Record<string, unknown>)["blocked_by"]).toBeUndefined();
    expect((manifest as Record<string, unknown>)["rework_count"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4(b): one rework iteration
// ---------------------------------------------------------------------------

describe("AC4(b) — one rework iteration", () => {
  it("four spawns, manifest rework_count: 1, AC2 line in chatLog", async () => {
    const ref = "native:01HZABC0000000000000000002";
    await seedRepo(tmpRoot, [ref]);

    const handoffPhrase = `Handoff to reviewer — story ${ref} ready for review.`;
    let reviewerCallCount = 0;

    const result = await runDevSession({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      taskSpawnWithTranscript: async (args: TaskSpawnWithTranscriptArgs) => {
        const isReviewer = args.systemPrompt.includes("Generalist Reviewer");
        if (isReviewer) {
          reviewerCallCount++;
          if (reviewerCallCount === 1) {
            return { transcript: "**Verdict: NEEDS CHANGES** [2 issues, 0 questions]" };
          }
          return { transcript: "**Verdict: READY FOR MERGE**" };
        }
        return { transcript: handoffPhrase };
      },
    });

    // AC2 verbatim line
    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`,
    );

    // Manifest rework_count: 1
    const manifest = await readInProgressManifest(tmpRoot, ref);
    expect((manifest as Record<string, unknown>)["rework_count"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC4(c): handoff drift block
// ---------------------------------------------------------------------------

describe("AC4(c) — handoff drift block", () => {
  it("zero reviewer spawns, AC3 line in chatLog, manifest blocked_by: handoff-grammar", async () => {
    const ref = "native:01HZABC0000000000000000003";
    await seedRepo(tmpRoot, [ref]);

    let reviewerSpawnCount = 0;

    const result = await runDevSession({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      taskSpawnWithTranscript: async (args: TaskSpawnWithTranscriptArgs) => {
        const isReviewer = args.systemPrompt.includes("Generalist Reviewer");
        if (isReviewer) {
          reviewerSpawnCount++;
          return { transcript: "**Verdict: READY FOR MERGE**" };
        }
        // Paraphrase: drift
        return { transcript: `story ${ref} ready for review.` };
      },
    });

    expect(reviewerSpawnCount).toBe(0);

    // AC3 verbatim line
    expect(result.chatLog).toContain(
      `handoff grammar drift — story ${ref} blocked. expected verbatim phrase: "Handoff to reviewer — story ${ref} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`,
    );

    // Manifest blocked_by: handoff-grammar
    const manifest = await readInProgressManifest(tmpRoot, ref);
    expect((manifest as Record<string, unknown>)["blocked_by"]).toBe("handoff-grammar");
  });
});

// ---------------------------------------------------------------------------
// AC4(d): two-iteration rework convergence
// ---------------------------------------------------------------------------

describe("AC4(d) — two-iteration rework convergence", () => {
  it("manifest rework_count: 2, AC2 line appears twice with <n>=1 and <n>=2", async () => {
    const ref = "native:01HZABC0000000000000000004";
    await seedRepo(tmpRoot, [ref]);

    const handoffPhrase = `Handoff to reviewer — story ${ref} ready for review.`;
    let reviewerCallCount = 0;

    const result = await runDevSession({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      taskSpawnWithTranscript: async (args: TaskSpawnWithTranscriptArgs) => {
        const isReviewer = args.systemPrompt.includes("Generalist Reviewer");
        if (isReviewer) {
          reviewerCallCount++;
          if (reviewerCallCount <= 2) {
            return { transcript: "**Verdict: NEEDS CHANGES** [issues]" };
          }
          return { transcript: "**Verdict: READY FOR MERGE**" };
        }
        return { transcript: handoffPhrase };
      },
    });

    // AC2 line with <n>=1 and <n>=2
    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`,
    );
    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`,
    );

    // Manifest rework_count: 2
    const manifest = await readInProgressManifest(tmpRoot, ref);
    expect((manifest as Record<string, unknown>)["rework_count"]).toBe(2);
  });
});
