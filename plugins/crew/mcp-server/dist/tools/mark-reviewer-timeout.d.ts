/**
 * `markReviewerTimeout` MCP tool — Story 4.12 (NFR2 / AC3).
 *
 * Stamps `blocked_by: "reviewer-timeout"` on the in-progress manifest
 * after `postReviewerComments` returned `next: "reviewer-timeout"`. The
 * SKILL.md prose calls this best-effort; if the manifest is missing,
 * the tool returns `{ next: "manifest-missing" }` without throwing.
 *
 * The GitHub-side `needs-human` label is the primary signal; this stamp
 * is a diagnostic for the next operator pass.
 */
export interface MarkReviewerTimeoutOpts {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    manifestPath: string;
}
export type MarkReviewerTimeoutResult = {
    next: "stamped";
    chatLog: string[];
} | {
    next: "manifest-missing";
    chatLog: string[];
};
export declare function markReviewerTimeout(opts: MarkReviewerTimeoutOpts): Promise<MarkReviewerTimeoutResult>;
