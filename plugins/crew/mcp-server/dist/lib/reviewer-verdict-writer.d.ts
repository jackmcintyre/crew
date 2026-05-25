/**
 * `reviewer.verdict` telemetry writer — Story 4.12 (FR66).
 *
 * Centralised constructor + logTelemetryEvent caller for the
 * `reviewer.verdict` event shape (Story 4.10 schema).
 *
 * `eventual_merge_action` is always `null` at verdict-post time —
 * the deferred backfill loop will resolve it once the PR closes.
 */
export interface WriteReviewerVerdictEventOpts {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    prNumber: number;
    verdict: "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED";
    standardsVersion: string;
    pluginVersion: string;
    /** Test seam. */
    now?: () => Date;
}
export declare function writeReviewerVerdictEvent(opts: WriteReviewerVerdictEventOpts): Promise<void>;
