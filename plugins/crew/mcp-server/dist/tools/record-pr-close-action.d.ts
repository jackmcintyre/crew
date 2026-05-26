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
import { type LogTelemetryEventOpts } from "../lib/logger.js";
/**
 * Options for `recordPrCloseAction`.
 *
 * Join key for `compute-agreement` (Story 4.10): `(prNumber, sessionUlid)`.
 * The join key is documented here so future-4.10 implementors can locate it
 * without tracing the call graph.
 */
export interface RecordPrCloseActionOpts {
    /**
     * ULID of the reviewer session that posted the original `reviewer.verdict` event.
     * Join key: `session_id` on the `reviewer.verdict` event in the JSONL.
     */
    sessionUlid: string;
    /** Optional story ref (adapter:id). */
    storyId?: string;
    /**
     * GitHub PR number. Join key: `data.pr_number` on the `reviewer.verdict` event.
     */
    prNumber: number;
    /**
     * The observed merge action for this PR.
     * - `"merged"`: PR was squash- or rebase-merged.
     * - `"closed-unmerged"`: PR was closed without merging.
     * - `"still-open"`: PR is still open at poll time (may be resolved later).
     */
    mergeAction: "merged" | "closed-unmerged" | "still-open";
    /**
     * ISO-8601 UTC timestamp of when the action was observed.
     * Defaults to `new Date().toISOString()`.
     */
    resolvedAt?: string;
    targetRepoRoot: string;
    /**
     * Test seam: override the current time for `resolvedAt` defaulting.
     * Production callers do not pass this.
     */
    nowImpl?: () => Date;
    /**
     * Test seam: inject a fake `logTelemetryEvent` implementation.
     * Production callers do not pass this.
     */
    logTelemetryEventImpl?: (opts: LogTelemetryEventOpts) => Promise<void>;
}
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
export declare function recordPrCloseAction(opts: RecordPrCloseActionOpts): Promise<{
    kind: "ok";
}>;
