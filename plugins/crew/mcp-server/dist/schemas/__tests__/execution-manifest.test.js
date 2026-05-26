/**
 * Schema tests for `ExecutionManifestSchema` — Story 4.3 Task 7.3 + Story 5.13.
 *
 * Tests the `rework_count` field added in Story 4.3 and the closed `blocked_by`
 * enum introduced in Story 5.13 (thirteen members; no free-string fallback).
 */
import { describe, expect, it } from "vitest";
import { parseExecutionManifest } from "../execution-manifest.js";
import { MalformedExecutionManifestError } from "../../errors.js";
// ---------------------------------------------------------------------------
// Base fixture — a valid minimal manifest
// ---------------------------------------------------------------------------
const BASE_MANIFEST = {
    ref: "native:01HZABC0000000000000000001",
    status: "in-progress",
    adapter: "native",
    source_path: ".crew/native-stories/01HZABC0000000000000000001.md",
    source_hash: "a".repeat(64),
    depends_on: [],
    acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
    title: "Test Story",
    narrative: "As a dev, I want to test.",
    withdrawn: false,
    claimed_by: "01HZSESSION00000000000001",
};
// ---------------------------------------------------------------------------
// rework_count tests
// ---------------------------------------------------------------------------
describe("rework_count field (Story 4.3)", () => {
    it("parses successfully when rework_count is omitted (undefined → 0 semantics)", () => {
        const manifest = parseExecutionManifest(BASE_MANIFEST, { absPath: "/fake/path.yaml" });
        expect(manifest.rework_count).toBeUndefined();
    });
    it("parses successfully when rework_count is 0", () => {
        const manifest = parseExecutionManifest({ ...BASE_MANIFEST, rework_count: 0 }, { absPath: "/fake/path.yaml" });
        expect(manifest.rework_count).toBe(0);
    });
    it("parses successfully when rework_count is 1", () => {
        const manifest = parseExecutionManifest({ ...BASE_MANIFEST, rework_count: 1 }, { absPath: "/fake/path.yaml" });
        expect(manifest.rework_count).toBe(1);
    });
    it("parses successfully when rework_count is 3", () => {
        const manifest = parseExecutionManifest({ ...BASE_MANIFEST, rework_count: 3 }, { absPath: "/fake/path.yaml" });
        expect(manifest.rework_count).toBe(3);
    });
    it("throws MalformedExecutionManifestError when rework_count is negative (-1)", () => {
        expect(() => parseExecutionManifest({ ...BASE_MANIFEST, rework_count: -1 }, { absPath: "/fake/path.yaml" })).toThrow(MalformedExecutionManifestError);
    });
    it("throws MalformedExecutionManifestError when rework_count is a float", () => {
        expect(() => parseExecutionManifest({ ...BASE_MANIFEST, rework_count: 1.5 }, { absPath: "/fake/path.yaml" })).toThrow(MalformedExecutionManifestError);
    });
});
// ---------------------------------------------------------------------------
// blocked_by extension tests (Story 4.3)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// blocked_by closed enum tests (Story 5.13 — thirteen members, no fallback)
// ---------------------------------------------------------------------------
const ALL_BLOCKED_BY_MEMBERS = [
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
describe("blocked_by field — closed enum (Story 5.13)", () => {
    for (const member of ALL_BLOCKED_BY_MEMBERS) {
        it(`parses successfully with blocked_by: '${member}'`, () => {
            const manifest = parseExecutionManifest({ ...BASE_MANIFEST, blocked_by: member }, { absPath: "/fake/path.yaml" });
            expect(manifest.blocked_by).toBe(member);
        });
    }
    it("parses successfully when blocked_by is omitted", () => {
        const manifest = parseExecutionManifest(BASE_MANIFEST, { absPath: "/fake/path.yaml" });
        expect(manifest.blocked_by).toBeUndefined();
    });
    it("throws MalformedExecutionManifestError for out-of-enum value 'some-future-value' (closed enum — AC5 flip)", () => {
        // Story 5.13 AC5: the string fallback is REMOVED. Out-of-enum values must now
        // fail at the Zod boundary. This test was previously asserting acceptance;
        // it is flipped to assert Zod throw.
        expect(() => parseExecutionManifest({ ...BASE_MANIFEST, blocked_by: "some-future-value" }, { absPath: "/fake/path.yaml" })).toThrow(MalformedExecutionManifestError);
    });
    it("throws MalformedExecutionManifestError for removed 'source-drift' value (no live writer)", () => {
        // 'source-drift' was in the previous union but has no live writer; removed in v1 enum.
        expect(() => parseExecutionManifest({ ...BASE_MANIFEST, blocked_by: "source-drift" }, { absPath: "/fake/path.yaml" })).toThrow(MalformedExecutionManifestError);
    });
});
