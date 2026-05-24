/**
 * Unit tests for `compose-reviewer-summary.ts` — Story 4.6b Task 3.3.
 *
 * Tests every branch of `composeVerdictLine` (one test per closed-table row,
 * plus the UnreachableBlockedReasonError path) and `composeSummaryBody`
 * (structural assertions on section headings, per-AC formatting, standards,
 * manual-checks section).
 */
import { describe, expect, it } from "vitest";
import { composeVerdictLine, composeSummaryBody } from "../compose-reviewer-summary.js";
import { UnreachableBlockedReasonError } from "../../errors.js";
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BASE_REF = "native:01J9TEST0000000000000000000";
function makeArtifactPass(index) {
    return {
        index,
        tag: null,
        applicability: "runnable-artifact-check",
        artifactPath: `artifact-${index}.txt`,
        status: "pass",
        reason: `artifact-${index}.txt exists`,
    };
}
function makeArtifactFail(index) {
    return {
        index,
        tag: null,
        applicability: "runnable-artifact-check",
        artifactPath: `missing-${index}.txt`,
        status: "fail",
        reason: `artifact: missing-${index}.txt — ENOENT`,
    };
}
function makeManualCheck(index) {
    return {
        index,
        tag: null,
        applicability: "manual-check-required",
        reason: `Operator must verify AC${index} manually.`,
    };
}
function makeResultFile(verdict, acResults = {}, standards = {}) {
    return {
        sessionUlid: "01HZTEST00000000SESSION",
        ref: BASE_REF,
        recommendedVerdict: verdict,
        acResults,
        standardsByCriterionId: standards,
        sourceStoryRef: BASE_REF,
        prNumber: 42,
    };
}
// ---------------------------------------------------------------------------
// composeVerdictLine tests
// ---------------------------------------------------------------------------
describe("composeVerdictLine", () => {
    it('READY FOR MERGE → exact string **Verdict: READY FOR MERGE**', () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        expect(composeVerdictLine(result)).toBe("**Verdict: READY FOR MERGE**");
    });
    it("NEEDS CHANGES with 1 failing, 0 manual → [1 issues, 0 questions]", () => {
        const result = makeResultFile("NEEDS CHANGES", { 1: makeArtifactFail(1) });
        expect(composeVerdictLine(result)).toBe("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
    });
    it("NEEDS CHANGES with 2 failing, 0 manual → [2 issues, 0 questions]", () => {
        const result = makeResultFile("NEEDS CHANGES", {
            1: makeArtifactFail(1),
            2: makeArtifactFail(2),
        });
        expect(composeVerdictLine(result)).toBe("**Verdict: NEEDS CHANGES** [2 issues, 0 questions]");
    });
    it("NEEDS CHANGES with 0 failing, 1 manual → [0 issues, 1 questions]", () => {
        // NEEDS CHANGES with a manual-check-required entry (unusual but valid if any AC also failed)
        const result = makeResultFile("NEEDS CHANGES", {
            1: makeArtifactFail(1),
            2: makeManualCheck(2),
        });
        expect(composeVerdictLine(result)).toBe("**Verdict: NEEDS CHANGES** [1 issues, 1 questions]");
    });
    it("BLOCKED with empty acResults → [no ACs declared]", () => {
        const result = makeResultFile("BLOCKED", {});
        expect(composeVerdictLine(result)).toBe("**Verdict: BLOCKED** [no ACs declared]");
    });
    it("BLOCKED with manual-check-required AC → [manual checks required]", () => {
        const result = makeResultFile("BLOCKED", { 1: makeManualCheck(1) });
        expect(composeVerdictLine(result)).toBe("**Verdict: BLOCKED** [manual checks required]");
    });
    it("BLOCKED with non-empty acResults and no manual-check-required → throws UnreachableBlockedReasonError", () => {
        // This is the out-of-band-mutation path — BLOCKED but with only passing ACs.
        const result = makeResultFile("BLOCKED", { 1: makeArtifactPass(1) });
        expect(() => composeVerdictLine(result)).toThrow(UnreachableBlockedReasonError);
    });
});
// ---------------------------------------------------------------------------
// composeSummaryBody tests
// ---------------------------------------------------------------------------
describe("composeSummaryBody", () => {
    it("READY FOR MERGE with pass ACs — final line matches verdict", () => {
        const result = makeResultFile("READY FOR MERGE", {
            1: makeArtifactPass(1),
            2: makeArtifactPass(2),
        });
        const body = composeSummaryBody(result);
        const lines = body.split("\n");
        const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
        expect(lastNonEmpty).toBe("**Verdict: READY FOR MERGE**");
    });
    it("NEEDS CHANGES with failing AC — final line matches verdict grammar", () => {
        const result = makeResultFile("NEEDS CHANGES", { 1: makeArtifactFail(1) });
        const body = composeSummaryBody(result);
        const lines = body.split("\n");
        const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
        expect(lastNonEmpty).toBe("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
    });
    it("body has # Reviewer summary heading with the ref", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain(`# Reviewer summary — ${BASE_REF}`);
    });
    it("body has ## Acceptance criteria section heading", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain("## Acceptance criteria");
    });
    it("body has ## Standards check section heading", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain("## Standards check");
    });
    it("no ACs → AC section emits '_No ACs declared in the source story.'", () => {
        const result = makeResultFile("BLOCKED", {});
        const body = composeSummaryBody(result);
        expect(body).toContain("_No ACs declared in the source story._");
    });
    it("no standards criteria → emits '_No standards criteria declared.'", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) }, {});
        const body = composeSummaryBody(result);
        expect(body).toContain("_No standards criteria declared._");
    });
    it("with standards criteria → emits each criterion name and what", () => {
        const standards = {
            "story-aligned": { name: "story-aligned", what: "Maps ACs to diff hunks." },
        };
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) }, standards);
        const body = composeSummaryBody(result);
        expect(body).toContain("story-aligned");
        expect(body).toContain("Maps ACs to diff hunks.");
    });
    it("no manual-check-required ACs → no 'Manual checks' section", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        const body = composeSummaryBody(result);
        expect(body).not.toContain("## Manual checks required before merge");
    });
    it("with manual-check-required ACs → emits '## Manual checks required before merge' section", () => {
        const result = makeResultFile("BLOCKED", { 1: makeManualCheck(1), 2: makeManualCheck(2) });
        const body = composeSummaryBody(result);
        expect(body).toContain("## Manual checks required before merge");
        expect(body).toContain("AC1: Operator must verify AC1 manually.");
        expect(body).toContain("AC2: Operator must verify AC2 manually.");
    });
    it("passing AC → ✅ emoji", () => {
        const result = makeResultFile("READY FOR MERGE", { 1: makeArtifactPass(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain("✅");
    });
    it("failing AC → ❌ emoji", () => {
        const result = makeResultFile("NEEDS CHANGES", { 1: makeArtifactFail(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain("❌");
    });
    it("manual-check-required AC → ⚠️ emoji", () => {
        const result = makeResultFile("BLOCKED", { 1: makeManualCheck(1) });
        const body = composeSummaryBody(result);
        expect(body).toContain("⚠️");
    });
    it("ACs emitted in numeric-index order", () => {
        const result = makeResultFile("NEEDS CHANGES", {
            3: makeArtifactFail(3),
            1: makeArtifactPass(1),
            2: makeArtifactPass(2),
        });
        const body = composeSummaryBody(result);
        const ac1Pos = body.indexOf("**AC1**");
        const ac2Pos = body.indexOf("**AC2**");
        const ac3Pos = body.indexOf("**AC3**");
        expect(ac1Pos).toBeLessThan(ac2Pos);
        expect(ac2Pos).toBeLessThan(ac3Pos);
    });
    it("BLOCKED with no ACs — verdict line is correct", () => {
        const result = makeResultFile("BLOCKED", {});
        const body = composeSummaryBody(result);
        const lines = body.split("\n");
        const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
        expect(lastNonEmpty).toBe("**Verdict: BLOCKED** [no ACs declared]");
    });
    it("BLOCKED with manual-check-required — verdict line is correct", () => {
        const result = makeResultFile("BLOCKED", { 1: makeManualCheck(1) });
        const body = composeSummaryBody(result);
        const lines = body.split("\n");
        const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
        expect(lastNonEmpty).toBe("**Verdict: BLOCKED** [manual checks required]");
    });
});
