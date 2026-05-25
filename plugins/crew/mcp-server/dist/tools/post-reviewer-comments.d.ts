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
/**
 * Story 4.12 NFR2: reviewer subagent wall-clock hard limit. When the
 * elapsed time exceeds this, `postReviewerComments` substitutes the
 * verdict body with a timeout failure and emits the `reviewer-timeout`
 * return branch.
 */
export declare const REVIEWER_HARD_LIMIT_MS: number;
export type PostReviewerCommentsResult = {
    /** File was absent — no verdict to post. processReviewerTranscript handles it. */
    next: "skipped-no-session-result";
    postedReviewId: null;
    chatLog?: string[];
} | {
    /** Review successfully posted (first run) or PATCH-edited in place (rerun). */
    next: "posted";
    postedReviewId: number;
    /**
     * Number of inline comments submitted on POST. `null` on PATCH path —
     * signals "unknown / unchanged from prior pass", not zero.
     */
    inlineCommentCount: number | null;
    verdictLine: string;
    /** True when the prior verdict was PATCH-edited in place; false on first POST. */
    wasEdit: boolean;
    /** ID of the prior verdict review that was PATCH-edited. null on POST path. */
    priorReviewId: number | null;
    chatLog?: string[];
} | {
    /**
     * Story 4.12 AC3: the reviewer subagent exceeded the 8-min hard limit;
     * the verdict body was substituted with a timeout failure comment.
     * No `reviewer.verdict` telemetry is written on this branch.
     */
    next: "reviewer-timeout";
    postedReviewId: number;
    verdictLine: string;
    elapsedMs: number;
    chatLog?: string[];
};
export interface PostReviewerCommentsOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    role?: string;
    /** Test seam — production callers do not pass this. */
    execaImpl?: typeof defaultExeca;
    /** Plugin root override — test seam for loadRolePermissions. */
    pluginRootOverride?: string;
    /**
     * Test seam for the plugin version string. Uses `getPluginVersion()` when absent.
     * Named with `Override` suffix per project conventions (cf. `pluginRootOverride`).
     */
    pluginVersionOverride?: string;
    /**
     * Epoch ms at which the reviewer subagent was spawned. Used by the
     * 8-min hard-limit pre-check (Story 4.12 AC3 / NFR2). Optional for
     * backward compatibility — when absent, no timeout check is performed.
     */
    spawnStartedAt?: number;
    /** Test seam for the wall-clock. Story 4.12. */
    now?: () => number;
}
/**
 * Post the reviewer's verdict as a PR review with inline comments and a
 * summary body. Reads `reviewer-result.json` and composes everything
 * deterministically — no LLM step in the composition path.
 *
 * On rerun: GETs existing reviews, searches for a prior verdict footer marker,
 * and PATCH-edits the prior review body in place instead of posting a duplicate.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling reviewer session.
 * @param opts.role - Role name for gh permission lookup (default: "generalist-reviewer").
 * @param opts.execaImpl - Test seam for execa.
 * @param opts.pluginRootOverride - Test seam for plugin root path.
 * @param opts.pluginVersionOverride - Test seam for plugin version string.
 */
export declare function postReviewerComments(opts: PostReviewerCommentsOptions): Promise<PostReviewerCommentsResult>;
