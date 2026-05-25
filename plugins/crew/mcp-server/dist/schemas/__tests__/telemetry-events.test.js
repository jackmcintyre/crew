/**
 * Schema tests for `schemas/telemetry-events.ts` — covers the
 * `reviewer.verdict` extension (Story 4.10 Task 1 / AC4l) plus
 * non-regression for the pre-existing `agent.invoke` and
 * `telemetry.invalid` schemas.
 */
import { describe, expect, it } from "vitest";
import { AgentInvokeEventSchema, ReviewerVerdictEventSchema, TelemetryEventSchema, TelemetryInvalidEventSchema, } from "../telemetry-events.js";
const BASE = {
    ts: "2026-05-25T12:00:00.000Z",
    session_id: "01KSEDYC9938DJ8VCA91C0YX43",
    agent: "generalist-reviewer",
    story_id: "bmad:4.10",
};
describe("ReviewerVerdictEventSchema", () => {
    it("parses a valid resolved event (eventual_merge_action: merged)", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 42,
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: "merged",
            },
        });
        expect(result.success).toBe(true);
    });
    it("parses a valid unresolved event (eventual_merge_action: null)", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 1,
                verdict: "NEEDS CHANGES",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: null,
            },
        });
        expect(result.success).toBe(true);
    });
    it("parses all three verdict literals", () => {
        for (const verdict of ["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED"]) {
            const result = ReviewerVerdictEventSchema.safeParse({
                ...BASE,
                type: "reviewer.verdict",
                data: {
                    pr_number: 1,
                    verdict,
                    standards_version: "1.0.0",
                    plugin_version: "0.4.10",
                    eventual_merge_action: null,
                },
            });
            expect(result.success).toBe(true);
        }
    });
    it("parses all three resolved eventual_merge_action literals", () => {
        for (const action of [
            "merged",
            "closed-without-merge",
            "superseded-by-rework",
        ]) {
            const result = ReviewerVerdictEventSchema.safeParse({
                ...BASE,
                type: "reviewer.verdict",
                data: {
                    pr_number: 1,
                    verdict: "READY FOR MERGE",
                    standards_version: "1.0.0",
                    plugin_version: "0.4.10",
                    eventual_merge_action: action,
                },
            });
            expect(result.success).toBe(true);
        }
    });
    it("rejects an unknown verdict literal", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 1,
                verdict: "approved",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: null,
            },
        });
        expect(result.success).toBe(false);
    });
    it("rejects an unknown eventual_merge_action literal", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 1,
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: "auto-merged",
            },
        });
        expect(result.success).toBe(false);
    });
    it("rejects a missing pr_number", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: null,
            },
        });
        expect(result.success).toBe(false);
    });
    it("rejects pr_number: 0 (non-positive)", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 0,
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: null,
            },
        });
        expect(result.success).toBe(false);
    });
    it("rejects unknown data.foo field (strict mode)", () => {
        const result = ReviewerVerdictEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 1,
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: null,
                foo: "bar",
            },
        });
        expect(result.success).toBe(false);
    });
    it("parses through the discriminated union", () => {
        const result = TelemetryEventSchema.safeParse({
            ...BASE,
            type: "reviewer.verdict",
            data: {
                pr_number: 7,
                verdict: "BLOCKED",
                standards_version: "1.0.0",
                plugin_version: "0.4.10",
                eventual_merge_action: "closed-without-merge",
            },
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === "reviewer.verdict") {
            expect(result.data.data.verdict).toBe("BLOCKED");
        }
    });
});
describe("non-regression — existing schemas continue to parse", () => {
    it("agent.invoke still parses", () => {
        const result = AgentInvokeEventSchema.safeParse({
            ...BASE,
            agent: "generalist-dev",
            type: "agent.invoke",
            data: { runtime_ms: 1234 },
        });
        expect(result.success).toBe(true);
    });
    it("telemetry.invalid still parses", () => {
        const result = TelemetryInvalidEventSchema.safeParse({
            ...BASE,
            type: "telemetry.invalid",
            data: {
                attempted_type: "agent.invoke",
                zod_path: "data.runtime_ms",
                zod_message: "Expected number, received string",
            },
        });
        expect(result.success).toBe(true);
    });
    it("agent.invoke still parses through the discriminated union", () => {
        const result = TelemetryEventSchema.safeParse({
            ...BASE,
            agent: "generalist-dev",
            type: "agent.invoke",
            data: { runtime_ms: 99 },
        });
        expect(result.success).toBe(true);
    });
});
