/**
 * Unit tests for BMad adapter leniency rules (Story 3.8).
 *
 * Covers:
 *   - AC1: letter-suffixed story IDs parsed correctly.
 *   - AC2: missing Status defaults to "backlog".
 *   - AC3: unknown Status does not throw; status_unknown field set.
 *   - AC4: (no parser test needed — readStoriesDir is tested in integration test)
 */
import { describe, it, expect } from "vitest";
import { parseBmadStory } from "../parse-bmad-story.js";
import { MalformedBmadStoryError } from "../../../errors.js";
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function makeStory(opts) {
    const storyPath = `/fake/${opts.epic}-${opts.story.replace(/(\d+)([a-z]?)/, "$1$2")}-fixture-story.md`;
    const statusBlock = opts.statusLine !== undefined ? `\n${opts.statusLine}\n` : "\n";
    const content = [
        `# Story ${opts.epic}.${opts.story}: Fixture story for leniency tests`,
        statusBlock,
        opts.extraPreamble ?? "",
        "## Story",
        "",
        "As a **fixture**, I want **to verify leniency**, so that **the adapter handles reality**.",
        "",
        "## Acceptance Criteria",
        "",
        "**AC1 (integration):**",
        "**Given** the fixture, **When** parsed, **Then** it works.",
        "",
        "## Dev Notes",
        "",
        "Leniency fixture.",
    ].join("\n");
    return { path: storyPath, content };
}
// ---------------------------------------------------------------------------
// AC1: Letter-suffixed story IDs
// ---------------------------------------------------------------------------
describe("parseBmadStory — letter-suffixed story IDs (Story 3.8 AC1)", () => {
    it("parses a 4-8b-...md file with ref bmad:4.8b and id 4.8b", () => {
        const { path: p, content } = makeStory({
            epic: 4,
            story: "8b",
            statusLine: "Status: backlog",
        });
        const result = parseBmadStory(p, content);
        expect(result.ref).toBe("bmad:4.8b");
        expect(result.raw_frontmatter["id"]).toBe("4.8b");
    });
    it("parses a 4-8-...md file as bmad:4.8 without colliding with 4.8b", () => {
        const { path: p, content } = makeStory({
            epic: 4,
            story: "8",
            statusLine: "Status: backlog",
        });
        const result = parseBmadStory(p, content);
        expect(result.ref).toBe("bmad:4.8");
        expect(result.raw_frontmatter["id"]).toBe("4.8");
    });
    it("parses a 5-4b-...md file with ref bmad:5.4b", () => {
        const { path: p, content } = makeStory({
            epic: 5,
            story: "4b",
            statusLine: "Status: ready-for-dev",
        });
        const result = parseBmadStory(p, content);
        expect(result.ref).toBe("bmad:5.4b");
        expect(result.raw_frontmatter["id"]).toBe("5.4b");
    });
    it("throws MalformedBmadStoryError when H1 numbering does not match filename suffix", () => {
        // File says 4-8b but H1 says Story 4.8 (no suffix) — mismatch.
        const content = [
            "# Story 4.8: Mismatched H1",
            "",
            "Status: backlog",
            "",
            "## Story",
            "",
            "As a fixture, I want a mismatch, so that the parser rejects it.",
            "",
            "## Acceptance Criteria",
            "",
            "**AC1:**",
            "**Given** a mismatch, **When** parsed, **Then** an error is thrown.",
            "",
            "## Dev Notes",
            "",
            "Mismatch fixture.",
        ].join("\n");
        expect(() => parseBmadStory("/fake/4-8b-mismatch.md", content)).toThrow(MalformedBmadStoryError);
    });
});
// ---------------------------------------------------------------------------
// AC2: Missing Status defaults to "backlog"
// ---------------------------------------------------------------------------
describe("parseBmadStory — missing Status defaults (Story 3.8 AC2)", () => {
    it("parses without Status line; status defaults to backlog and status_defaulted is true", () => {
        const { path: p, content } = makeStory({ epic: 5, story: "1" });
        // No statusLine — omits the Status field entirely.
        const result = parseBmadStory(p, content);
        expect(result.raw_frontmatter["status"]).toBe("backlog");
        expect(result.raw_frontmatter["status_defaulted"]).toBe(true);
    });
    it("does NOT set status_defaulted when Status is explicitly present", () => {
        const { path: p, content } = makeStory({
            epic: 1,
            story: "1",
            statusLine: "Status: ready-for-dev",
        });
        const result = parseBmadStory(p, content);
        expect(result.raw_frontmatter["status"]).toBe("ready-for-dev");
        expect(result.raw_frontmatter["status_defaulted"]).toBeUndefined();
    });
    it("does NOT set status_defaulted when Status is backlog (explicit)", () => {
        const { path: p, content } = makeStory({
            epic: 1,
            story: "2",
            statusLine: "Status: backlog",
        });
        const result = parseBmadStory(p, content);
        expect(result.raw_frontmatter["status"]).toBe("backlog");
        expect(result.raw_frontmatter["status_defaulted"]).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// AC3: Unknown Status does not throw; status_unknown field set
// ---------------------------------------------------------------------------
describe("parseBmadStory — unknown Status leniency (Story 3.8 AC3)", () => {
    it("does NOT throw for Status: review (not in vocabulary)", () => {
        const { path: p, content } = makeStory({
            epic: 5,
            story: "2",
            statusLine: "Status: review",
        });
        expect(() => parseBmadStory(p, content)).not.toThrow();
        const result = parseBmadStory(p, content);
        const statusUnknown = result.raw_frontmatter["status_unknown"];
        expect(statusUnknown).toBeDefined();
        expect(statusUnknown.raw).toBe("review");
        expect(statusUnknown.reason).toBe("status-vocabulary-unknown");
    });
    it("does NOT throw for free-text Status with em-dash", () => {
        const raw = "revised — re-implement per 4.6 retro";
        const { path: p, content } = makeStory({
            epic: 5,
            story: "3",
            statusLine: `Status: ${raw}`,
        });
        const result = parseBmadStory(p, content);
        const statusUnknown = result.raw_frontmatter["status_unknown"];
        expect(statusUnknown).toBeDefined();
        expect(statusUnknown.raw).toBe(raw);
    });
    it("sets effective status to backlog for unknown Status (for downstream mapping)", () => {
        const { path: p, content } = makeStory({
            epic: 5,
            story: "4",
            statusLine: "Status: review",
        });
        const result = parseBmadStory(p, content);
        // The parser lowers unknown status to backlog so mapBmadStatusToExecution
        // doesn't see an unknown value. Callers must check status_unknown for routing.
        expect(result.raw_frontmatter["status"]).toBe("backlog");
        expect(result.raw_frontmatter["status_defaulted"]).toBeUndefined();
    });
    it("does NOT set status_unknown for a known status", () => {
        const { path: p, content } = makeStory({
            epic: 1,
            story: "3",
            statusLine: "Status: in-progress",
        });
        const result = parseBmadStory(p, content);
        expect(result.raw_frontmatter["status_unknown"]).toBeUndefined();
    });
});
