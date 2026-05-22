/**
 * `processReviewerTranscript` MCP tool — Story 4.3b Task 3.
 *
 * Pure transcript-in / verdict-out function: receives the reviewer subagent's
 * final transcript (captured by the SKILL.md prose after the `Task` tool
 * returns), parses the verdict sentinel, mutates the in-progress manifest on
 * rework or grammar drift, and returns the next step for the prose layer.
 *
 * **Behavioural contract source:**
 * `_bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract`
 *
 * This tool MUST NOT spawn anything. The MCP server runs over JSON-RPC stdio
 * and has no access to Claude Code's `Task` tool. Spawn responsibility belongs
 * exclusively to the SKILL.md prose layer.
 *
 * Chat lines flow through the returned `chatLog: string[]` — no console.*.
 * Errors propagate as typed `DomainError`s; `register.ts` wraps them.
 *
 * Story 4.3b Task 3.1–3.5.
 */
export type ProcessReviewerTranscriptResult = {
    next: "rework-dev";
    devPrompt: string;
    reworkIteration: number;
    chatLog: string[];
} | {
    next: "done-ready-for-merge";
    chatLog: string[];
} | {
    next: "done-blocked-reviewer-verdict";
    chatLog: string[];
} | {
    next: "done-blocked-reviewer-grammar";
    chatLog: string[];
};
export interface ProcessReviewerTranscriptOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    manifestPath: string;
    reviewerTranscript: string;
}
/**
 * Process the reviewer subagent's final transcript.
 *
 * Calls `parseVerdict` exactly once. On grammar drift: stamps
 * `blocked_by: "reviewer-grammar"` on the in-progress manifest. On
 * `NEEDS CHANGES`: increments `rework_count`, writes to disk BEFORE composing
 * the dev re-spawn prompt, then returns the next dev prompt. On `READY FOR
 * MERGE` or `BLOCKED`: pass-through (no manifest mutation).
 *
 * The SKILL.md prose MUST pass `reviewerTranscript` verbatim — no
 * summarisation, no editing. The full final-message string is the contract.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.manifestPath - Absolute path to the in-progress manifest.
 * @param opts.reviewerTranscript - The reviewer subagent's complete final message, verbatim.
 */
export declare function processReviewerTranscript(opts: ProcessReviewerTranscriptOptions): Promise<ProcessReviewerTranscriptResult>;
