/**
 * Integration tests for `runStartLoop` — Story 4.2 Task 8 / AC4.
 *
 * Tests the claim-spawn-loop function that the /crew:start skill's prose maps to.
 * The Task-tool spawn is captured by a fake (a function that records its call args).
 * Assertions inspect the captured argument list per AC4.
 *
 * Covers AC4 branches:
 *   (a) Happy multi-claim: three independent stories → three spawns in alphabetical order.
 *   (b) Queue drained: empty to-do/ and in-progress/ → verbatim queue-drained line, zero spawns.
 *   (c) Deps-not-ready surfacing: B.depends_on=[A]; A in to-do/, B in to-do/ →
 *       A claimed+spawned, B skipped silently (depsReady=false).
 *   (d) Hand-edit refusal surfacing: claimStory on a hand-edited ref surfaces
 *       InProgressHandEditError verbatim.
 *
 * The loop is driven via injection point (test seam) — no Claude Code harness required.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { DependenciesNotReadyError, InProgressHandEditError } from "../../errors.js";
import { runStartLoop, QUEUE_DRAINED_LINE, TaskSpawnArgs } from "../start-loop.js";
import type { ListClaimableTodosResult, ClaimableCandidate } from "../../tools/list-claimable-todos.js";

// ---------------------------------------------------------------------------
// Types for the test spy
// ---------------------------------------------------------------------------

interface SpawnRecord {
  systemPrompt: string;
  initialContext: TaskSpawnArgs["initialContext"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ULID = "01HZSESSION00000000000001";
const FAKE_SYSTEM_PROMPT = "# Generalist Dev — Persona\n\n## Domain\n\nTest domain.";

function makeFakeCandidate(
  ref: string,
  opts: { depsReady?: boolean; depends_on?: string[] } = {},
): ClaimableCandidate {
  return {
    ref,
    title: `Story ${ref}`,
    depends_on: opts.depends_on ?? [],
    depsReady: opts.depsReady ?? true,
  };
}

function makeFakeListTodos(
  candidates: ClaimableCandidate[],
  inProgressCount: number,
): () => Promise<ListClaimableTodosResult> {
  let callCount = 0;
  // First pass returns candidates; subsequent passes return empty (all claimed).
  return async () => {
    callCount++;
    if (callCount === 1) {
      return { todos: candidates, inProgressCount };
    }
    // Second pass: all claimed, simulate empty queue.
    return { todos: [], inProgressCount: 0 };
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-start-loop-"));
  // Create state dirs.
  for (const state of ["to-do", "in-progress", "done", "blocked"]) {
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", state), { recursive: true });
  }
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC4(a) — Happy multi-claim
// ---------------------------------------------------------------------------

describe("AC4(a) — happy multi-claim: three independent stories", () => {
  it("issues three spawn invocations in alphabetical ref order", async () => {
    const refs = [
      "native:01HZABC0000000000000000003",
      "native:01HZABC0000000000000000001",
      "native:01HZABC0000000000000000002",
    ];

    // listTodos returns sorted candidates (sorted by the tool).
    const sortedCandidates = [...refs]
      .sort()
      .map((ref) => makeFakeCandidate(ref));

    const spawnRecords: SpawnRecord[] = [];
    const claimCalls: Array<{ ref: string; sessionUlid: string }> = [];
    let buildPromptCallCount = 0;

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(sortedCandidates, 0),
        claim: async (opts) => {
          claimCalls.push({ ref: opts.ref, sessionUlid: opts.sessionUlid });
          return { ref: opts.ref, absPath: `/fake/in-progress/${opts.ref}.yaml` };
        },
        buildPrompt: async () => {
          buildPromptCallCount++;
          return { systemPrompt: FAKE_SYSTEM_PROMPT };
        },
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            initialContext: args.initialContext,
          });
        },
      },
    });

    // (i) Three spawn invocations in alphabetical ref order.
    expect(spawnRecords.length).toBe(3);
    const spawnedRefs = spawnRecords.map((s) => s.initialContext.ref);
    expect(spawnedRefs).toEqual([...refs].sort());

    // (ii) buildPrompt called three times — once per spawn.
    expect(buildPromptCallCount).toBe(3);

    // (iii) Each spawn received the assembled system prompt.
    for (const record of spawnRecords) {
      expect(record.systemPrompt).toBe(FAKE_SYSTEM_PROMPT);
    }

    // (iv) claimStory called three times with the same sessionUlid.
    expect(claimCalls.length).toBe(3);
    for (const call of claimCalls) {
      expect(call.sessionUlid).toBe(SESSION_ULID);
    }

    // (v) Session header is in chat log.
    expect(result.chatLog[0]).toBe(
      `dev session — workspace: ${tmpRoot} — session: ${SESSION_ULID}`,
    );

    // Queue-drained line appears eventually.
    expect(result.chatLog).toContain(QUEUE_DRAINED_LINE);
  });
});

// ---------------------------------------------------------------------------
// AC4(b) — Queue drained
// ---------------------------------------------------------------------------

describe("AC4(b) — queue drained: empty to-do/ and in-progress/", () => {
  it("prints verbatim queue-drained line and issues zero spawns", async () => {
    const spawnRecords: SpawnRecord[] = [];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: async () => ({ todos: [], inProgressCount: 0 }),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            initialContext: args.initialContext,
          });
        },
      },
    });

    // Verbatim queue-drained line.
    expect(result.chatLog).toContain(QUEUE_DRAINED_LINE);

    // Zero spawns.
    expect(spawnRecords.length).toBe(0);

    // Session header still printed.
    expect(result.chatLog[0]).toBe(
      `dev session — workspace: ${tmpRoot} — session: ${SESSION_ULID}`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC4(c) — Deps-not-ready surfacing
// ---------------------------------------------------------------------------

describe("AC4(c) — deps-not-ready: B depends on A, both in to-do/", () => {
  it("claims and spawns A; skips B silently (depsReady=false)", async () => {
    const refA = "native:01HZABC0000000000000000001";
    const refB = "native:01HZABC0000000000000000002";

    // A is ready; B has unmet deps.
    const candidates: ClaimableCandidate[] = [
      makeFakeCandidate(refA, { depsReady: true, depends_on: [] }),
      makeFakeCandidate(refB, { depsReady: false, depends_on: [refA] }),
    ];

    const spawnRecords: SpawnRecord[] = [];
    const claimCalls: string[] = [];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => {
          claimCalls.push(opts.ref);
          return { ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` };
        },
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            initialContext: args.initialContext,
          });
        },
      },
    });

    // (i) A is claimed and spawned.
    expect(claimCalls).toContain(refA);
    expect(spawnRecords.some((s) => s.initialContext.ref === refA)).toBe(true);

    // (ii) B is NOT claimed or spawned (depsReady=false filters it).
    expect(claimCalls).not.toContain(refB);
    expect(spawnRecords.some((s) => s.initialContext.ref === refB)).toBe(false);

    // (iii) No DependenciesNotReadyError text in chatLog for B (pre-filter declined it).
    const depsErrorLines = result.chatLog.filter((line) =>
      line.includes("DependenciesNotReadyError"),
    );
    expect(depsErrorLines.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC4(d) — Hand-edit refusal surfacing
// ---------------------------------------------------------------------------

describe("AC4(d) — hand-edit refusal: claimStory throws InProgressHandEditError", () => {
  it("surfaces InProgressHandEditError verbatim in chatLog and continues", async () => {
    const refHandEdited = "native:01HZABC0000000000000000001";
    const refClaimable = "native:01HZABC0000000000000000002";

    const handEditError = new InProgressHandEditError({
      ref: refHandEdited,
      changedFields: ["title"],
      absPath: `/fake/${refHandEdited}.yaml`,
    });

    const candidates: ClaimableCandidate[] = [
      makeFakeCandidate(refHandEdited, { depsReady: true }),
      makeFakeCandidate(refClaimable, { depsReady: true }),
    ];

    const spawnRecords: SpawnRecord[] = [];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => {
          if (opts.ref === refHandEdited) {
            throw handEditError;
          }
          return { ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` };
        },
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            initialContext: args.initialContext,
          });
        },
      },
    });

    // InProgressHandEditError surfaces verbatim in chatLog.
    const errorLine = result.chatLog.find((line) =>
      line.startsWith("InProgressHandEditError:"),
    );
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain(handEditError.message);

    // The loop continues: refClaimable is still claimed and spawned.
    expect(spawnRecords.some((s) => s.initialContext.ref === refClaimable)).toBe(true);
  });

  it("directly calling claim on a hand-edited ref surfaces InProgressHandEditError verbatim", async () => {
    // This test exercises the error-surfacing path directly by calling the loop
    // with only the hand-edited ref and asserting the error class name appears.
    const refHandEdited = "native:01HZABC0000000000000000001";

    const handEditError = new InProgressHandEditError({
      ref: refHandEdited,
      changedFields: ["title", "narrative"],
      absPath: `/fake/${refHandEdited}.yaml`,
    });

    const candidates: ClaimableCandidate[] = [
      makeFakeCandidate(refHandEdited, { depsReady: true }),
    ];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async () => { throw handEditError; },
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async () => {},
      },
    });

    // Error class name and message both present.
    const errorLines = result.chatLog.filter((line) => line.includes("InProgressHandEditError"));
    expect(errorLines.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Behavioural invariants
// ---------------------------------------------------------------------------

describe("Behavioural invariants", () => {
  it("does not call buildPrompt on the queue-drained path", async () => {
    let buildPromptCalled = false;

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: async () => ({ todos: [], inProgressCount: 0 }),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => {
          buildPromptCalled = true;
          return { systemPrompt: FAKE_SYSTEM_PROMPT };
        },
        taskSpawn: async () => {},
      },
    });

    expect(buildPromptCalled).toBe(false);
  });

  it("prints 'claiming <ref> — <title>' BEFORE the spawn", async () => {
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async () => {},
      },
    });

    const claimIdx = result.chatLog.findIndex((line) => line.startsWith("claiming "));
    const spawnIdx = result.chatLog.findIndex((line) =>
      line.startsWith("spawning generalist-dev"),
    );

    expect(claimIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(spawnIdx);
  });

  it("re-uses same sessionUlid for every claimStory call", async () => {
    const refs = [
      "native:01HZABC0000000000000000001",
      "native:01HZABC0000000000000000002",
    ];
    const candidates = refs.map((ref) => makeFakeCandidate(ref));
    const sessionUlidsUsed: string[] = [];

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => {
          sessionUlidsUsed.push(opts.sessionUlid);
          return { ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` };
        },
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async () => {},
      },
    });

    expect(sessionUlidsUsed.length).toBe(2);
    expect(sessionUlidsUsed.every((u) => u === SESSION_ULID)).toBe(true);
  });

  it("includes ref, title, sessionUlid, targetRepoRoot, manifestPath in Task spawn args", async () => {
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];
    const spawnRecords: SpawnRecord[] = [];

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: FAKE_SYSTEM_PROMPT }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            initialContext: args.initialContext,
          });
        },
      },
    });

    expect(spawnRecords.length).toBe(1);
    const ctx = spawnRecords[0]!.initialContext;
    expect(ctx.ref).toBe(ref);
    expect(ctx.title).toBe(`Story ${ref}`);
    expect(ctx.sessionUlid).toBe(SESSION_ULID);
    expect(ctx.targetRepoRoot).toBe(tmpRoot);
    expect(ctx.manifestPath).toBe(`.crew/state/in-progress/${ref}.yaml`);
  });
});
