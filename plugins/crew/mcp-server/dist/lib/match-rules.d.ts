/**
 * `matchRule` — three-signal AND-combination rule matcher for risk-tier classification.
 *
 * Story 4.9b — Pattern §11, AND-combination semantics.
 *
 * A rule matches when EVERY declared signal field on it matches the diff:
 * - `path_patterns`: if present, AT LEAST ONE `changedPaths` entry matches
 *   AT LEAST ONE pattern (via `picomatch` with default options).
 * - `change_types`: if present, AT LEAST ONE detected change type appears
 *   in the rule's array.
 * - `diff_size_thresholds`: if present, `diffSize` satisfies the bounds
 *   (`min_lines_changed ≤ diffSize ≤ max_lines_changed`, with absent bounds
 *   treated as -∞ and +∞ respectively).
 *
 * Absent signal fields are "not declared" and do NOT constrain the match.
 * Story 4.9's schema guarantees every rule declares at least one signal, so
 * the all-absent case is unreachable in production.
 */
import type { Rule } from "../schemas/risk-tiering-spec.js";
import type { ChangeType } from "../schemas/risk-tiering-spec.js";
export interface MatchRuleContext {
    changedPaths: string[];
    detectedChangeTypes: ChangeType[];
    diffSize: number;
}
export interface MatchRuleResult {
    matched: boolean;
    /** Subset of `changedPaths` that hit any path_pattern. Empty when no path match occurred. */
    matchedPaths: string[];
}
/**
 * Test whether a single rule matches the diff context.
 *
 * Uses `picomatch` with default options (dot: false). The matcher is compiled
 * once per `path_patterns` array invocation — not cached across rules.
 *
 * @param rule  The parsed `Rule` from the risk-tiering spec.
 * @param ctx   Diff context: paths, detected types, and diff size.
 * @returns `{ matched, matchedPaths }` — `matchedPaths` is populated only
 *          when `path_patterns` was present and matched.
 */
export declare function matchRule(rule: Rule, ctx: MatchRuleContext): MatchRuleResult;
