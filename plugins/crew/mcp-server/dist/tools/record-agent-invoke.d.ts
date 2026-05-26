/**
 * `recordAgentInvoke` MCP tool — Story 4.12.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-12-per-invocation-telemetry-and-runtime-soft-hard-limits.md
 *
 * Single entrypoint for the dev session to record a completed agent-subagent
 * invocation. Emits an `agent.invoke` telemetry event and enforces two runtime
 * caps:
 *
 *   1. **8-min reviewer hard cap (NFR2):** when `agent === "generalist-reviewer"`
 *      and `runtimeMs > REVIEWER_HARD_CAP_MS`, substitutes the verdict comment
 *      via `postReviewerComments` (which owns the `reviewer.verdict` emission
 *      seam), applies `needs-human` via `applyReviewerLabels`, and returns
 *      `{ kind: "reviewer-timed-out" }`. The story is NOT marked failed.
 *
 *   2. **30-min dev budget (NFR3):** when `agent === "generalist-dev"` and
 *      `storyId !== undefined`, reads the current month's JSONL to compute
 *      cumulative dev runtime for this story. On first crossing of
 *      `DEV_BUDGET_MS`, emits a `dev.budget_exceeded` event and returns
 *      `{ kind: "dev-budget-exceeded" }`.
 *
 * The SKILL.md prose caller (dev session) is responsible for capturing
 * `startedAt` before the Task-tool spawn and `completedAt` after it returns.
 * The MCP layer cannot observe the spawn directly.
 *
 * `recordAgentInvoke` does NOT emit `reviewer.verdict` directly — that event
 * is owned exclusively by `postReviewerComments`'s POST-success path. The
 * 8-min substitution path calls `postReviewerComments` with overrides, and
 * `postReviewerComments` emits the event with `verdict: "reviewer-failure"` and
 * `timed_out: true`.
 *
 * Story 4.12 (FR65, NFR2, NFR3).
 */
import { type LogTelemetryEventOpts } from "../lib/logger.js";
import { type PostReviewerCommentsOptions } from "./post-reviewer-comments.js";
import { type ApplyReviewerLabelsOptions } from "./apply-reviewer-labels.js";
export type RecordAgentInvokeResult = {
    kind: "ok";
} | {
    kind: "reviewer-timed-out";
    substitutedCommentUrl: string;
    labelsApplied: string[];
} | {
    kind: "dev-budget-exceeded";
    cumulativeRuntimeMs: number;
    budgetMs: number;
};
export interface RecordAgentInvokeOpts {
    sessionUlid: string;
    agent: string;
    storyId?: string;
    startedAt: string;
    completedAt: string;
    tokensIn?: number;
    tokensOut?: number;
    targetRepoRoot: string;
    /**
     * Test seam: inject a fake `postReviewerComments` implementation.
     * Production callers do not pass this.
     */
    postReviewerCommentsImpl?: (opts: PostReviewerCommentsOptions) => Promise<{
        next: string;
        url?: string;
        labelsApplied?: string[];
    }>;
    /**
     * Test seam: inject a fake `applyReviewerLabels` implementation.
     * Production callers do not pass this.
     */
    applyReviewerLabelsImpl?: (opts: ApplyReviewerLabelsOptions) => Promise<{
        next: string;
        labelsApplied?: string[];
    }>;
    /**
     * Test seam: override the current time. Used by tests that control the
     * JSONL file path (month bucket) without relying on wall-clock.
     */
    nowImpl?: () => Date;
    /**
     * Test seam: inject a fake JSONL reader for the cumulative-dev-budget check.
     * Receives the JSONL file path and returns its raw contents (or empty string
     * on ENOENT). Production callers do not pass this.
     */
    readCurrentMonthJsonlImpl?: (filePath: string) => Promise<string>;
    /**
     * Test seam: inject a fake `logTelemetryEvent` implementation.
     * Production callers do not pass this.
     */
    logTelemetryEventImpl?: (opts: LogTelemetryEventOpts) => Promise<void>;
}
/**
 * Record a completed agent-subagent invocation and enforce runtime caps.
 *
 * @param opts.sessionUlid - ULID of the calling session.
 * @param opts.agent - Kebab-cased role name (e.g. `generalist-dev`).
 * @param opts.storyId - Optional story ref (adapter:id). Required for dev budget tracking.
 * @param opts.startedAt - ISO-8601 UTC timestamp captured before Task-tool spawn.
 * @param opts.completedAt - ISO-8601 UTC timestamp captured after Task-tool returns.
 * @param opts.tokensIn - Optional input token count (if available from host).
 * @param opts.tokensOut - Optional output token count (if available from host).
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 *
 * Story 4.12 (FR65, NFR2, NFR3).
 */
export declare function recordAgentInvoke(opts: RecordAgentInvokeOpts): Promise<RecordAgentInvokeResult>;
