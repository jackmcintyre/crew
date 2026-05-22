/**
 * Schema tests for `ExecutionManifestSchema` — Story 4.3 Task 7.3.
 *
 * Tests the `rework_count` field added in Story 4.3 and the extension of
 * `blocked_by` to include `"handoff-grammar"` and `"reviewer-grammar"`.
 */

import { describe, expect, it } from "vitest";
import { parseExecutionManifest } from "../execution-manifest.js";
import { MalformedExecutionManifestError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Base fixture — a valid minimal manifest
// ---------------------------------------------------------------------------

const BASE_MANIFEST = {
  ref: "native:01HZABC0000000000000000001",
  status: "in-progress" as const,
  adapter: "native",
  source_path: ".crew/native-stories/01HZABC0000000000000000001.md",
  source_hash: "a".repeat(64),
  depends_on: [],
  acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" as const }],
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
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, rework_count: 0 },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.rework_count).toBe(0);
  });

  it("parses successfully when rework_count is 1", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, rework_count: 1 },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.rework_count).toBe(1);
  });

  it("parses successfully when rework_count is 3", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, rework_count: 3 },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.rework_count).toBe(3);
  });

  it("throws MalformedExecutionManifestError when rework_count is negative (-1)", () => {
    expect(() =>
      parseExecutionManifest(
        { ...BASE_MANIFEST, rework_count: -1 },
        { absPath: "/fake/path.yaml" },
      ),
    ).toThrow(MalformedExecutionManifestError);
  });

  it("throws MalformedExecutionManifestError when rework_count is a float", () => {
    expect(() =>
      parseExecutionManifest(
        { ...BASE_MANIFEST, rework_count: 1.5 },
        { absPath: "/fake/path.yaml" },
      ),
    ).toThrow(MalformedExecutionManifestError);
  });
});

// ---------------------------------------------------------------------------
// blocked_by extension tests (Story 4.3)
// ---------------------------------------------------------------------------

describe("blocked_by field — handoff-grammar and reviewer-grammar (Story 4.3)", () => {
  it("parses successfully with blocked_by: 'handoff-grammar'", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, blocked_by: "handoff-grammar" },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.blocked_by).toBe("handoff-grammar");
  });

  it("parses successfully with blocked_by: 'reviewer-grammar'", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, blocked_by: "reviewer-grammar" },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.blocked_by).toBe("reviewer-grammar");
  });

  it("parses successfully with blocked_by: 'planning-discipline' (existing value)", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, status: "blocked", blocked_by: "planning-discipline" },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.blocked_by).toBe("planning-discipline");
  });

  it("parses successfully with blocked_by: 'source-drift' (existing value)", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, status: "blocked", blocked_by: "source-drift" },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.blocked_by).toBe("source-drift");
  });

  it("parses successfully with blocked_by: 'some-future-value' (string fallback)", () => {
    const manifest = parseExecutionManifest(
      { ...BASE_MANIFEST, blocked_by: "some-future-value" },
      { absPath: "/fake/path.yaml" },
    );
    expect(manifest.blocked_by).toBe("some-future-value");
  });

  it("parses successfully when blocked_by is omitted", () => {
    const manifest = parseExecutionManifest(BASE_MANIFEST, { absPath: "/fake/path.yaml" });
    expect(manifest.blocked_by).toBeUndefined();
  });
});
