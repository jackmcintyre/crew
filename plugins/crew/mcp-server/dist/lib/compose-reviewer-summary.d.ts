/**
 * Pure helpers for composing the PR review summary body and verdict line
 * from a persisted `reviewer-result.json` file.
 *
 * Both `composeSummaryBody` and `composeVerdictLine` are pure functions:
 * no I/O, no Date.now(), no env reads. Inputs are the parsed file shape only.
 *
 * The verdict line grammar is the load-bearing contract from Story 4.6b AC2:
 *   - "READY FOR MERGE"  → `**Verdict: READY FOR MERGE**`
 *   - "NEEDS CHANGES"    → `**Verdict: NEEDS CHANGES** [N issues, M questions]`
 *   - "BLOCKED"          → `**Verdict: BLOCKED** [no ACs declared | manual checks required]`
 *
 * Any other state throws `UnreachableBlockedReasonError` to prevent fabricating
 * an unknown reason string.
 *
 * Story 4.6b Task 3.1–3.2
 */
import type { ReviewerResultFileShape } from "./read-reviewer-result-file.js";
/**
 * Compose the single load-bearing verdict line from the persisted result.
 * Follows the closed table from Story 4.6b spec §2e.
 *
 * Throws `UnreachableBlockedReasonError` if `recommendedVerdict` is "BLOCKED"
 * but `acResults` is neither empty nor contains a `manual-check-required` entry —
 * indicating an out-of-band mutation of the persisted file.
 */
export declare function composeVerdictLine(result: ReviewerResultFileShape): string;
export interface ComposeSummaryBodyVersionInfo {
    /** Semver version of the standards doc used to produce this verdict. */
    standardsVersion: string;
    /** Semver version of the crew plugin (from getPluginVersion()). */
    pluginVersion: string;
}
/**
 * Compose the full PR review summary body from the persisted result.
 *
 * Body skeleton (Story 4.6b spec §2a, extended by Story 4.7):
 *   # Reviewer summary — ${ref}
 *   ## Acceptance criteria
 *   <per-AC lines>
 *   ## Standards check
 *   <per-criterion lines>
 *   [## Manual checks required before merge]  (only if any manual-check-required ACs)
 *   <verdict line>
 *
 *   `standards_version: <standardsVersion>` · `plugin_version: <pluginVersion>`
 *   <!-- crew:verdict:<pluginVersion>:<ref> -->
 *
 * The footer marker is the absolute last line (no trailing newline).
 */
export declare function composeSummaryBody(result: ReviewerResultFileShape, versionInfo: ComposeSummaryBodyVersionInfo): string;
