/**
 * `findStuckDevClaims` — Story 4.12 (NFR3 / AC4).
 *
 * Pure-read helper. Enumerates in-progress manifests and returns the set
 * whose `claimed_at` exceeds the configured budget (default 30 min). The
 * caller (Story 5.4's poll) surfaces these as stuck stories.
 *
 * Pre-this-story manifests without `claimed_at` are silently skipped:
 * they cannot be aged. Malformed manifests re-throw verbatim.
 */
export declare const DEV_BUDGET_MS_DEFAULT: number;
export interface StuckDevClaim {
    ref: string;
    manifestPath: string;
    claimedAt: string;
    sessionUlid: string;
    elapsedMs: number;
    budgetMs: number;
}
export interface FindStuckDevClaimsOpts {
    targetRepoRoot: string;
    budgetMs?: number;
    now?: () => Date;
}
export declare function findStuckDevClaims(opts: FindStuckDevClaimsOpts): Promise<StuckDevClaim[]>;
