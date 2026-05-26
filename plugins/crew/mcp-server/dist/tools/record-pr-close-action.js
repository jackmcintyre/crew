/**
 * `recordPrCloseAction` MCP tool — Story 4.12.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-12-per-invocation-telemetry-and-runtime-soft-hard-limits.md
 *
 * Writes a retroactive `reviewer.verdict.merge_action` event when a PR
 * that was reviewed by the agent is closed (merged, closed-without-merge,
 * or observed as still-open during a poll).
 *
 * Join key for Story 4.10's `compute-agreement` helper: `(pr_number, session_id)`.
 * The consumer joins `reviewer.verdict` + `reviewer.verdict.merge_action` on
 * this pair to compute the rolling agreement ratio.
 *
 * **No deduplication.** If called twice with the same `(prNumber, sessionUlid)`,
 * it writes twice. Dedup is the caller's responsibility (Story 5.3's polling
 * loop). Rationale: append-only JSONL semantics + downstream `compute-agreement`
 * (4.10) can pick the latest by `resolved_at` if needed; embedding a dedup index
 * here adds state we don't otherwise need.
 *
 * Story 4.12 (FR66).
 */
import { logTelemetryEvent } from "../lib/logger.js";
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * Write a `reviewer.verdict.merge_action` event to the current month's JSONL.
 *
 * @param opts.sessionUlid - ULID of the reviewer session (join key).
 * @param opts.storyId - Optional story ref.
 * @param opts.prNumber - GitHub PR number (join key).
 * @param opts.mergeAction - One of `"merged"`, `"closed-unmerged"`, `"still-open"`.
 * @param opts.resolvedAt - ISO-8601 UTC timestamp; defaults to `now()`.
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 *
 * Story 4.12 (FR66).
 */
export async function recordPrCloseAction(opts) {
    const now = opts.nowImpl ?? (() => new Date());
    const logEvent = opts.logTelemetryEventImpl ?? logTelemetryEvent;
    const resolvedAt = opts.resolvedAt ?? now().toISOString();
    await logEvent({
        targetRepoRoot: opts.targetRepoRoot,
        event: {
            type: "reviewer.verdict.merge_action",
            session_id: opts.sessionUlid,
            agent: "generalist-reviewer",
            ...(opts.storyId !== undefined ? { story_id: opts.storyId } : {}),
            data: {
                pr_number: opts.prNumber,
                merge_action: opts.mergeAction,
                resolved_at: resolvedAt,
            },
        },
    });
    return { kind: "ok" };
}
