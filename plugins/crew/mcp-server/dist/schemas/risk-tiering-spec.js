import { z } from "zod";
/**
 * `docs/risk-tiering.md` schema — the externalised risk-tier rule set the
 * plugin reads on every reviewer verdict (Story 4.9b) to classify each PR
 * as `low | medium | high` risk.
 *
 * Architecture § "Risk-Tier Classification (FR40a) — Spec Format" pins the
 * format. FR40a (`prd-crew-v1/functional-requirements.md`) is the requirement.
 * Story 4.9 (this story) is where the schema, validator, and loader land.
 * Story 4.9b owns the classifier that consumes the parsed spec.
 *
 * `.strict()` is applied at every level — unknown keys indicate spec format
 * drift and must surface as hard errors at parse time rather than silent
 * mismatches at classifier time.
 */
export const ChangeTypeSchema = z.enum(["revert", "migration", "schema", "dep-bump"]);
export const DiffSizeThresholdsSchema = z
    .object({
    min_lines_changed: z.number().int().nonnegative().optional(),
    max_lines_changed: z.number().int().nonnegative().optional(),
})
    .strict()
    .refine((v) => v.min_lines_changed !== undefined || v.max_lines_changed !== undefined, {
    message: "diff_size_thresholds must declare at least one of min_lines_changed or max_lines_changed",
});
export const RuleSchema = z
    .object({
    id: z.string().min(1),
    path_patterns: z.array(z.string().min(1)).min(1).optional(),
    change_types: z.array(ChangeTypeSchema).min(1).optional(),
    diff_size_thresholds: DiffSizeThresholdsSchema.optional(),
    /**
     * Additive-only signal (Stage-2 part C). When `true`, the rule matches only
     * if EVERY changed file in the PR is a brand-new file addition — no existing
     * file is modified, deleted, or renamed. Purely-additive code cannot alter
     * an existing code path (wiring it in would require editing an existing file,
     * which makes the PR no longer additive-only), so it is genuinely low-risk.
     * `false`/absent does not constrain the match.
     */
    additive_only: z.boolean().optional(),
})
    .strict()
    .refine((rule) => rule.path_patterns !== undefined ||
    rule.change_types !== undefined ||
    rule.diff_size_thresholds !== undefined ||
    rule.additive_only !== undefined, { message: "rule declares no signal fields" });
export const RiskTieringSpecSchema = z
    .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    fallback_tier: z.literal("medium", {
        message: "fallback_tier must be 'medium' (v1 invariant — see Architecture § Risk-tier classification, Fallback)",
    }),
    tiers: z
        .object({
        low: z.array(RuleSchema).optional(),
        medium: z.array(RuleSchema).optional(),
        high: z.array(RuleSchema).optional(),
    })
        .strict()
        .refine((tiers) => (tiers.low?.length ?? 0) +
        (tiers.medium?.length ?? 0) +
        (tiers.high?.length ?? 0) >
        0, { message: "no rules declared in any tier" }),
})
    .strict();
