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
export declare const TelemetryEventBase: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * `agent.invoke` — per-agent-invocation telemetry (FR65). Carries
 * runtime and (optionally) token counts. No string payloads (NFR14).
 */
export declare const AgentInvokeEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"agent.invoke">;
    data: z.ZodObject<{
        runtime_ms: z.ZodNumber;
        tokens_in: z.ZodOptional<z.ZodNumber>;
        tokens_out: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `telemetry.invalid` — the failure-recording event emitted by the
 * logger when a caller's event fails its Zod schema (AC2 / NFR6 / FR70).
 * Only carries surfacing fields — never the offending payload (NFR14).
 */
export declare const TelemetryInvalidEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"telemetry.invalid">;
    data: z.ZodObject<{
        attempted_type: z.ZodString;
        zod_path: z.ZodString;
        zod_message: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `reviewer.verdict` — per-reviewer-verdict telemetry (FR66). Emitted inside
 * `postReviewerComments` on POST success. No body/diff/contents strings (NFR14).
 * The `timed_out` flag is `true` only on the AC3 substitution path (8-min cap).
 */
export declare const ReviewerVerdictEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reviewer.verdict">;
    data: z.ZodObject<{
        pr_number: z.ZodNumber;
        verdict: z.ZodEnum<{
            BLOCKED: "BLOCKED";
            "NEEDS CHANGES": "NEEDS CHANGES";
            "READY FOR MERGE": "READY FOR MERGE";
            "reviewer-failure": "reviewer-failure";
        }>;
        standards_version: z.ZodString;
        plugin_version: z.ZodString;
        timed_out: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `reviewer.verdict.merge_action` — retroactive merge-action event (FR66).
 * Emitted by `recordPrCloseAction` (typically Story 5.3's polling loop).
 * Join key for `compute-agreement` (Story 4.10): `(pr_number, session_id)`.
 */
export declare const ReviewerVerdictMergeActionEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reviewer.verdict.merge_action">;
    data: z.ZodObject<{
        pr_number: z.ZodNumber;
        merge_action: z.ZodEnum<{
            "closed-unmerged": "closed-unmerged";
            merged: "merged";
            "still-open": "still-open";
        }>;
        resolved_at: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `dev.budget_exceeded` — emitted by `recordAgentInvoke` when cumulative dev
 * subagent runtime for a story crosses the 30-min budget (NFR3). One-shot per
 * `(story_id, current_month)` pair. Story 5.3's polling loop reads this to
 * surface stuck stories to the operator.
 */
export declare const DevBudgetExceededEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"dev.budget_exceeded">;
    data: z.ZodObject<{
        cumulative_runtime_ms: z.ZodNumber;
        budget_ms: z.ZodNumber;
        triggering_invocation_runtime_ms: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
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
export declare const YieldHandoffEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"yield.handoff">;
    data: z.ZodObject<{
        from_role: z.ZodString;
        to_role: z.ZodString;
        domain: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
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
export declare const RetroProposalAppliedEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"retro.proposal.applied">;
    data: z.ZodObject<{
        id: z.ZodString;
        proposal_type: z.ZodEnum<{
            rule: "rule";
            "rule-retirement": "rule-retirement";
            "skill-create": "skill-create";
            "skill-retire": "skill-retire";
            "skill-revise": "skill-revise";
            "skill-supersede": "skill-supersede";
            "team-change": "team-change";
        }>;
        applied_sha: z.ZodString;
        idempotency_key: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `backlog.readiness_changed` — emitted by `markStoryReady` (Story 9.1, Epic 9
 * intake cockpit) on a real readiness toggle of a backlog item. Exactly ONE
 * event per real toggle; NONE on an idempotent no-op (the flag already holds
 * the requested value) or on the typed-error path (the ref is not an
 * un-claimed backlog item).
 *
 * - `ref`   — the backlog item's reference (`<adapter>:<source-id>`). Also
 *             mirrored into the envelope `story_id` so consumers reading only
 *             the envelope can join.
 * - `ready` — the NEW flag value after the toggle (`true` = blessed for the
 *             claim path; `false` = parked back behind the brake).
 *
 * Added additively to the discriminated union; `.strict()` posture preserved
 * (no body/diff/contents strings — NFR14).
 */
export declare const BacklogReadinessChangedEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"backlog.readiness_changed">;
    data: z.ZodObject<{
        ref: z.ZodString;
        ready: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * `draft.authored` — emitted by `writeNativeStory` (Story 9.2, Epic 9 author
 * seam) once a candidate story has PASSED the fail-closed discipline gate and
 * been written to disk. Exactly ONE event per written draft; NONE on a refused
 * / discipline-violating candidate (the write throws `DisciplineViolationError`
 * before the event is reachable) and NONE on the wrong-adapter or
 * round-trip-parse failure paths (which throw before the write completes).
 *
 * - `ref`   — the freshly-minted draft ref (`native:<ULID>`). Also mirrored into
 *             the envelope `story_id` so consumers reading only the envelope can
 *             join.
 * - `title` — the draft's human-readable title.
 *
 * Added additively to the discriminated union; `.strict()` posture preserved
 * (no body/diff/contents strings — NFR14).
 */
export declare const DraftAuthoredEventSchema: z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"draft.authored">;
    data: z.ZodObject<{
        ref: z.ZodString;
        title: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const TelemetryEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"agent.invoke">;
    data: z.ZodObject<{
        runtime_ms: z.ZodNumber;
        tokens_in: z.ZodOptional<z.ZodNumber>;
        tokens_out: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"telemetry.invalid">;
    data: z.ZodObject<{
        attempted_type: z.ZodString;
        zod_path: z.ZodString;
        zod_message: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reviewer.verdict">;
    data: z.ZodObject<{
        pr_number: z.ZodNumber;
        verdict: z.ZodEnum<{
            BLOCKED: "BLOCKED";
            "NEEDS CHANGES": "NEEDS CHANGES";
            "READY FOR MERGE": "READY FOR MERGE";
            "reviewer-failure": "reviewer-failure";
        }>;
        standards_version: z.ZodString;
        plugin_version: z.ZodString;
        timed_out: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reviewer.verdict.merge_action">;
    data: z.ZodObject<{
        pr_number: z.ZodNumber;
        merge_action: z.ZodEnum<{
            "closed-unmerged": "closed-unmerged";
            merged: "merged";
            "still-open": "still-open";
        }>;
        resolved_at: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"dev.budget_exceeded">;
    data: z.ZodObject<{
        cumulative_runtime_ms: z.ZodNumber;
        budget_ms: z.ZodNumber;
        triggering_invocation_runtime_ms: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"yield.handoff">;
    data: z.ZodObject<{
        from_role: z.ZodString;
        to_role: z.ZodString;
        domain: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"retro.proposal.applied">;
    data: z.ZodObject<{
        id: z.ZodString;
        proposal_type: z.ZodEnum<{
            rule: "rule";
            "rule-retirement": "rule-retirement";
            "skill-create": "skill-create";
            "skill-retire": "skill-retire";
            "skill-revise": "skill-revise";
            "skill-supersede": "skill-supersede";
            "team-change": "team-change";
        }>;
        applied_sha: z.ZodString;
        idempotency_key: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"backlog.readiness_changed">;
    data: z.ZodObject<{
        ref: z.ZodString;
        ready: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    ts: z.ZodString;
    session_id: z.ZodString;
    agent: z.ZodString;
    story_id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"draft.authored">;
    data: z.ZodObject<{
        ref: z.ZodString;
        title: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>], "type">;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type ReviewerVerdictEvent = z.infer<typeof ReviewerVerdictEventSchema>;
export type ReviewerVerdictMergeActionEvent = z.infer<typeof ReviewerVerdictMergeActionEventSchema>;
