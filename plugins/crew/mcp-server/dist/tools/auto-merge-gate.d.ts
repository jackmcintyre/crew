/**
 * `runAutoMergeGate` MCP tool — Story 4.10b.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-10b-auto-merge-gate-medium-high-pause-and-user-override.md
 *
 * Decides, for a just-completed reviewer run on a `READY FOR MERGE`
 * verdict, whether to auto-merge the PR (`gh pr merge --squash --delete-branch`)
 * or pause it with the `needs-human` label.
 *
 * Composes:
 *   - `readReviewerResultFile`        (Story 4.6)
 *   - `resolveWorkspace`              (Story 1.2 — for `plugin.agreement_threshold`)
 *   - `computeAgreement` (lib)        (Story 4.10 — agreement metric)
 *   - `loadRolePermissions` + `gh`    (Story 4.8 — gh wrapper pattern)
 *
 * Lineage:
 *   - 4.9b: `riskTier` field on `ReviewerResultFileShape`.
 *   - 4.10: `computeAgreement` agreement-ratio helper.
 *   - 4.8:  pause-path label-apply pattern (`gh pr view --json headRepository,
 *           headRepositoryOwner` → `gh api POST /repos/{owner}/{repo}/issues/{n}/labels`).
 *
 * Decision algorithm (AC1 unpacked 1b):
 *   1. reviewer-result.json absent           → skipped-no-session-result
 *   2. verdict !== READY FOR MERGE           → skipped-not-ready-for-merge
 *   3. AC6: any finding severity in {medium,high} AND no overrideToken
 *                                            → paused-residual-medium-or-higher
 *   4. riskTier === undefined                → paused-missing-risk-tier
 *   5. riskTier === "medium"                 → paused-medium
 *   6. riskTier === "high"                   → paused-high
 *   7. riskTier === "low":
 *      a. metric === null                    → paused-insufficient-data
 *      b. metric.ratio < threshold           → paused-sub-threshold
 *      c. else                               → merged (gh pr merge --squash --delete-branch)
 *
 * FR40, FR41, FR42.
 */
import { execa as defaultExeca } from "execa";
export type AutoMergeGateResult = {
    next: "skipped-no-session-result";
} | {
    next: "skipped-not-ready-for-merge";
    verdict: string;
} | {
    next: "merged";
    prNumber: number;
    agreementRatio: number;
    threshold: number;
} | {
    next: "paused-medium";
    prNumber: number;
} | {
    next: "paused-high";
    prNumber: number;
} | {
    next: "paused-missing-risk-tier";
    prNumber: number;
} | {
    next: "paused-residual-medium-or-higher";
    prNumber: number;
    residuals: {
        medium: number;
        high: number;
    };
} | {
    next: "paused-sub-threshold";
    prNumber: number;
    agreementRatio: number;
    threshold: number;
} | {
    next: "paused-insufficient-data";
    prNumber: number;
};
export interface RunAutoMergeGateOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    role?: string;
    /** Test seam — production callers do not pass this. */
    execaImpl?: typeof defaultExeca;
    /** Plugin root override — test seam for loadRolePermissions. */
    pluginRootOverride?: string;
}
export declare function runAutoMergeGate(opts: RunAutoMergeGateOptions): Promise<AutoMergeGateResult>;
