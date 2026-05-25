/**
 * `processReviewerTranscript` MCP tool — Story 4.3b Task 3; Story 4.3c Task 2;
 * **Story 4.6 revision 2 (deterministic-verdict-transport).**
 *
 * **Revision 2 architectural change (Story 4.6 revision 2):**
 * The `reviewerTranscript` parameter has been DROPPED. The reviewer's chat is
 * no longer the load-bearing verdict transport. Instead, this tool reads the
 * persisted `reviewer-result.json` file written by `runReviewerSession` and
 * switches on its `recommendedVerdict` field.
 *
 * Migration from revision 1:
 *  - `reviewerTranscript` parameter removed from `ProcessReviewerTranscriptOptions`.
 *  - `done-blocked-reviewer-verdict` and `done-blocked-reviewer-grammar` result
 *    variants DELETED — no backward-compat path. `runReviewerSession` is now the
 *    ONLY valid reviewer entrypoint; these variants are structurally subsumed by
 *    the new variants below.
 *  - New variants added: `done-blocked-reviewer-needs-changes`,
 *    `done-blocked-reviewer-blocked`, `done-blocked-no-session-result`.
 *  - `import { parseVerdict }` removed (no callers after revision 2).
 *
 * **New input shape:** `{ targetRepoRoot, sessionUlid, ref, manifestPath }`
 * **File path read:** `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`
 *
 * **Result routing:**
 *  - `recommendedVerdict === "READY FOR MERGE"` → calls `completeStory` internally,
 *    returns `done-ready-for-merge` with `completed: true`. (4.3c semantics preserved.)
 *  - `recommendedVerdict === "NEEDS CHANGES"` → stamps `blocked_by: "reviewer-verdict-needs-changes"`,
 *    returns `done-blocked-reviewer-needs-changes`.
 *  - `recommendedVerdict === "BLOCKED"` → stamps `blocked_by: "reviewer-verdict-blocked"`,
 *    returns `done-blocked-reviewer-blocked`.
 *  - File absent (ENOENT) → stamps `blocked_by: "reviewer-no-session-result"`,
 *    returns `done-blocked-no-session-result`. This is the rubber-stamp protection:
 *    if the reviewer subagent skipped `runReviewerSession`, the operator sees a
 *    loud blocker rather than a silent rubber-stamp.
 *  - File present but malformed/invalid → throws `ReviewerResultFileMalformedError`.
 *
 * **Behavioural contract sources:**
 * `_bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract`
 * `_bmad-output/implementation-artifacts/4-3c-call-completestory-after-ready-for-merge.md § Behavioural contract`
 * `_bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md § Task 8b`
 *
 * On `READY FOR MERGE`: calls `completeStory` internally (via direct function
 * import from `./complete-story.js`) to atomically move the manifest to `done/`
 * BEFORE returning. The `completeStory` call is NOT made through the MCP
 * `register.ts` surface — it is a plain Node import.
 *
 * This tool MUST NOT spawn anything. The MCP server runs over JSON-RPC stdio
 * and has no access to Claude Code's `Task` tool. Spawn responsibility belongs
 * exclusively to the SKILL.md prose layer.
 *
 * Chat lines flow through the returned `chatLog: string[]` — no console.*.
 * Errors propagate as typed `DomainError`s; `register.ts` wraps them.
 *
 * Story 4.3b Task 3.1–3.5; Story 4.3c Task 2.1–2.7; Story 4.6 Task 8b.
 */
export type ProcessReviewerTranscriptResult = {
    next: "done-ready-for-merge";
    completed: true;
    chatLog: string[];
} | {
    /** Reviewer's `runReviewerSession` found one or more failing ACs. Dev must iterate. */
    next: "done-blocked-reviewer-needs-changes";
    chatLog: string[];
} | {
    /** Reviewer's `runReviewerSession` returned BLOCKED (empty ACs or manual-check-required). */
    next: "done-blocked-reviewer-blocked";
    chatLog: string[];
} | {
    /**
     * `reviewer-result.json` was absent — the reviewer subagent skipped the
     * mandatory `runReviewerSession` call. Rubber-stamp protection.
     */
    next: "done-blocked-no-session-result";
    chatLog: string[];
} | {
    /** Story 4.12 AC6: reviewer transcript contained session-quota string. */
    next: "done-blocked-session-quota-exhausted";
    chatLog: string[];
};
export interface ProcessReviewerTranscriptOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    manifestPath: string;
    /** Epoch ms — when the reviewer subagent was spawned (Story 4.12 AC1). */
    spawnStartedAt?: number;
    /** Test seam — production callers omit. Story 4.12. */
    now?: () => number;
    /**
     * Optional reviewer subagent transcript. When provided and matching the
     * session-quota pattern, classifies as `SessionQuotaExhaustedError`
     * (Story 4.12 AC6).
     */
    reviewerTranscript?: string;
}
/**
 * Process the reviewer subagent's session result.
 *
 * **Revision 2:** reads `reviewer-result.json` from
 * `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`
 * and switches on its `recommendedVerdict` field. The reviewer's chat
 * transcript is no longer consulted.
 *
 * - Missing file → stamps `blocked_by: "reviewer-no-session-result"`, returns
 *   `done-blocked-no-session-result`. The reviewer skipped `runReviewerSession`.
 * - `recommendedVerdict === "READY FOR MERGE"` → calls `completeStory` internally;
 *   manifest moves to `done/`; returns `done-ready-for-merge` with `completed: true`.
 * - `recommendedVerdict === "NEEDS CHANGES"` → stamps `blocked_by: "reviewer-verdict-needs-changes"`;
 *   returns `done-blocked-reviewer-needs-changes`.
 * - `recommendedVerdict === "BLOCKED"` → stamps `blocked_by: "reviewer-verdict-blocked"`;
 *   returns `done-blocked-reviewer-blocked`.
 *
 * The `completeStory` call errors (`InProgressHandEditError`, `WrongClaimantError`,
 * `ManifestNotFoundError`) propagate verbatim — no catch, no wrap. The
 * `register.ts` `DomainError` → `isError: true` path handles serialisation.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.manifestPath - Absolute path to the in-progress manifest.
 */
export declare function processReviewerTranscript(opts: ProcessReviewerTranscriptOptions): Promise<ProcessReviewerTranscriptResult>;
