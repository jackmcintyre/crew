/**
 * Pure helper: `decideAutoMerge` — Story 4.10b.
 *
 * Maps `(risk_tier, agreement_metric, threshold)` to a deterministic
 * `("auto-merge" | "pause-needs-human", reason)` outcome.
 *
 * Six-branch decision table (FR40 / FR41 / FR42):
 *
 * | risk_tier | agreement_metric     | ratio vs threshold | decision          | reason                     |
 * |-----------|----------------------|--------------------|-------------------|----------------------------|
 * | "low"     | non-null             | >= threshold       | auto-merge        | low-risk-met-threshold     |
 * | "low"     | non-null             | < threshold        | pause-needs-human | low-risk-sub-threshold     |
 * | "low"     | null                 | — insufficient —   | pause-needs-human | low-risk-insufficient-data |
 * | "medium"  | any                  | any                | pause-needs-human | medium-risk                |
 * | "high"    | any                  | any                | pause-needs-human | high-risk                  |
 * | undefined | any                  | any                | pause-needs-human | no-tier-no-signal          |
 *
 * This function is pure — no I/O, no async. It is the single source of truth
 * for the gate decision; downstream consumers (MCP tool, Epic 6 retro stats,
 * dashboard tools) MUST call this function rather than re-implementing the
 * mapping.
 *
 * Threshold comparison uses `>=` (FR40 verbatim). A ratio exactly equal to
 * the threshold qualifies for auto-merge.
 *
 * Story 4.10b · FR40 · FR41 · FR42
 */

import type { AgreementMetricResult } from "../tools/compute-agreement.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Closed set of reason literals emitted by `decideAutoMerge`.
 * Matches the Zod enum declared in `AutoMergeGateResultSchema` exactly.
 * DO NOT add literals here without updating that schema.
 *
 * Story 4.10b (AC5c).
 */
export type AutoMergeGateReason =
  | "low-risk-met-threshold"
  | "low-risk-sub-threshold"
  | "low-risk-insufficient-data"
  | "medium-risk"
  | "high-risk"
  | "no-tier-no-signal";

export interface DecideAutoMergeInput {
  /** The manifest's `risk_tier` field. May be `undefined` for legacy manifests. */
  risk_tier: "low" | "medium" | "high" | undefined;
  /** Output of `computeAgreement`. `null` means insufficient data. */
  agreement_metric: AgreementMetricResult | null;
  /** Resolved threshold (0 <= n <= 1). Comparison is `>=` (FR40). */
  threshold: number;
}

export interface DecideAutoMergeOutput {
  decision: "auto-merge" | "pause-needs-human";
  reason: AutoMergeGateReason;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Pure, synchronous gate function.
 *
 * Implements the six-branch decision table above. No I/O. No side-effects.
 *
 * @param input - `{ risk_tier, agreement_metric, threshold }`
 * @returns `{ decision, reason }`
 */
export function decideAutoMerge(input: DecideAutoMergeInput): DecideAutoMergeOutput {
  const { risk_tier, agreement_metric, threshold } = input;

  // Branch: no risk_tier on manifest (legacy / classifier-skipped)
  if (risk_tier === undefined) {
    return { decision: "pause-needs-human", reason: "no-tier-no-signal" };
  }

  // Branch: medium or high tier — always pause regardless of agreement
  if (risk_tier === "medium") {
    return { decision: "pause-needs-human", reason: "medium-risk" };
  }
  if (risk_tier === "high") {
    return { decision: "pause-needs-human", reason: "high-risk" };
  }

  // risk_tier === "low" from here on

  // Branch: low risk, insufficient data
  if (agreement_metric === null) {
    return { decision: "pause-needs-human", reason: "low-risk-insufficient-data" };
  }

  // Branch: low risk, ratio >= threshold → auto-merge (FR40 uses >=)
  if (agreement_metric.ratio >= threshold) {
    return { decision: "auto-merge", reason: "low-risk-met-threshold" };
  }

  // Branch: low risk, sub-threshold
  return { decision: "pause-needs-human", reason: "low-risk-sub-threshold" };
}
