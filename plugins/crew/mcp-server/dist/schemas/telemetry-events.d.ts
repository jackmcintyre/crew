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
 * `reviewer.verdict` — emitted by the reviewer-session pipeline after a
 * verdict comment is posted to a PR (Story 4.10 / FR67 / NFR24). Joins
 * the discriminated union additively; existing callers compile unchanged.
 *
 * `eventual_merge_action` is `null` at verdict-post time (PR still open)
 * and is backfilled by a future loop (Story 4.12) once the PR closes —
 * `merged`, `closed-without-merge`, or `superseded-by-rework`. The
 * `computeAgreement` helper treats `null` as "unresolved" and excludes
 * the event from its window.
 *
 * `verdict` literals match the locked verdict-line grammar (Story 4.6b)
 * verbatim — `READY FOR MERGE`, `NEEDS CHANGES`, `BLOCKED` (with spaces).
 * The writer is responsible for emitting these unchanged; this schema
 * does not canonicalise them.
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
            "READY FOR MERGE": "READY FOR MERGE";
            "NEEDS CHANGES": "NEEDS CHANGES";
            BLOCKED: "BLOCKED";
        }>;
        standards_version: z.ZodString;
        plugin_version: z.ZodString;
        eventual_merge_action: z.ZodNullable<z.ZodEnum<{
            merged: "merged";
            "closed-without-merge": "closed-without-merge";
            "superseded-by-rework": "superseded-by-rework";
        }>>;
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
            "READY FOR MERGE": "READY FOR MERGE";
            "NEEDS CHANGES": "NEEDS CHANGES";
            BLOCKED: "BLOCKED";
        }>;
        standards_version: z.ZodString;
        plugin_version: z.ZodString;
        eventual_merge_action: z.ZodNullable<z.ZodEnum<{
            merged: "merged";
            "closed-without-merge": "closed-without-merge";
            "superseded-by-rework": "superseded-by-rework";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>], "type">;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type ReviewerVerdictEvent = z.infer<typeof ReviewerVerdictEventSchema>;
