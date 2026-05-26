/**
 * Unit tests for `matchRule` — AC4 sub-case (4k).
 *
 * Story 4.9b — Pattern §11 rule-matching primitive.
 */
import { describe, it, expect } from "vitest";
import { matchRule } from "../match-rules.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePathRule(patterns) {
    return { id: "test-path-rule", path_patterns: patterns };
}
function makeChangeTypeRule(types) {
    return { id: "test-ct-rule", change_types: types };
}
function makeSizeRule(opts) {
    return {
        id: "test-size-rule",
        diff_size_thresholds: {
            ...(opts.min !== undefined ? { min_lines_changed: opts.min } : {}),
            ...(opts.max !== undefined ? { max_lines_changed: opts.max } : {}),
        },
    };
}
// ---------------------------------------------------------------------------
// path_patterns signal
// ---------------------------------------------------------------------------
describe("matchRule — path_patterns", () => {
    it("matches when at least one path hits a pattern", () => {
        const rule = makePathRule(["**/migrations/**"]);
        const result = matchRule(rule, {
            changedPaths: ["db/migrations/0001.sql", "src/foo.ts"],
            detectedChangeTypes: [],
            diffSize: 10,
        });
        expect(result.matched).toBe(true);
        expect(result.matchedPaths).toEqual(["db/migrations/0001.sql"]);
    });
    it("does not match when no path hits any pattern", () => {
        const rule = makePathRule(["docs/**"]);
        const result = matchRule(rule, {
            changedPaths: ["src/foo.ts"],
            detectedChangeTypes: [],
            diffSize: 5,
        });
        expect(result.matched).toBe(false);
        expect(result.matchedPaths).toEqual([]);
    });
    it("returns all matched paths (multiple hits)", () => {
        const rule = makePathRule(["**/*.md"]);
        const result = matchRule(rule, {
            changedPaths: ["docs/a.md", "docs/b.md", "src/foo.ts"],
            detectedChangeTypes: [],
            diffSize: 3,
        });
        expect(result.matched).toBe(true);
        expect(result.matchedPaths).toEqual(["docs/a.md", "docs/b.md"]);
    });
    it("picomatch POSIX: forward-slash paths match **/*.md regardless of OS", () => {
        const rule = makePathRule(["**/*.md"]);
        const result = matchRule(rule, {
            changedPaths: ["a/b/c/README.md"],
            detectedChangeTypes: [],
            diffSize: 1,
        });
        expect(result.matched).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// change_types signal
// ---------------------------------------------------------------------------
describe("matchRule — change_types", () => {
    it("matches when at least one detected type is in the rule's array", () => {
        const rule = makeChangeTypeRule(["migration", "schema"]);
        const result = matchRule(rule, {
            changedPaths: [],
            detectedChangeTypes: ["schema"],
            diffSize: 10,
        });
        expect(result.matched).toBe(true);
        expect(result.matchedPaths).toEqual([]);
    });
    it("does not match when no detected type is in the rule's array", () => {
        const rule = makeChangeTypeRule(["migration"]);
        const result = matchRule(rule, {
            changedPaths: [],
            detectedChangeTypes: ["dep-bump"],
            diffSize: 10,
        });
        expect(result.matched).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// diff_size_thresholds signal
// ---------------------------------------------------------------------------
describe("matchRule — diff_size_thresholds", () => {
    it("matches diffSize within [min, max] range", () => {
        const rule = makeSizeRule({ min: 100, max: 200 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 150 }).matched).toBe(true);
    });
    it("does not match diffSize below min", () => {
        const rule = makeSizeRule({ min: 100, max: 200 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 99 }).matched).toBe(false);
    });
    it("does not match diffSize above max", () => {
        const rule = makeSizeRule({ min: 100, max: 200 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 201 }).matched).toBe(false);
    });
    it("matches with only min declared (no upper bound)", () => {
        const rule = makeSizeRule({ min: 1000 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 9999 }).matched).toBe(true);
    });
    it("matches with only max declared (no lower bound)", () => {
        const rule = makeSizeRule({ max: 50 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 0 }).matched).toBe(true);
    });
    it("does not match when diffSize exceeds max-only rule", () => {
        const rule = makeSizeRule({ max: 50 });
        expect(matchRule(rule, { changedPaths: [], detectedChangeTypes: [], diffSize: 51 }).matched).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// AND-combination
// ---------------------------------------------------------------------------
describe("matchRule — AND-combination", () => {
    it("rule with path_patterns + change_types: matches only when BOTH hold", () => {
        const rule = {
            id: "and-rule",
            path_patterns: ["**/migrations/**"],
            change_types: ["migration"],
        };
        // Both hold
        expect(matchRule(rule, {
            changedPaths: ["db/migrations/0001.sql"],
            detectedChangeTypes: ["migration"],
            diffSize: 10,
        }).matched).toBe(true);
        // Only path matches, no change_type match
        expect(matchRule(rule, {
            changedPaths: ["db/migrations/0001.sql"],
            detectedChangeTypes: ["dep-bump"],
            diffSize: 10,
        }).matched).toBe(false);
        // Only change_type matches, no path match
        expect(matchRule(rule, {
            changedPaths: ["src/foo.ts"],
            detectedChangeTypes: ["migration"],
            diffSize: 10,
        }).matched).toBe(false);
    });
});
