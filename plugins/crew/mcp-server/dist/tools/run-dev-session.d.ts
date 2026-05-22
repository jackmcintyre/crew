/**
 * `runDevSession` MCP tool — Story 4.3 Task 6.
 *
 * Single MCP-tool entry point for the entire `/crew:start` loop body
 * (outer claim-loop + inner dev → reviewer → rework cycle). The SKILL.md
 * prose is reduced to three MCP calls: `getStatus` (preflight),
 * `mintSessionUlid` (session ID), and `runDevSession` (the bundled loop body).
 *
 * The tool internally wires `runStartLoop` and `runDevReviewerCycle` with
 * production dependencies:
 *   - `listClaimableTodos` — enumerate claimable to-do manifests.
 *   - `claimStory` — atomic claim.
 *   - `buildPersonaSpawnPrompt` — persona prompt assembly (dev + reviewer).
 *   - The Claude Code `Task` tool (wrapped to capture transcript text).
 *   - `parseExecutionManifest` / `atomicWriteFile` — manifest reads/writes.
 *
 * `buildPersonaSpawnPrompt` is NOT an allowed MCP tool for the subagents —
 * it is wrapped by `runDevSession`'s internals and is not invoked from
 * SKILL.md prose.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `runDevSession`.
 * Story 4.3 Task 6.2.
 */
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import type { TaskSpawnWithTranscriptArgs } from "../skills/dev-reviewer-cycle.js";
export interface RunDevSessionOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    /**
     * Injectable Task-spawn function for testing. In production, the Claude
     * Code harness provides this via the `Task` tool. Tests pass a fake.
     */
    taskSpawnWithTranscript?: (args: TaskSpawnWithTranscriptArgs) => Promise<{
        transcript: string;
    }>;
}
export interface RunDevSessionResult {
    chatLog: string[];
}
/**
 * Run the full `/crew:start` session: outer claim-loop + inner dev → reviewer
 * → rework cycle. Returns the complete `chatLog` for the operator to read.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repo.
 * @param opts.sessionUlid - ULID minted by `mintSessionUlid` before this call.
 * @param opts.taskSpawnWithTranscript - Optional injectable Task-spawn seam
 *   (production callers omit this; tests supply a fake).
 */
export declare function runDevSession(opts: RunDevSessionOptions): Promise<RunDevSessionResult>;
/**
 * Read and parse an execution manifest from disk.
 * Exported for use by `run-dev-session.test.ts` fixtures.
 */
export declare function readManifestFromDisk(absPath: string): Promise<ExecutionManifest>;
/**
 * Write an execution manifest back to disk atomically.
 * Exported for use by `run-dev-session.test.ts` fixtures.
 */
export declare function writeManifestToDisk(absPath: string, manifest: ExecutionManifest): Promise<void>;
