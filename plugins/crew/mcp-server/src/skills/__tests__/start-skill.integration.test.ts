/**
 * Integration tests for `runStartLoop` — Story 4.2 Task 8 / AC4.
 *
 * Tests the claim-spawn-loop function that the /crew:start skill's prose maps to.
 * The Task-tool spawn is captured by a fake (a function that records its call args).
 * Assertions inspect the captured argument list per AC4.
 *
 * Covers AC4 branches:
 *   (a) Happy multi-claim: three independent stories → three spawns in alphabetical order.
 *       Uses REAL listClaimableTodos, claimStory, buildPersonaSpawnPrompt against tmpdir.
 *   (b) Queue drained: empty to-do/ and in-progress/ → verbatim queue-drained line, zero spawns.
 *   (c) Deps-not-ready surfacing: B.depends_on=[A]; A in to-do/, B in to-do/ →
 *       A claimed+spawned, B skipped silently (depsReady=false).
 *       Uses REAL listClaimableTodos, claimStory, buildPersonaSpawnPrompt against tmpdir.
 *   (d) Hand-edit refusal surfacing: claimStory on a hand-edited ref surfaces
 *       InProgressHandEditError verbatim.
 *
 * For AC4(a) and AC4(c): real production modules are used with tmpdir fixtures.
 * Only taskSpawn remains a recording fake (Claude Code's Task tool is unavailable in vitest).
 *
 * For AC4(b) and AC4(d): injected fakes (no filesystem required for those paths).
 *
 * Also covers the behavioural invariant for the "inProgressCount > 0, no eligible todos"
 * branch — ensures QUEUE_DRAINED_LINE is NOT emitted when in-progress work is active.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { InProgressHandEditError } from "../../errors.js";
import { runStartLoop, QUEUE_DRAINED_LINE, WAITING_ON_IN_PROGRESS_LINE, TaskSpawnArgs } from "../start-loop.js";
import type { ListClaimableTodosResult, ClaimableCandidate } from "../../tools/list-claimable-todos.js";
import { listClaimableTodos } from "../../tools/list-claimable-todos.js";
import { claimStory } from "../../tools/claim-story.js";
import { buildPersonaSpawnPrompt } from "../../tools/build-persona-spawn-prompt.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";

// ---------------------------------------------------------------------------
// Types for the test spy
// ---------------------------------------------------------------------------

interface SpawnRecord {
  systemPrompt: string;
  subagentType: string;
  initialContext: TaskSpawnArgs["initialContext"];
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const SESSION_ULID = "01HZSESSION00000000000001";
const SOURCE_HASH = "a".repeat(64);

// A minimal but valid PERSONA.md fixture for generalist-dev.
const FIXTURE_PERSONA_MD = `---
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

Implements one story at a time end-to-end.

## Mandate

- Claim a story, work it in an isolated worktree.

## Out of mandate

- Reviewing the PR — yield to generalist-reviewer.

## Prompt

You are the generalist dev.

## Knowledge

Accumulated knowledge goes here.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifestYaml(
  ref: string,
  opts: {
    depends_on?: string[];
    status?: string;
    source_hash?: string;
  } = {},
): string {
  const manifest: Record<string, unknown> = {
    ref,
    status: opts.status ?? "to-do",
    adapter: "native",
    source_path: `.crew/native-stories/${ref.replace("native:", "")}.md`,
    source_hash: opts.source_hash ?? SOURCE_HASH,
    depends_on: opts.depends_on ?? [],
    acceptance_criteria: [
      {
        text: "Given the claim tool, when called with valid deps, then it works.",
        kind: "integration",
      },
    ],
    title: `Story ${ref}`,
    narrative: "As a dev, I want to test claims.",
    withdrawn: false,
  };
  return yamlStringify(manifest, { lineWidth: 0 });
}

async function makeStateDir(root: string): Promise<void> {
  for (const state of ["to-do", "in-progress", "done", "blocked"]) {
    await fs.mkdir(path.join(root, ".crew", "state", state), { recursive: true });
  }
}

async function writeTodoManifest(root: string, ref: string, yaml: string): Promise<void> {
  const p = path.join(root, ".crew", "state", "to-do", `${ref}.yaml`);
  await atomicWriteFile(p, yaml);
}

async function writeDoneManifest(root: string, ref: string, yaml: string): Promise<void> {
  const p = path.join(root, ".crew", "state", "done", `${ref}.yaml`);
  await atomicWriteFile(p, yaml);
}

async function writeInProgressManifest(root: string, ref: string, yaml: string): Promise<void> {
  const p = path.join(root, ".crew", "state", "in-progress", `${ref}.yaml`);
  await atomicWriteFile(p, yaml);
}

async function writePersonaFile(root: string): Promise<void> {
  const dir = path.join(root, "team", "generalist-dev");
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, "PERSONA.md"), FIXTURE_PERSONA_MD);
}

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
  await makeStateDir(tmpRoot);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC4(a) — Happy multi-claim (REAL modules: listClaimableTodos, claimStory,
//           buildPersonaSpawnPrompt; fake: taskSpawn)
// ---------------------------------------------------------------------------

describe("AC4(a) — happy multi-claim: three independent stories (real production modules)", () => {
  it("issues three spawn invocations in alphabetical ref order with real modules", async () => {
    // Seed three independent to-do manifests.
    const refs = [
      "native:01HZABC0000000000000000003",
      "native:01HZABC0000000000000000001",
      "native:01HZABC0000000000000000002",
    ];
    for (const ref of refs) {
      await writeTodoManifest(tmpRoot, ref, makeManifestYaml(ref));
    }

    // Write the generalist-dev PERSONA.md so buildPersonaSpawnPrompt can read it.
    await writePersonaFile(tmpRoot);

    const spawnRecords: SpawnRecord[] = [];
    const claimCallRefs: string[] = [];
    const claimCallUlids: string[] = [];

    // Wire real production dependencies; only taskSpawn is a fake.
    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: (opts) => listClaimableTodos(opts),
        claim: async (opts) => {
          claimCallRefs.push(opts.ref);
          claimCallUlids.push(opts.sessionUlid);
          return claimStory(opts);
        },
        buildPrompt: (opts) => buildPersonaSpawnPrompt(opts),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
            initialContext: args.initialContext,
          });
          // Simulate the subagent completing: remove the in-progress/ manifest
          // and write a done/ manifest. This means the second loop pass sees
          // inProgressCount: 0 and empty to-do/, triggering the QUEUE_DRAINED_LINE.
          const inProgressPath = path.join(
            tmpRoot, ".crew", "state", "in-progress", `${args.initialContext.ref}.yaml`,
          );
          try {
            await fs.unlink(inProgressPath);
          } catch {
            // Ignore if already gone.
          }
          const doneYaml = makeManifestYaml(args.initialContext.ref, { status: "done" });
          await writeDoneManifest(tmpRoot, args.initialContext.ref, doneYaml);
        },
      },
    });

    // (i) Three spawn invocations in alphabetical ref order.
    expect(spawnRecords.length).toBe(3);
    const spawnedRefs = spawnRecords.map((s) => s.initialContext.ref);
    expect(spawnedRefs).toEqual([...refs].sort());

    // (ii) buildPersonaSpawnPrompt was called three times (once per spawn):
    // each systemPrompt starts with the persona H1.
    for (const record of spawnRecords) {
      expect(record.systemPrompt).toMatch(/^# Generalist Dev — Persona/);
    }

    // (iii) Each spawn was issued with subagent_type: "general-purpose".
    for (const record of spawnRecords) {
      expect(record.subagentType).toBe("general-purpose");
    }

    // (iv) claimStory called three times with the same sessionUlid.
    expect(claimCallRefs.length).toBe(3);
    expect(claimCallUlids.every((u) => u === SESSION_ULID)).toBe(true);

    // (v) Session header is in chat log.
    expect(result.chatLog[0]).toBe(
      `dev session — workspace: ${tmpRoot} — session: ${SESSION_ULID}`,
    );

    // Queue-drained line appears eventually.
    expect(result.chatLog).toContain(QUEUE_DRAINED_LINE);
  });
});

// ---------------------------------------------------------------------------
// AC4(b) — Queue drained (injected fakes — no filesystem required)
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
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
// AC4(c) — Deps-not-ready surfacing (REAL modules: listClaimableTodos,
//           claimStory, buildPersonaSpawnPrompt; fake: taskSpawn)
// ---------------------------------------------------------------------------

describe("AC4(c) — deps-not-ready: B depends on A, both in to-do/ (real production modules)", () => {
  it("claims and spawns A; skips B silently (depsReady=false)", async () => {
    const refA = "native:01HZABC0000000000000000001";
    const refB = "native:01HZABC0000000000000000002";

    // A has no deps; B depends on A.
    await writeTodoManifest(tmpRoot, refA, makeManifestYaml(refA, { depends_on: [] }));
    await writeTodoManifest(tmpRoot, refB, makeManifestYaml(refB, { depends_on: [refA] }));

    // A is NOT in done/ yet, so B's dep is unmet.
    // A is in to-do/ and claimable.

    await writePersonaFile(tmpRoot);

    const spawnRecords: SpawnRecord[] = [];
    const claimCalls: string[] = [];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: (opts) => listClaimableTodos(opts),
        claim: async (opts) => {
          claimCalls.push(opts.ref);
          return claimStory(opts);
        },
        buildPrompt: (opts) => buildPersonaSpawnPrompt(opts),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
            initialContext: args.initialContext,
          });
          // Do NOT write a done/ manifest here. We want to assert that B is
          // NOT claimed on this same loop pass. A is in in-progress/ after
          // claimStory moved it; B's dep (A) is not in done/ so B stays
          // depsReady: false. The second loop pass will see inProgressCount > 1
          // with no eligible todos and terminate via the "waiting" branch.
        },
      },
    });

    // (i) A is claimed and spawned.
    expect(claimCalls).toContain(refA);
    expect(spawnRecords.some((s) => s.initialContext.ref === refA)).toBe(true);

    // (ii) B is NOT claimed or spawned (depsReady=false filters it in listClaimableTodos).
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
// AC4(d) — Hand-edit refusal surfacing (injected fakes)
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
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

// ---------------------------------------------------------------------------
// AC2 — Persona read exactly once per spawn; no cross-spawn caching
// ---------------------------------------------------------------------------

describe("AC2 — buildPersonaSpawnPrompt called exactly once per spawn (no caching)", () => {
  it("calls buildPrompt exactly once for each story in a multi-story session", async () => {
    // AC2: "on a subsequent claim within the same /crew:start session,
    // buildPersonaSpawnPrompt is invoked again so a persona edit between
    // stories is picked up at the next spawn."
    const refs = [
      "native:01HZABC0000000000000000001",
      "native:01HZABC0000000000000000002",
      "native:01HZABC0000000000000000003",
    ];
    const candidates = refs.map((ref) => makeFakeCandidate(ref));

    const buildPromptCallArgs: Array<{ targetRepoRoot: string; role: string }> = [];

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async (opts) => {
          buildPromptCallArgs.push({ targetRepoRoot: opts.targetRepoRoot, role: opts.role });
          return { systemPrompt: `# Persona snapshot for call ${buildPromptCallArgs.length}` };
        },
        taskSpawn: async () => {},
      },
    });

    // Exactly three calls — one per story spawn, never cached.
    expect(buildPromptCallArgs.length).toBe(3);

    // Each call used role: "generalist-dev".
    for (const callArgs of buildPromptCallArgs) {
      expect(callArgs.role).toBe("generalist-dev");
    }
  });

  it("each spawn receives a freshly-assembled prompt (not the same cached string)", async () => {
    // AC2: "a persona edit between stories MUST be picked up at the next spawn".
    // Simulate a persona that changes between spawn calls to prove no caching.
    const refs = [
      "native:01HZABC0000000000000000001",
      "native:01HZABC0000000000000000002",
    ];
    const candidates = refs.map((ref) => makeFakeCandidate(ref));

    let promptVersion = 0;
    const promptsIssuedToSpawn: string[] = [];

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => {
          promptVersion++;
          // Return a different systemPrompt each call, simulating a persona edit.
          return { systemPrompt: `# Persona v${promptVersion}` };
        },
        taskSpawn: async (args) => {
          promptsIssuedToSpawn.push(args.systemPrompt);
        },
      },
    });

    // Two spawns, two distinct prompts — no caching between spawns.
    expect(promptsIssuedToSpawn.length).toBe(2);
    expect(promptsIssuedToSpawn[0]).toBe("# Persona v1");
    expect(promptsIssuedToSpawn[1]).toBe("# Persona v2");
    expect(promptsIssuedToSpawn[0]).not.toBe(promptsIssuedToSpawn[1]);
  });

  it("does not call buildPrompt on single-story that errors during claim (no spawn)", async () => {
    // AC2 guard: if claim fails, buildPrompt must NOT be called (no spawn).
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];
    let buildPromptCalled = false;

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async () => { throw new Error("SomeClaimError: claim failed"); },
        buildPrompt: async () => {
          buildPromptCalled = true;
          return { systemPrompt: "# Should not be called" };
        },
        taskSpawn: async () => {},
      },
    });

    expect(buildPromptCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1 — Exact chat-surface output lines (verbatim assertions)
// ---------------------------------------------------------------------------

describe("AC1 — exact chat-surface output lines", () => {
  it("prints 'spawning generalist-dev subagent (clean context)' verbatim", async () => {
    // AC1(b): "prints ... 'spawning generalist-dev subagent (clean context)'"
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async () => {},
      },
    });

    // Exact verbatim check — not just startsWith.
    expect(result.chatLog).toContain("spawning generalist-dev subagent (clean context)");
  });

  it("prints 'claiming <ref> — <title>' verbatim for each story", async () => {
    // AC1(b): "prints a per-claim line of shape 'claiming <ref> — <title>'"
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async () => {},
      },
    });

    // Exact verbatim match: "claiming <ref> — <title>"
    expect(result.chatLog).toContain(`claiming ${ref} — Story ${ref}`);
  });

  it("degrades to <title-unavailable> when title is absent", async () => {
    // AC1 + Behavioural contract: "if absent / unreadable, degrade to
    // 'claiming <ref> — <title-unavailable>' rather than failing the loop."
    const ref = "native:01HZABC0000000000000000001";
    const candidateNoTitle: ClaimableCandidate = {
      ref,
      title: undefined as unknown as string, // simulate absent title
      depends_on: [],
      depsReady: true,
    };

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos([candidateNoTitle], 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async () => {},
      },
    });

    expect(result.chatLog).toContain(`claiming ${ref} — <title-unavailable>`);
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
          return { systemPrompt: "# Fake Persona" };
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
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
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
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

  it("passes subagentType: 'general-purpose' on every spawn", async () => {
    const ref = "native:01HZABC0000000000000000001";
    const candidates: ClaimableCandidate[] = [makeFakeCandidate(ref)];
    const spawnRecords: SpawnRecord[] = [];

    await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        listTodos: makeFakeListTodos(candidates, 0),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async (args) => {
          spawnRecords.push({
            systemPrompt: args.systemPrompt,
            subagentType: args.subagentType,
            initialContext: args.initialContext,
          });
        },
      },
    });

    expect(spawnRecords.length).toBe(1);
    expect(spawnRecords[0]!.subagentType).toBe("general-purpose");
  });

  it("does NOT emit QUEUE_DRAINED_LINE when eligible todos is empty but in-progress > 0", async () => {
    // High 2 regression test: when eligible.length === 0 && inProgressCount > 0,
    // the verbatim queue-drained anchor must NOT be emitted.
    // Seed: one in-progress manifest on disk (for realism), no to-do manifests.
    const inProgressRef = "native:01HZABC0000000000000000001";
    await writeInProgressManifest(
      tmpRoot,
      inProgressRef,
      makeManifestYaml(inProgressRef, { status: "in-progress" }),
    );

    const result = await runStartLoop({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      deps: {
        // Return: no todos, but inProgressCount > 0
        listTodos: async () => ({ todos: [], inProgressCount: 1 }),
        claim: async (opts) => ({ ref: opts.ref, absPath: `/fake/${opts.ref}.yaml` }),
        buildPrompt: async () => ({ systemPrompt: "# Fake Persona" }),
        taskSpawn: async () => {},
      },
    });

    // The verbatim queue-drained anchor MUST NOT appear.
    expect(result.chatLog).not.toContain(QUEUE_DRAINED_LINE);

    // The verbatim waiting-on-in-progress anchor MUST appear.
    expect(result.chatLog).toContain(WAITING_ON_IN_PROGRESS_LINE);
  });
});
