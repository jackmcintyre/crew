/**
 * Dev → reviewer inner cycle — Story 4.3 Task 3.
 *
 * Orchestrates the inner loop of the `/crew:start` session:
 *   dev spawn → handoff parse → reviewer spawn → verdict parse →
 *   (rework | continue | blocked)
 *
 * **Behavioural contract source:**
 * `_bmad-output/implementation-artifacts/4-3-dev-reviewer-handoff-reviewer-spawn-and-rework-signal.md § Behavioural contract`
 *
 * Chat output flows through the returned `chatLog: string[]` — no console.*.
 * Errors propagate to the caller; `runStartLoop` surfaces them verbatim.
 *
 * The rework loop is implemented as a `while` loop (not recursion) with no
 * artificial iteration cap — see § does NOT (j) in the story spec.
 *
 * Story 4.3 Task 3.1–3.5.
 */
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
export interface TaskSpawnWithTranscriptArgs {
    systemPrompt: string;
    subagentType: string;
    initialContext: Record<string, unknown>;
}
export interface RunDevReviewerCycleDeps {
    /** Assemble the system prompt for a role. Called once per spawn. */
    buildPrompt: (opts: {
        targetRepoRoot: string;
        role: "generalist-dev" | "generalist-reviewer";
    }) => Promise<{
        systemPrompt: string;
    }>;
    /** Spawn a subagent via the Task tool and return its transcript. */
    taskSpawnWithTranscript: (args: TaskSpawnWithTranscriptArgs) => Promise<{
        transcript: string;
    }>;
    /** Read and parse the in-progress manifest at `absPath`. */
    readManifest: (absPath: string) => Promise<ExecutionManifest>;
    /** Write the updated manifest back to `absPath`. */
    writeManifest: (absPath: string, manifest: ExecutionManifest, opts: {
        role: string;
    }) => Promise<void>;
}
export interface RunDevReviewerCycleOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    title: string;
    /** Absolute path to the in-progress manifest file. */
    manifestPath: string;
    deps: RunDevReviewerCycleDeps;
}
export type RunDevReviewerCycleFinalState = "ready-for-merge" | "needs-changes-resolved" | "blocked-handoff-grammar" | "blocked-reviewer-grammar" | "blocked-reviewer-verdict";
export interface RunDevReviewerCycleResult {
    chatLog: string[];
    finalState: RunDevReviewerCycleFinalState;
}
/**
 * Run the dev → reviewer inner cycle for a single story ref.
 *
 * The function spawns the dev subagent, parses its handoff phrase, spawns the
 * reviewer, parses the verdict, and handles the three outcome branches:
 * `READY FOR MERGE`, `NEEDS CHANGES` (rework), and `BLOCKED`.
 *
 * If either parser detects grammar drift, the in-progress manifest is stamped
 * with `blocked_by` and the function returns without spawning further.
 */
export declare function runDevReviewerCycle(opts: RunDevReviewerCycleOptions): Promise<RunDevReviewerCycleResult>;
