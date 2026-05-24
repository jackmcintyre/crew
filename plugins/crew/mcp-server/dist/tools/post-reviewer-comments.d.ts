/**
 * `postReviewerComments` MCP tool — Story 4.6b.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-6b-reviewer-posts-inline-comments-and-summary-verdict.md
 *
 * Reads the persisted `reviewer-result.json` written by `runReviewerSession`,
 * composes a deterministic PR review summary body plus zero-or-more inline
 * comments, and posts them as a single PR review via `gh api` with event: COMMENT.
 *
 * The reviewer LLM's chat output is NOT consulted — the entire composition path
 * is: `reviewer-result.json` → pure composer functions → `gh api` POST.
 *
 * Invoked from SKILL.md prose AFTER the reviewer Task returns and BEFORE
 * `processReviewerTranscript` runs. It is a sibling of `processReviewerTranscript`,
 * not a wrapper.
 *
 * On ENOENT for `reviewer-result.json`: returns
 *   `{ next: "skipped-no-session-result", postedReviewId: null }` silently
 *   (the loud blocker is `processReviewerTranscript`'s job downstream).
 *
 * On malformed JSON / invalid shape: propagates `ReviewerResultFileMalformedError`.
 * On `GhRecoverableError`, `GhApiResponseShapeError`, `GhSubcommandDeniedError`:
 * propagates verbatim (no retry, no swallow).
 *
 * TODO(4.12): wire `reviewer.comments_posted` telemetry event here.
 *
 * Story 4.6b Task 4.
 */
import { execa as defaultExeca } from "execa";
export type PostReviewerCommentsResult = {
    /** File was absent — no verdict to post. processReviewerTranscript handles it. */
    next: "skipped-no-session-result";
    postedReviewId: null;
} | {
    /** Review successfully posted to GitHub. */
    next: "posted";
    postedReviewId: number;
    inlineCommentCount: number;
    verdictLine: string;
};
export interface PostReviewerCommentsOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    role?: string;
    /** Test seam — production callers do not pass this. */
    execaImpl?: typeof defaultExeca;
    /** Plugin root override — test seam for loadRolePermissions. */
    pluginRootOverride?: string;
}
/**
 * Post the reviewer's verdict as a PR review with inline comments and a
 * summary body. Reads `reviewer-result.json` and composes everything
 * deterministically — no LLM step in the composition path.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling reviewer session.
 * @param opts.role - Role name for gh permission lookup (default: "generalist-reviewer").
 * @param opts.execaImpl - Test seam for execa.
 * @param opts.pluginRootOverride - Test seam for plugin root path.
 */
export declare function postReviewerComments(opts: PostReviewerCommentsOptions): Promise<PostReviewerCommentsResult>;
