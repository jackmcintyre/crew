/**
 * `processDevTranscript` MCP tool — Story 4.3b Task 2.
 *
 * Pure transcript-in / verdict-out function: receives the dev subagent's final
 * transcript (captured by the SKILL.md prose after the `Task` tool returns),
 * parses the handoff phrase, mutates the in-progress manifest on grammar drift,
 * and returns the next step for the prose layer.
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
 * Story 4.3b Task 2.1–2.5.
 */
export type ProcessDevTranscriptResult = {
    next: "spawn-reviewer";
    reviewerPrompt: string;
    chatLog: string[];
} | {
    next: "done-blocked-handoff-grammar";
    chatLog: string[];
} | {
    next: "done-handoff-but-no-review-yet";
    chatLog: string[];
};
export interface ProcessDevTranscriptOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    devTranscript: string;
}
/**
 * Process the dev subagent's final transcript.
 *
 * Calls `parseHandoff` exactly once. On grammar drift: stamps `blocked_by:
 * "handoff-grammar"` on the in-progress manifest. On success: calls
 * `buildPersonaSpawnPrompt` for the reviewer and returns the prompt.
 *
 * The SKILL.md prose MUST pass `devTranscript` verbatim — no summarisation,
 * no editing, no extraction. The full final-message string is the contract.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.devTranscript - The dev subagent's complete final message, verbatim.
 */
export declare function processDevTranscript(opts: ProcessDevTranscriptOptions): Promise<ProcessDevTranscriptResult>;
