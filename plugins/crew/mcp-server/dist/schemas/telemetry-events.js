import { z } from "zod";
/**
 * Discriminated-union schema for the v1 telemetry event set
 * (Story 1.5 / Implementation-patterns §5 / NFR21 / NFR14).
 *
 * **Closed set in v1.** Adding a new event type means adding a new
 * schema entry plus a `type` literal — no implicit extension. Every
 * payload is `.strict()` so unknown keys are rejected at the boundary.
 * No `data: z.record(...)` escape hatch. No body/diff/contents strings
 * that could leak PII (NFR14).
 *
 * The discriminator is `type`, dotted (`domain.event`). Pinned by
 * Implementation-patterns §5.
 */
/**
 * Fields common to every telemetry event.
 *
 * - `ts`: ISO-8601 UTC timestamp with millisecond precision (Z-suffixed).
 * - `session_id`: opaque caller-supplied identifier (caller's
 *   responsibility to enforce a ULID shape if desired).
 * - `agent`: kebab-cased role name (matches the catalogue convention
 *   and the RolePermissions role regex from Story 1.4).
 * - `story_id`: optional opaque identifier (typically `<adapter>:<source-id>`).
 */
export const TelemetryEventBase = z
    .object({
    ts: z
        .string()
        .datetime({ offset: false })
        .refine((s) => s.endsWith("Z"), "must be UTC"),
    session_id: z.string().min(1),
    agent: z
        .string()
        .min(1)
        .regex(/^[a-z0-9-]+$/),
    story_id: z.string().min(1).optional(),
})
    .strict();
/**
 * `agent.invoke` — per-agent-invocation telemetry (FR65). Carries
 * runtime and (optionally) token counts. No string payloads (NFR14).
 */
export const AgentInvokeEventSchema = TelemetryEventBase.extend({
    type: z.literal("agent.invoke"),
    data: z
        .object({
        runtime_ms: z.number().int().nonnegative(),
        tokens_in: z.number().int().nonnegative().optional(),
        tokens_out: z.number().int().nonnegative().optional(),
    })
        .strict(),
}).strict();
/**
 * `telemetry.invalid` — the failure-recording event emitted by the
 * logger when a caller's event fails its Zod schema (AC2 / NFR6 / FR70).
 * Only carries surfacing fields — never the offending payload (NFR14).
 */
export const TelemetryInvalidEventSchema = TelemetryEventBase.extend({
    type: z.literal("telemetry.invalid"),
    data: z
        .object({
        attempted_type: z.string().min(1),
        zod_path: z.string(),
        zod_message: z.string().min(1),
    })
        .strict(),
}).strict();
/**
 * `reviewer.verdict` — per-reviewer-verdict telemetry (FR66). Emitted inside
 * `postReviewerComments` on POST success. No body/diff/contents strings (NFR14).
 * The `timed_out` flag is `true` only on the AC3 substitution path (8-min cap).
 */
export const ReviewerVerdictEventSchema = TelemetryEventBase.extend({
    type: z.literal("reviewer.verdict"),
    data: z
        .object({
        pr_number: z.number().int().positive(),
        verdict: z.enum(["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED", "reviewer-failure"]),
        standards_version: z.string().regex(/^\d+\.\d+\.\d+$/),
        plugin_version: z.string().regex(/^\d+\.\d+\.\d+$/),
        timed_out: z.boolean(),
    })
        .strict(),
}).strict();
/**
 * `reviewer.verdict.merge_action` — retroactive merge-action event (FR66).
 * Emitted by `recordPrCloseAction` (typically Story 5.3's polling loop).
 * Join key for `compute-agreement` (Story 4.10): `(pr_number, session_id)`.
 */
export const ReviewerVerdictMergeActionEventSchema = TelemetryEventBase.extend({
    type: z.literal("reviewer.verdict.merge_action"),
    data: z
        .object({
        pr_number: z.number().int().positive(),
        merge_action: z.enum(["merged", "closed-unmerged", "still-open"]),
        resolved_at: z
            .string()
            .datetime({ offset: false })
            .refine((s) => s.endsWith("Z"), "must be UTC"),
    })
        .strict(),
}).strict();
/**
 * `dev.budget_exceeded` — emitted by `recordAgentInvoke` when cumulative dev
 * subagent runtime for a story crosses the 30-min budget (NFR3). One-shot per
 * `(story_id, current_month)` pair. Story 5.3's polling loop reads this to
 * surface stuck stories to the operator.
 */
export const DevBudgetExceededEventSchema = TelemetryEventBase.extend({
    type: z.literal("dev.budget_exceeded"),
    data: z
        .object({
        cumulative_runtime_ms: z.number().int().nonnegative(),
        budget_ms: z.number().int().positive(),
        triggering_invocation_runtime_ms: z.number().int().nonnegative(),
    })
        .strict(),
}).strict();
/**
 * `yield.handoff` — emitted by `processReviewerYield` when a generalist
 * reviewer's yield is successfully routed to a hired specialist (FR103, NFR29).
 * Only emitted on the success branch; routing-failure and self-yield branches
 * write no JSONL. Story 4.11.
 *
 * `agent` at the event-base level is set to `from_role` (who emitted the yield).
 * `data.from_role` is duplicated so downstream consumers reading only `data`
 * (e.g. retro tools projecting handoffs) don't need to climb up the envelope.
 */
export const YieldHandoffEventSchema = TelemetryEventBase.extend({
    type: z.literal("yield.handoff"),
    data: z
        .object({
        from_role: z.string().min(1),
        to_role: z.string().min(1),
        domain: z.string().min(1),
    })
        .strict(),
}).strict();
/**
 * `retro.proposal.applied` — emitted by the `/accept-proposal` gate
 * (`acceptProposal`) on a successful confirmed apply (Story 6.4 AC5). Exactly
 * one event per apply; NONE on preview, on a declined apply, on an idempotent
 * no-op, or on a fail-closed unregistered kind.
 *
 * - `id`              — the proposal's ULID.
 * - `proposal_type`   — the proposal's kind (one of the seven retro-proposal
 *                       discriminator literals).
 * - `applied_sha`     — the commit sha from the git wrapper.
 * - `idempotency_key` — the proposal's stable id (mirrors the `applied` block).
 *
 * No body/diff/contents strings (NFR14) — only surfacing fields.
 */
export const RetroProposalAppliedEventSchema = TelemetryEventBase.extend({
    type: z.literal("retro.proposal.applied"),
    data: z
        .object({
        id: z.string().min(1),
        proposal_type: z.enum([
            "rule",
            "rule-retirement",
            "skill-create",
            "skill-revise",
            "skill-supersede",
            "skill-retire",
            "team-change",
        ]),
        applied_sha: z.string().min(1),
        idempotency_key: z.string().min(1),
    })
        .strict(),
}).strict();
export const TelemetryEventSchema = z.discriminatedUnion("type", [
    AgentInvokeEventSchema,
    TelemetryInvalidEventSchema,
    ReviewerVerdictEventSchema,
    ReviewerVerdictMergeActionEventSchema,
    DevBudgetExceededEventSchema,
    YieldHandoffEventSchema,
    RetroProposalAppliedEventSchema,
]);
