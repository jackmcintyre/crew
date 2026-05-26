/**
 * Unit tests for `BLOCKED_BY_HINTS` — Story 5.13 AC4(c).
 *
 * Asserts:
 *   - Every enum member has a non-empty hint.
 *   - Every hint starts with `[<member>] `.
 *   - No hint equals the legacy generic phrase `clear blocked_by and re-run`.
 *   - Thirteen members total (the closed v1 enum per AC2).
 */
import { describe, expect, it } from "vitest";
import { BLOCKED_BY_HINTS } from "../blocked-by-hints.js";
const LEGACY_GENERIC_PHRASE = "clear blocked_by and re-run";
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
describe("BLOCKED_BY_HINTS", () => {
    it("has exactly thirteen members", () => {
        expect(Object.keys(BLOCKED_BY_HINTS)).toHaveLength(13);
    });
    it("contains all thirteen enum members as keys", () => {
        for (const member of ALL_MEMBERS) {
            expect(BLOCKED_BY_HINTS).toHaveProperty(member);
        }
    });
    for (const member of ALL_MEMBERS) {
        describe(`member: ${member}`, () => {
            it("has a non-empty hint string", () => {
                const hint = BLOCKED_BY_HINTS[member];
                expect(hint).toBeTruthy();
                expect(hint.length).toBeGreaterThan(0);
            });
            it(`hint starts with '[${member}] '`, () => {
                const hint = BLOCKED_BY_HINTS[member];
                expect(hint.startsWith(`[${member}] `)).toBe(true);
            });
            it("hint is not the legacy generic phrase", () => {
                const hint = BLOCKED_BY_HINTS[member];
                expect(hint).not.toBe(LEGACY_GENERIC_PHRASE);
                // Also check it doesn't just say to clear blocked_by with no context
                expect(hint.toLowerCase()).not.toBe("clear blocked_by and re-run");
            });
        });
    }
});
