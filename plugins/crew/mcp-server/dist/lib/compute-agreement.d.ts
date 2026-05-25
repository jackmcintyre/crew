/**
 * Pure agreement-ratio helper for the auto-merge gate (Story 4.10 /
 * FR67 / NFR24).
 *
 * Scans `<targetRepoRoot>/.crew/telemetry/<YYYY-MM>.jsonl`, reads every
 * `reviewer.verdict` event, filters to those with a resolved
 * `eventual_merge_action`, takes the trailing `lastNVerdicts` slice, and
 * reports the agreement ratio between the verdict and the eventual
 * action.
 *
 * Writer/reader split mirrors `lib/team-stats.ts` (the v1 template
 * named in its own docstring): same readdir try-block, same per-line
 * parse loop, same malformed-line tolerance, same private `isEnoent`
 * helper. The two files are intentionally parallel.
 *
 * Returns `null` when the window cannot be filled (no telemetry
 * directory, no resolved events, fewer resolved events than the window
 * size). Callers (the auto-merge gate) treat `null` as "fail closed —
 * insufficient data, do not auto-merge".
 *
 * No writes. No network IO. No `execa`. No clock dependency.
 */
export interface AgreementMetric {
    /** agreementCount / windowSize, in [0, 1]. */
    ratio: number;
    /** Count of resolved verdicts that agreed with the eventual action. */
    agreementCount: number;
    /** Equals the resolved `lastNVerdicts` parameter exactly. */
    windowSize: number;
    /** Per-verdict-kind counts within the window. Sums to `windowSize`. */
    distribution: {
        READY_FOR_MERGE: number;
        NEEDS_CHANGES: number;
        BLOCKED: number;
    };
    /** Total JSONL lines that failed JSON.parse or Zod validation. */
    malformedLines: number;
    /** Count of files that contained ≥1 malformed line. */
    malformedFiles: number;
}
/**
 * Compute the reviewer-vs-eventual-action agreement ratio over the
 * trailing `lastNVerdicts` resolved `reviewer.verdict` events on disk.
 *
 * Returns `null` when:
 *  - Telemetry directory missing.
 *  - Telemetry directory present but no `^\d{4}-\d{2}\.jsonl$` files.
 *  - No valid `reviewer.verdict` events on disk.
 *  - All `reviewer.verdict` events are unresolved (`eventual_merge_action: null`).
 *  - Resolved events exist but fewer than `lastNVerdicts`.
 *
 * Iteration order is lexicographic across files (so `2026-04.jsonl` <
 * `2026-05.jsonl`) and append-order within files. The "trailing N"
 * slice is taken after filtering to resolved events — unresolved events
 * are excluded entirely, not just elided from the window.
 *
 * Malformed lines do NOT abort the run; they are counted and surfaced.
 * Genuine filesystem errors (e.g. EACCES on a file mid-read) propagate
 * uncaught — they indicate environmental failure, not data corruption.
 */
export declare function computeAgreement(opts: {
    targetRepoRoot: string;
    lastNVerdicts?: number;
}): Promise<AgreementMetric | null>;
