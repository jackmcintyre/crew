/**
 * Integration tests for the blocked-recovery hint surface — Story 5.13 AC3.
 *
 * Verifies:
 *   - For every one of the 13 enum members, `renderBlockedRecoveryHint(member, ref)`
 *     returns a non-empty string that:
 *       (i)  starts with `[<member>] <ref>`
 *       (ii) does NOT equal the legacy generic phrase `clear blocked_by and re-run`
 *   - `BLOCKED_BY_HINTS` has exactly thirteen members.
 *   - The `/crew:start` SKILL.md references `BLOCKED_BY_HINTS` (the deterministic seam).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCKED_BY_HINTS, renderBlockedRecoveryHint } from "../lib/blocked-by-hints.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The start SKILL.md lives at plugins/crew/skills/start/SKILL.md.
// From src/__tests__/ that's ../../../skills/start/SKILL.md.
const SKILL_MD_PATH = path.resolve(HERE, "..", "..", "..", "skills", "start", "SKILL.md");
const ALL_MEMBERS = [
    "handoff-grammar",
    "gh-defer",
    "gh-retry",
    "gh-needs-human",
    "reviewer-no-session-result",
    "reviewer-verdict-needs-changes",
    "reviewer-verdict-blocked",
    "routing-failure",
    "routing-self-yield",
    "planning-discipline",
    "orphan-no-transcript",
    "reviewer-grammar",
    "deps-drift",
];
const TEST_REF = "bmad:5.13";
const LEGACY_PHRASE = "clear blocked_by and re-run";
describe("renderBlockedRecoveryHint — AC3 per-case hints", () => {
    it("BLOCKED_BY_HINTS has exactly thirteen members", () => {
        expect(Object.keys(BLOCKED_BY_HINTS)).toHaveLength(13);
    });
    for (const member of ALL_MEMBERS) {
        describe(`member: ${member}`, () => {
            it(`rendered hint starts with '[${member}] ${TEST_REF}'`, () => {
                const hint = renderBlockedRecoveryHint(member, TEST_REF);
                expect(hint.startsWith(`[${member}] ${TEST_REF}`)).toBe(true);
            });
            it("rendered hint is not the legacy generic phrase", () => {
                const hint = renderBlockedRecoveryHint(member, TEST_REF);
                expect(hint.toLowerCase()).not.toBe(LEGACY_PHRASE);
                // The hint must include a concrete action, not just "clear blocked_by and re-run"
                expect(hint.length).toBeGreaterThan(`[${member}] ${TEST_REF} — `.length);
            });
            it("rendered hint substitutes {ref} with the provided ref", () => {
                const hint = renderBlockedRecoveryHint(member, TEST_REF);
                expect(hint).not.toContain("{ref}");
                expect(hint).toContain(TEST_REF);
            });
        });
    }
});
describe("SKILL.md references BLOCKED_BY_HINTS seam (AC3 deterministic seam check)", () => {
    it("SKILL.md body contains BLOCKED_BY_HINTS reference", async () => {
        const body = await fs.readFile(SKILL_MD_PATH, "utf8");
        expect(body).toContain("BLOCKED_BY_HINTS");
    });
    it("SKILL.md body contains renderBlockedRecoveryHint reference", async () => {
        const body = await fs.readFile(SKILL_MD_PATH, "utf8");
        expect(body).toContain("renderBlockedRecoveryHint");
    });
    it("SKILL.md references blocked-by-hints.ts", async () => {
        const body = await fs.readFile(SKILL_MD_PATH, "utf8");
        expect(body).toContain("blocked-by-hints.ts");
    });
});
