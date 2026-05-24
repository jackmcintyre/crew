/**
 * Unit tests for `processReviewerTranscript` — Story 4.3b Task 9; Story 4.3c Task 5.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules.
 *
 * Covers:
 *   (a) READY FOR MERGE → `next: "done-ready-for-merge"`, `completed: true`,
 *       manifest moved to done/ with `status: "done"` and preserved `claimed_by`.
 *       (AC3(ii) seam contract — Story 4.3c)
 *   (b) NEEDS CHANGES (first rework) → `next: "rework-dev"`, reworkIteration: 1,
 *       manifest `rework_count: 1`, devPrompt populated, no `completed` field.
 *   (c) NEEDS CHANGES (second rework) → reworkIteration: 2, manifest `rework_count: 2`.
 *   (d) BLOCKED → `next: "done-blocked-reviewer-verdict"`, manifest NOT mutated,
 *       no `completed` field. (AC3(iii) — Story 4.3c)
 *   (e) Drift / empty / unknown-sentinel → `next: "done-blocked-reviewer-grammar"`,
 *       manifest `blocked_by: "reviewer-grammar"`, no `completed` field. (AC3(iv) — Story 4.3c)
 *
 * Story 4.3b Task 9.1–9.2; Story 4.3c Task 5.1–5.5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { processReviewerTranscript } from "../process-reviewer-transcript.js";
// ---------------------------------------------------------------------------
// Mock deriveSourceBaseline so completeStory's hand-edit guard passes.
// The fixture manifest has source_hash: "a".repeat(64); we return the same hash.
// ---------------------------------------------------------------------------
vi.mock("../../state/derive-source-baseline.js", () => ({
    deriveSourceBaseline: vi.fn(),
}));
import { deriveSourceBaseline } from "../../state/derive-source-baseline.js";
const mockDeriveSourceBaseline = vi.mocked(deriveSourceBaseline);
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4DEF";
const SESSION_ULID = "01HZSESSION00000000000002";
const READY_FOR_MERGE = `**Verdict: READY FOR MERGE**`;
const NEEDS_CHANGES = `**Verdict: NEEDS CHANGES** [2 issues]`;
const BLOCKED_VERDICT = `**Verdict: BLOCKED**`;
const READY_WITH_BRACKET = `**Verdict: READY FOR MERGE** [lgtm]`;
const BLOCKED_WITH_BRACKET = `**Verdict: BLOCKED** [under-specified story]`;
// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
function makeBaseManifest(ref, reworkCount) {
    return {
        ref,
        status: "in-progress",
        adapter: "native",
        source_path: `.crew/native-stories/${ref}.yaml`,
        source_hash: "a".repeat(64),
        depends_on: [],
        acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
        title: "Test Story",
        narrative: "As a dev, I want to test.",
        withdrawn: false,
        claimed_by: SESSION_ULID,
        ...(reworkCount !== undefined ? { rework_count: reworkCount } : {}),
    };
}
const FIXTURE_DEV_PERSONA_MD = `---
role: generalist-dev
domain: "feature implementation in a story scope"
model_tier: sonnet
tools_allow:
  - Read
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Dev

## Domain

Implements one story.

## Mandate

- Implement.

## Out of mandate

- Review.

## Prompt

You are the dev.

## Knowledge

No knowledge.
`;
// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let tmpRoot;
let manifestPath;
async function seedManifest(manifest) {
    await atomicWriteFile(manifestPath, yamlStringify(manifest, { lineWidth: 0 }));
}
beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-process-reviewer-transcript-"));
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "done"), { recursive: true });
    manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`);
    await seedManifest(makeBaseManifest(STORY_REF));
    await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), { recursive: true });
    await atomicWriteFile(path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"), FIXTURE_DEV_PERSONA_MD);
    // Set up the mock so completeStory's hand-edit guard passes.
    // The fixture manifest has source_hash: "a".repeat(64).
    mockDeriveSourceBaseline.mockResolvedValue({
        sourceHash: "a".repeat(64),
        sourceFields: {
            title: "Test Story",
            narrative: "As a dev, I want to test.",
            acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
            implementation_notes: undefined,
            depends_on: [],
            withdrawn: false,
        },
    });
});
afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readOnDiskManifest() {
    const raw = await fs.readFile(manifestPath, "utf8");
    return parseExecutionManifest(yamlParse(raw), { absPath: manifestPath });
}
function makeOpts(reviewerTranscript) {
    return {
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        ref: STORY_REF,
        manifestPath,
        reviewerTranscript,
    };
}
// ---------------------------------------------------------------------------
// (a) READY FOR MERGE — AC3(ii) seam contract (Story 4.3c Task 5.2)
// ---------------------------------------------------------------------------
describe("(a) READY FOR MERGE → done-ready-for-merge with completeStory side-effect", () => {
    it("moves manifest to done/, returns completed: true, chatLog has verbatim line (without bracket)", async () => {
        const result = await processReviewerTranscript(makeOpts(READY_FOR_MERGE));
        // AC3(i): return type has completed: true literal field
        expect(result.next).toBe("done-ready-for-merge");
        if (result.next !== "done-ready-for-merge")
            return;
        expect(result.completed).toBe(true);
        // Chat log has verbatim verdict line
        expect(result.chatLog).toContain(`reviewer verdict: READY FOR MERGE — story ${STORY_REF} ready for merge gate`);
        // AC3(ii): in-progress manifest no longer exists
        await expect(fs.stat(path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`))).rejects.toThrow(); // ENOENT
        // AC3(ii): done manifest exists with status: "done" and preserved claimed_by
        const doneManifestRaw = await fs.readFile(path.join(tmpRoot, ".crew", "state", "done", `${STORY_REF}.yaml`), "utf8");
        const doneManifest = parseExecutionManifest(yamlParse(doneManifestRaw), {
            absPath: path.join(tmpRoot, ".crew", "state", "done", `${STORY_REF}.yaml`),
        });
        expect(doneManifest.status).toBe("done");
        expect(doneManifest.claimed_by).toBe(SESSION_ULID);
    });
    it("moves manifest to done/ with bracket trailer in transcript", async () => {
        const result = await processReviewerTranscript(makeOpts(READY_WITH_BRACKET));
        expect(result.next).toBe("done-ready-for-merge");
        if (result.next !== "done-ready-for-merge")
            return;
        expect(result.completed).toBe(true);
        // in-progress gone, done exists
        await expect(fs.stat(path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`))).rejects.toThrow();
        await expect(fs.stat(path.join(tmpRoot, ".crew", "state", "done", `${STORY_REF}.yaml`))).resolves.toBeDefined();
    });
});
// ---------------------------------------------------------------------------
// (b) NEEDS CHANGES — first rework
// ---------------------------------------------------------------------------
describe("(b) NEEDS CHANGES (rework_count: undefined → 1)", () => {
    it("returns rework-dev with reworkIteration: 1, manifest rework_count: 1, devPrompt populated", async () => {
        const result = await processReviewerTranscript(makeOpts(NEEDS_CHANGES));
        expect(result.next).toBe("rework-dev");
        if (result.next !== "rework-dev")
            return;
        expect(result.reworkIteration).toBe(1);
        expect(result.devPrompt.length).toBeGreaterThan(0);
        expect(result.devPrompt).toContain("Generalist Dev");
        expect(result.chatLog).toContain(`reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBe(1);
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// (c) NEEDS CHANGES — second rework
// ---------------------------------------------------------------------------
describe("(c) NEEDS CHANGES (rework_count: 1 → 2)", () => {
    it("returns rework-dev with reworkIteration: 2, manifest rework_count: 2", async () => {
        // Seed manifest with rework_count: 1 already.
        await seedManifest(makeBaseManifest(STORY_REF, 1));
        const result = await processReviewerTranscript(makeOpts(NEEDS_CHANGES));
        expect(result.next).toBe("rework-dev");
        if (result.next !== "rework-dev")
            return;
        expect(result.reworkIteration).toBe(2);
        expect(result.chatLog).toContain(`reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBe(2);
    });
});
// ---------------------------------------------------------------------------
// (d) BLOCKED — AC3(iii) (Story 4.3c Task 5.3)
// ---------------------------------------------------------------------------
describe("(d) BLOCKED → done-blocked-reviewer-verdict", () => {
    it("no manifest mutation, no completed field, chatLog has verbatim BLOCKED line (without bracket)", async () => {
        const result = await processReviewerTranscript(makeOpts(BLOCKED_VERDICT));
        expect(result.next).toBe("done-blocked-reviewer-verdict");
        // AC3(iii): BLOCKED branch must NOT have a completed field
        expect("completed" in result).toBe(false);
        expect(result.chatLog).toContain(`reviewer verdict: BLOCKED — story ${STORY_REF} awaiting human`);
        // Manifest stays in in-progress/
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBeUndefined();
        expect(onDisk.rework_count).toBeUndefined();
        // done/ is empty
        const doneFiles = await fs.readdir(path.join(tmpRoot, ".crew", "state", "done"));
        expect(doneFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
    });
    it("no manifest mutation with bracket trailer, no completed field", async () => {
        const result = await processReviewerTranscript(makeOpts(BLOCKED_WITH_BRACKET));
        expect(result.next).toBe("done-blocked-reviewer-verdict");
        expect("completed" in result).toBe(false);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// (e) Drift / empty / unknown-sentinel — AC3(iv) (Story 4.3c Task 5.4)
// ---------------------------------------------------------------------------
describe("(e) drift → done-blocked-reviewer-grammar", () => {
    it("drift (unrecognised paraphrase) stamps blocked_by: 'reviewer-grammar', no completed field", async () => {
        const result = await processReviewerTranscript(makeOpts("Looks good to me!"));
        expect(result.next).toBe("done-blocked-reviewer-grammar");
        // AC3(iv): grammar-drift branch must NOT have a completed field
        expect("completed" in result).toBe(false);
        expect(result.chatLog).toContain(`reviewer grammar drift — story ${STORY_REF} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("reviewer-grammar");
        // done/ is empty
        const doneFiles = await fs.readdir(path.join(tmpRoot, ".crew", "state", "done"));
        expect(doneFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
    });
    it("empty transcript stamps blocked_by: 'reviewer-grammar', no completed field", async () => {
        const result = await processReviewerTranscript(makeOpts(""));
        expect(result.next).toBe("done-blocked-reviewer-grammar");
        expect("completed" in result).toBe(false);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("reviewer-grammar");
    });
    it("unknown sentinel ('Verdict: APPROVED') stamps blocked_by: 'reviewer-grammar', no completed field", async () => {
        const result = await processReviewerTranscript(makeOpts("Verdict: APPROVED"));
        expect(result.next).toBe("done-blocked-reviewer-grammar");
        expect("completed" in result).toBe(false);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("reviewer-grammar");
    });
});
// ---------------------------------------------------------------------------
// (f) NEEDS CHANGES — no completed field (Story 4.3c Task 5.5)
// ---------------------------------------------------------------------------
describe("(f) NEEDS CHANGES → rework-dev — no completed field", () => {
    it("rework branch does not carry a completed field", async () => {
        const result = await processReviewerTranscript(makeOpts("**Verdict: NEEDS CHANGES** [issues]"));
        expect(result.next).toBe("rework-dev");
        expect("completed" in result).toBe(false);
        // Manifest stays in in-progress/ (rework_count incremented)
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBe(1);
        // done/ is empty
        const doneFiles = await fs.readdir(path.join(tmpRoot, ".crew", "state", "done"));
        expect(doneFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
    });
});
