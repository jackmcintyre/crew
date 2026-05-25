/**
 * `getStuckDevClaims` MCP tool — Story 4.12 (NFR3 / AC4).
 *
 * Thin delegate over `findStuckDevClaims`. Story 5.4's poll calls this
 * to surface in-progress claims that have exceeded the per-story budget
 * (default 30 min).
 */
import { type StuckDevClaim } from "../lib/find-stuck-dev-claims.js";
export interface GetStuckDevClaimsOpts {
    targetRepoRoot: string;
    budgetMs?: number;
}
export declare function getStuckDevClaims(opts: GetStuckDevClaimsOpts): Promise<StuckDevClaim[]>;
