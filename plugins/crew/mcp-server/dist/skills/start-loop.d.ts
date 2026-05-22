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
import type { ListClaimableTodosResult } from "../tools/list-claimable-todos.js";
import type { TaskSpawnWithTranscriptArgs } from "./dev-reviewer-cycle.js";
/** Verbatim queue-drained line from AC3 / AC5(iv) — do not paraphrase. */
export declare const QUEUE_DRAINED_LINE = "queue drained \u2014 to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.";
/** Verbatim waiting-on-in-progress line — emitted when todos exist but all are deps-blocked on active in-progress work. Do not paraphrase. */
export declare const WAITING_ON_IN_PROGRESS_LINE = "waiting on in-progress work \u2014 no claimable todos this pass. Stop here or wait for in-progress stories to complete.";
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
    listTodos: (opts: {
        targetRepoRoot: string;
    }) => Promise<ListClaimableTodosResult>;
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
    taskSpawnWithTranscript: (args: TaskSpawnWithTranscriptArgs) => Promise<{
        transcript: string;
    }>;
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
export declare function runStartLoop(opts: RunStartLoopOptions): Promise<RunStartLoopResult>;
