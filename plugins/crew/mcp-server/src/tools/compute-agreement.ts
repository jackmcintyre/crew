/**
 * `computeAgreement` MCP tool — Story 4.10 Task 3.
 *
 * Thin wrapper around `lib/compute-agreement.ts`. Validates input at the
 * MCP boundary (Zod `.int().positive()` on `lastNVerdicts`) and returns
 * the helper's result as a JSON-serialised text payload. The helper
 * itself assumes `lastNVerdicts >= 1`.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `computeAgreement`.
 */

import {
  computeAgreement as computeAgreementImpl,
  type AgreementMetric,
} from "../lib/compute-agreement.js";

export interface ComputeAgreementInput {
  targetRepoRoot: string;
  lastNVerdicts?: number;
}

export async function computeAgreement(
  input: ComputeAgreementInput,
): Promise<AgreementMetric | null> {
  return computeAgreementImpl(input);
}
