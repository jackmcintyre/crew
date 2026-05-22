/**
 * `runStartLoop` — Story 4.2 Task 8, updated in Story 4.3 Task 4.
 *
 * The claim-spawn-terminate loop that the `/crew:start` SKILL.md skill prose
 * maps to. This function is plain TypeScript — no `console.log`, no LLM-side
 * state. Chat output flows through the returned `chatLog: string[]` array so
 * vitest integration tests can assert verbatim line presence without a Claude
 * Code harness.
 *
 * **Test seam:** production callers wire `listTodos`, `claim`, `buildPrompt`,
 * and `taskSpawnWithTranscript` to the real MCP tools and the real Claude Code
 * `Task` tool. Integration tests pass fakes for each dependency so the loop
 * body can be driven deterministically without a running Claude Code process.
 *
 * **Behavioural contract (from Story 4.2 § Behavioural contract):**
 * - Prints the session header BEFORE any loop iteration.
 * - MUST call `buildPrompt` once per spawn (never cache across spawns).
 * - MUST print the queue-drained line verbatim on the drain path.
 * - MUST NOT call `buildPrompt` or `claim` on the drain path.
 * - Surfaces typed errors verbatim as `<ErrorName>: <message>`.
 * - Iterates candidates in the stable ref-alphabetical order returned by
 *   `listTodos`.
 * - On each loop pass, skips refs where `depsReady: false` silently.
 * - Loops until both `todos` (depsReady=true) and `inProgressCount` are empty.
 *
 * Story 4.2 Task 8.1–8.4. Updated in Story 4.3 Task 4: `taskSpawn` (→ void)
 * replaced with `taskSpawnWithTranscript` (→ { transcript: string });
 * `processCandidate` delegates to `runDevReviewerCycle` for the inner
 * dev → reviewer → rework loop; `readManifest` and `writeManifest` seams
 * added to `RunStartLoopDeps` for manifest mutations within the inner cycle.
 */

import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { ClaimableCandidate, ListClaimableTodosResult } from "../tools/list-claimable-todos.js";
import { runDevReviewerCycle } from "./dev-reviewer-cycle.js";
import type { RunDevReviewerCycleDeps, TaskSpawnWithTranscriptArgs } from "./dev-reviewer-cycle.js";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import { promises as fs } from "node:fs";
import { parse as yamlParse } from "yaml";

/** Verbatim queue-drained line from AC3 / AC5(iv) — do not paraphrase. */
export const QUEUE_DRAINED_LINE =
  "queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.";

/** Verbatim waiting-on-in-progress line — emitted when todos exist but all are deps-blocked on active in-progress work. Do not paraphrase. */
export const WAITING_ON_IN_PROGRESS_LINE =
  "waiting on in-progress work — no claimable todos this pass. Stop here or wait for in-progress stories to complete.";

export interface TaskSpawnArgs {
  systemPrompt: string;
  subagentType: string;
  initialContext: {
    ref: string;
    title: string;
    sessionUlid: string;
    targetRepoRoot: string;
    manifestPath: string;
  };
}

export interface ClaimResult {
  ref: string;
  absPath: string;
}

export interface BuildPromptResult {
  systemPrompt: string;
}

export interface RunStartLoopDeps {
  /** Resolves the list of claimable todos and in-progress count. */
  listTodos: (opts: { targetRepoRoot: string }) => Promise<ListClaimableTodosResult>;
  /** Claims a story atomically. Throws typed errors on failure. */
  claim: (opts: {
    targetRepoRoot: string;
    ref: string;
    sessionUlid: string;
    role: string;
  }) => Promise<ClaimResult>;
  /** Assembles the system prompt for a role. One call per spawn. */
  buildPrompt: (opts: {
    targetRepoRoot: string;
    role: string;
  }) => Promise<BuildPromptResult>;
  /**
   * Invokes a subagent via the Task tool and returns its final-output
   * transcript. Replaces Story 4.2's `taskSpawn: () => Promise<void>`.
   * The inner cycle needs the transcript to parse the handoff phrase.
   */
  taskSpawnWithTranscript: (
    args: TaskSpawnWithTranscriptArgs,
  ) => Promise<{ transcript: string }>;
}

export interface RunStartLoopOptions {
  targetRepoRoot: string;
  sessionUlid: string;
  deps: RunStartLoopDeps;
}

export interface RunStartLoopResult {
  chatLog: string[];
}

/**
 * Run the `/crew:start` claim-spawn-terminate loop.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID minted once at invocation time; re-used for
 *   every `claimStory` call in this session.
 * @param opts.deps - Injectable dependencies (production or test fakes).
 * @returns `{ chatLog }` — ordered list of lines printed to chat. Callers
 *   (production) emit these to the operator. Tests assert against them.
 */
export async function runStartLoop(
  opts: RunStartLoopOptions,
): Promise<RunStartLoopResult> {
  const { targetRepoRoot, sessionUlid, deps } = opts;
  const chatLog: string[] = [];

  // Print session header.
  chatLog.push(
    `dev session — workspace: ${targetRepoRoot} — session: ${sessionUlid}`,
  );

  // Loop until the queue is drained.
  while (true) {
    const { todos, inProgressCount } = await deps.listTodos({ targetRepoRoot });

    // Filter to candidates that are deps-ready.
    const eligible = todos.filter((c) => c.depsReady);

    // Queue-drained check: no eligible candidates AND no in-progress.
    if (eligible.length === 0 && inProgressCount === 0) {
      chatLog.push(QUEUE_DRAINED_LINE);
      break;
    }

    // If there are no eligible todos but inProgress > 0, the session cannot
    // progress further (all remaining todos are deps-blocked on in-progress
    // work). Terminate without printing the queue-drained anchor — the
    // in-progress stories are still running, so the queue is NOT drained.
    if (eligible.length === 0) {
      // Deps-blocked with active in-progress work — cannot progress further this session.
      chatLog.push(WAITING_ON_IN_PROGRESS_LINE);
      break;
    }

    // Iterate eligible candidates in ref-alphabetical order (order preserved from listTodos).
    for (const candidate of eligible) {
      await processCandidate(candidate, { targetRepoRoot, sessionUlid, deps, chatLog });
    }
  }

  return { chatLog };
}

async function processCandidate(
  candidate: ClaimableCandidate,
  opts: {
    targetRepoRoot: string;
    sessionUlid: string;
    deps: RunStartLoopDeps;
    chatLog: string[];
  },
): Promise<void> {
  const { targetRepoRoot, sessionUlid, deps, chatLog } = opts;
  const { ref, title } = candidate;

  const displayTitle = title ?? "<title-unavailable>";

  // Print claiming line BEFORE claim call.
  chatLog.push(`claiming ${ref} — ${displayTitle}`);

  // Call claimStory. On any typed error, surface verbatim and continue.
  let claimResult: ClaimResult;
  try {
    claimResult = await deps.claim({
      targetRepoRoot,
      ref,
      sessionUlid,
      role: "orchestrator",
    });
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    chatLog.push(`${name}: ${message}`);
    return;
  }

  // Print spawning line BEFORE Task invocation.
  chatLog.push("spawning generalist-dev subagent (clean context)");

  // Derive manifest path (absolute — needed by the inner cycle).
  const manifestAbsPath = path.resolve(
    targetRepoRoot,
    ".crew",
    "state",
    "in-progress",
    `${ref}.yaml`,
  );

  // Build the inner-cycle deps from the outer deps.
  const cycleDeps: RunDevReviewerCycleDeps = {
    buildPrompt: async (o) =>
      deps.buildPrompt({ targetRepoRoot: o.targetRepoRoot, role: o.role }),
    taskSpawnWithTranscript: deps.taskSpawnWithTranscript,
    readManifest: async (absPath: string) => {
      const raw = await fs.readFile(absPath, "utf8");
      const parsed = yamlParse(raw) as unknown;
      return parseExecutionManifest(parsed, { absPath });
    },
    writeManifest: async (
      absPath: string,
      manifest: ExecutionManifest,
      _opts: { role: string },
    ) => {
      const yaml = yamlStringify(manifest, { lineWidth: 0 });
      await atomicWriteFile(absPath, yaml);
    },
  };

  // Delegate to the inner dev → reviewer cycle.
  try {
    const cycleResult = await runDevReviewerCycle({
      targetRepoRoot,
      sessionUlid,
      ref,
      title: displayTitle,
      manifestPath: manifestAbsPath,
      deps: cycleDeps,
    });
    // Append the inner cycle's chat lines to the outer log.
    chatLog.push(...cycleResult.chatLog);
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    chatLog.push(`${name}: ${message}`);
    // Don't rethrow — errors in the inner cycle should not abort the outer loop.
  }

  // Suppress unused variable warning for claimResult (used implicitly).
  void claimResult;
}
