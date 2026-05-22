/**
 * Unit tests for `runDevReviewerCycle` — Story 4.3 Task 9.
 *
 * Uses fakes for all four dependencies (buildPrompt, taskSpawnWithTranscript,
 * readManifest, writeManifest). Real node:fs against a tmpdir is used for the
 * readManifest / writeManifest fakes in AC4(b)/(f) to verify on-disk state.
 *
 * Covers:
 *   (a) happy handoff + READY FOR MERGE → no manifest writes, finalState:
 *       "ready-for-merge", chatLog contains AC1 verbatim
 *   (b) NEEDS CHANGES → manifest write with rework_count: 1 → second cycle
 *       happy → finalState: "ready-for-merge", chatLog contains AC2 verbatim
 *       with <n> = 1
 *   (c) handoff drift → manifest write with blocked_by: "handoff-grammar",
 *       finalState: "blocked-handoff-grammar", no reviewer spawn, AC3 verbatim
 *   (d) reviewer verdict drift → manifest write with blocked_by:
 *       "reviewer-grammar", finalState: "blocked-reviewer-grammar",
 *       verbatim reviewer-drift line
 *   (e) BLOCKED verdict → no manifest write, finalState:
 *       "blocked-reviewer-verdict", verbatim BLOCKED passthrough
 *   (f) two-iteration rework (NEEDS CHANGES × 2 → READY FOR MERGE) →
 *       rework_count: 2, AC2 line appears twice
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { runDevReviewerCycle } from "../dev-reviewer-cycle.js";
import type {
  RunDevReviewerCycleDeps,
  TaskSpawnWithTranscriptArgs,
} from "../dev-reviewer-cycle.js";
import type { ExecutionManifest } from "../../schemas/execution-manifest.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORY_REF = "01J9P0K2N3MZX0YV4S5RTQ4ABC";
const SESSION_ULID = "01HZSESSION00000000000001";
const STORY_TITLE = "Test Story";
const HANDOFF_PHRASE = `Handoff to reviewer — story ${STORY_REF} ready for review.`;
const READY_FOR_MERGE = `**Verdict: READY FOR MERGE**`;
const NEEDS_CHANGES = `**Verdict: NEEDS CHANGES** [2 issues, 0 questions]`;
const BLOCKED_VERDICT = `**Verdict: BLOCKED**`;

// ---------------------------------------------------------------------------
// Helpers
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
    title: "Test Story",
    narrative: "As a dev, I want to test.",
    withdrawn: false,
    claimed_by: SESSION_ULID,
  };
}

function makeInMemoryDeps(
  devTranscripts: string[],
  reviewerTranscripts: string[],
): {
  deps: RunDevReviewerCycleDeps;
  spawnCalls: Array<{ role: string; args: TaskSpawnWithTranscriptArgs }>;
  manifestWrites: Array<ExecutionManifest>;
  currentManifest: ExecutionManifest;
} {
  const spawnCalls: Array<{ role: string; args: TaskSpawnWithTranscriptArgs }> = [];
  const manifestWrites: Array<ExecutionManifest> = [];
  let currentManifest = makeBaseManifest(STORY_REF);
  let devCallIdx = 0;
  let reviewerCallIdx = 0;
  let promptRole = "";

  const deps: RunDevReviewerCycleDeps = {
    buildPrompt: async (opts) => {
      promptRole = opts.role;
      return { systemPrompt: `# ${opts.role} persona` };
    },
    taskSpawnWithTranscript: async (args) => {
      spawnCalls.push({ role: promptRole, args });
      if (promptRole === "generalist-dev") {
        const transcript = devTranscripts[devCallIdx++] ?? HANDOFF_PHRASE;
        return { transcript };
      } else {
        const transcript = reviewerTranscripts[reviewerCallIdx++] ?? READY_FOR_MERGE;
        return { transcript };
      }
    },
    readManifest: async (_absPath) => currentManifest,
    writeManifest: async (_absPath, manifest, _opts) => {
      currentManifest = manifest;
      manifestWrites.push({ ...manifest });
    },
  };

  return { deps, spawnCalls, manifestWrites, currentManifest };
}

// ---------------------------------------------------------------------------
// Setup / teardown for real-fs tests
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-dev-reviewer-cycle-"));
  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC4(a): happy handoff + READY FOR MERGE
// ---------------------------------------------------------------------------

describe("(a) happy handoff + READY FOR MERGE", () => {
  it("returns finalState: 'ready-for-merge', no manifest writes, AC1 chatLog line", async () => {
    const { deps, spawnCalls, manifestWrites } = makeInMemoryDeps(
      [HANDOFF_PHRASE],
      [READY_FOR_MERGE],
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("ready-for-merge");
    // Two spawns: dev + reviewer
    expect(spawnCalls).toHaveLength(2);
    // No manifest writes (no rework, no blocked_by)
    expect(manifestWrites).toHaveLength(0);
    // AC1 verbatim chat line
    expect(result.chatLog).toContain(
      `handoff received — story ${STORY_REF} — spawning generalist-reviewer subagent (clean context)`,
    );
    // READY FOR MERGE line
    expect(result.chatLog).toContain(
      `reviewer verdict: READY FOR MERGE — story ${STORY_REF} ready for merge gate`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC4(b): NEEDS CHANGES → rework_count: 1 → second cycle → READY FOR MERGE
// ---------------------------------------------------------------------------

describe("(b) NEEDS CHANGES → one rework → READY FOR MERGE", () => {
  it("writes rework_count: 1, AC2 chatLog line with <n>=1, finalState: 'ready-for-merge'", async () => {
    const { deps, spawnCalls, manifestWrites } = makeInMemoryDeps(
      [HANDOFF_PHRASE, HANDOFF_PHRASE], // two dev spawns
      [NEEDS_CHANGES, READY_FOR_MERGE], // reviewer NEEDS CHANGES then READY
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("ready-for-merge");
    // Four spawns: dev, reviewer (NEEDS CHANGES), dev (rework), reviewer (READY)
    expect(spawnCalls).toHaveLength(4);
    // One manifest write: rework_count increment
    expect(manifestWrites).toHaveLength(1);
    expect(manifestWrites[0]!.rework_count).toBe(1);
    // AC2 verbatim chat line with <n>=1
    expect(result.chatLog).toContain(
      `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC4(c): handoff drift → blocked-handoff-grammar
// ---------------------------------------------------------------------------

describe("(c) handoff grammar drift → blocked", () => {
  it("stamps blocked_by: handoff-grammar, no reviewer spawn, AC3 chatLog, finalState: blocked-handoff-grammar", async () => {
    const { deps, spawnCalls, manifestWrites } = makeInMemoryDeps(
      ["story is ready for review — handing off!"], // paraphrase drift
      [],
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("blocked-handoff-grammar");
    // Only one spawn (the dev)
    expect(spawnCalls).toHaveLength(1);
    // One manifest write with blocked_by
    expect(manifestWrites).toHaveLength(1);
    expect(manifestWrites[0]!.blocked_by).toBe("handoff-grammar");
    // AC3 verbatim chat line
    expect(result.chatLog).toContain(
      `handoff grammar drift — story ${STORY_REF} blocked. expected verbatim phrase: "Handoff to reviewer — story ${STORY_REF} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`,
    );
  });
});

// ---------------------------------------------------------------------------
// (d): reviewer verdict drift → blocked-reviewer-grammar
// ---------------------------------------------------------------------------

describe("(d) reviewer verdict drift → blocked-reviewer-grammar", () => {
  it("stamps blocked_by: reviewer-grammar, verbatim reviewer-drift line", async () => {
    const { deps, spawnCalls, manifestWrites } = makeInMemoryDeps(
      [HANDOFF_PHRASE],
      ["Looks good to me!"], // paraphrase — not a valid verdict
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("blocked-reviewer-grammar");
    expect(spawnCalls).toHaveLength(2);
    expect(manifestWrites).toHaveLength(1);
    expect(manifestWrites[0]!.blocked_by).toBe("reviewer-grammar");
    expect(result.chatLog).toContain(
      `reviewer grammar drift — story ${STORY_REF} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`,
    );
  });
});

// ---------------------------------------------------------------------------
// (e): BLOCKED verdict → blocked-reviewer-verdict
// ---------------------------------------------------------------------------

describe("(e) BLOCKED verdict → blocked-reviewer-verdict", () => {
  it("no manifest write, finalState: blocked-reviewer-verdict, verbatim BLOCKED passthrough", async () => {
    const { deps, spawnCalls, manifestWrites } = makeInMemoryDeps(
      [HANDOFF_PHRASE],
      [BLOCKED_VERDICT],
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("blocked-reviewer-verdict");
    expect(spawnCalls).toHaveLength(2);
    // BLOCKED does NOT stamp manifest
    expect(manifestWrites).toHaveLength(0);
    expect(result.chatLog).toContain(
      `reviewer verdict: BLOCKED — story ${STORY_REF} awaiting human`,
    );
  });
});

// ---------------------------------------------------------------------------
// (f): two-iteration rework convergence
// ---------------------------------------------------------------------------

describe("(f) two-iteration rework: NEEDS CHANGES × 2 → READY FOR MERGE", () => {
  it("six spawns, rework_count: 2, AC2 line appears twice", async () => {
    const { deps, manifestWrites } = makeInMemoryDeps(
      [HANDOFF_PHRASE, HANDOFF_PHRASE, HANDOFF_PHRASE], // three dev spawns
      [NEEDS_CHANGES, NEEDS_CHANGES, READY_FOR_MERGE],  // three reviewer spawns
    );

    const result = await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath: path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`),
      deps,
    });

    expect(result.finalState).toBe("ready-for-merge");
    // Two manifest writes: rework_count 1 then 2
    expect(manifestWrites).toHaveLength(2);
    expect(manifestWrites[0]!.rework_count).toBe(1);
    expect(manifestWrites[1]!.rework_count).toBe(2);
    // AC2 verbatim line with <n>=1 and <n>=2
    const n1Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`;
    const n2Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`;
    expect(result.chatLog).toContain(n1Line);
    expect(result.chatLog).toContain(n2Line);
    // Line appears twice
    const count = result.chatLog.filter(
      (l) => l.includes("re-spawning generalist-dev subagent (rework iteration"),
    ).length;
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Real-fs round-trip: manifest state is persisted correctly
// ---------------------------------------------------------------------------

describe("real-fs manifest round-trip", () => {
  it("writes rework_count to disk and reads it back correctly on next read", async () => {
    const manifestPath = path.join(
      tmpRoot,
      ".crew",
      "state",
      "in-progress",
      `${STORY_REF}.yaml`,
    );

    // Seed the manifest on disk.
    const seedManifest = makeBaseManifest(STORY_REF);
    await atomicWriteFile(manifestPath, yamlStringify(seedManifest, { lineWidth: 0 }));

    // Real readManifest / writeManifest using disk.
    const realDeps: RunDevReviewerCycleDeps = {
      buildPrompt: async (opts) => ({ systemPrompt: `# ${opts.role}` }),
      taskSpawnWithTranscript: async (args) => {
        // Determine which role was last built based on systemPrompt.
        const isReviewer = args.systemPrompt.includes("generalist-reviewer");
        if (isReviewer) {
          return { transcript: NEEDS_CHANGES };
        }
        return { transcript: HANDOFF_PHRASE };
      },
      readManifest: async (absPath) => {
        const raw = await fs.readFile(absPath, "utf8");
        const parsed = yamlParse(raw) as unknown;
        return parseExecutionManifest(parsed, { absPath });
      },
      writeManifest: async (absPath, manifest) => {
        const yaml = yamlStringify(manifest, { lineWidth: 0 });
        await atomicWriteFile(absPath, yaml);
      },
    };

    // Only run one NEEDS CHANGES then bail on the second reviewer by making it READY.
    let reviewerCallCount = 0;
    realDeps.taskSpawnWithTranscript = async (args) => {
      const isReviewer = args.systemPrompt.includes("generalist-reviewer");
      if (isReviewer) {
        reviewerCallCount++;
        if (reviewerCallCount === 1) return { transcript: NEEDS_CHANGES };
        return { transcript: READY_FOR_MERGE };
      }
      return { transcript: HANDOFF_PHRASE };
    };

    await runDevReviewerCycle({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      title: STORY_TITLE,
      manifestPath,
      deps: realDeps,
    });

    // Read back the on-disk manifest.
    const raw = await fs.readFile(manifestPath, "utf8");
    const onDisk = parseExecutionManifest(yamlParse(raw) as unknown, { absPath: manifestPath });
    expect(onDisk.rework_count).toBe(1);
  });
});
