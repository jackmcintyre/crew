/**
 * AC5 operator-smoke harness — Story 4.6 Task 10.
 *
 * @description
 * Reproduces the 4.3c rubber-stamp failure mode deterministically in CI:
 *   1. Scratch repo with one ready story — AC1: `artifact: target-file.txt`.
 *   2. Dev subagent claims handoff (via `processDevTranscript`) WITHOUT
 *      creating `target-file.txt` on disk.
 *   3. `runReviewerSession` is called — it finds the artifact missing and
 *      returns `acResults[1].status === "fail"`.
 *   4. A reviewer verdict transcript is composed from the structured result
 *      (simulating the persona under Task 8.3 rules — MUST NOT emit
 *      `READY FOR MERGE` when any acResults[*].status === "fail").
 *   5. `processReviewerTranscript` is called — the manifest must NOT move
 *      to `done/`.
 *
 * Behavioural contract:
 *   _bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md §5a–5e
 *
 * Smoke-gate: this test provides the CI-level evidence required by
 *   `plugins/crew/docs/user-surface-acs.md § Pre-PR gate` for AC5.
 *   An operator may substitute manual-paste evidence from a real
 *   `/crew:start` run against the reproducer scenario in lieu of this test.
 *
 * Story 4.6 Task 10.1–10.5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { processDevTranscript } from "../../tools/process-dev-transcript.js";
import { processReviewerTranscript } from "../../tools/process-reviewer-transcript.js";
import { runReviewerSession } from "../../tools/run-reviewer-session.js";
import { __resetGhErrorMapCacheForTests } from "../../lib/gh-error-map.js";
import { SMOKE_STORY_ULID, SMOKE_STORY_REF, SMOKE_ARTIFACT_PATH, makeRubberStampDevTranscript, composeReviewerTranscript, assertVerdictTranscriptContract, assertManifestStaysInProgress, } from "./rubber-stamp-reproducer.js";
// ---------------------------------------------------------------------------
// Mock deriveSourceBaseline so completeStory's hand-edit guard passes for
// the smoke story (same pattern as inner-cycle.integration.test.ts).
// ---------------------------------------------------------------------------
vi.mock("../../state/derive-source-baseline.js", () => ({
    deriveSourceBaseline: vi.fn(),
}));
import { deriveSourceBaseline } from "../../state/derive-source-baseline.js";
const mockDeriveSourceBaseline = vi.mocked(deriveSourceBaseline);
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SESSION_ULID = "01HZSMOKESESSION00000000000";
const FAKE_PR_DIFF = `diff --git a/README.md b/README.md
index 0000000..e69de29
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+# Smoke
`;
// ---------------------------------------------------------------------------
// Source story content — one AC with artifact: target-file.txt
//
// Spec §5a: "One source story in .crew/native-stories/ with one AC:
// `artifact: target-file.txt`."
// ---------------------------------------------------------------------------
const SMOKE_SOURCE_STORY = `# Smoke Story — Rubber Stamp Reproducer

## Narrative

As an operator, I want target-file.txt to exist so that I can verify
the reviewer detects its absence.

## Acceptance Criteria

**AC1:**
**Given** the dev has completed implementation,
**When** the reviewer checks the artifact,
**Then** target-file.txt exists at the repository root.
artifact: ${SMOKE_ARTIFACT_PATH}

## Implementation Notes

None.
`;
const SMOKE_STANDARDS = `version: "0.1.0"
updated: "2026-05-24"
criteria:
  - name: "story-aligned"
    what: "The PR's diff implements only what the story's ACs require."
    check: "Map each diff hunk to one or more ACs."
    anti_criterion: "Scope creep."
`;
// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let tmpRoot;
let manifestPath;
beforeEach(async () => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "crew-4-6-ac5-smoke-"));
    // .crew state dirs
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "to-do"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "done"), { recursive: true });
    // .crew/config.yaml (native adapter)
    await atomicWriteFile(path.join(tmpRoot, ".crew", "config.yaml"), "adapter: native\nadapter_config: {}\n");
    // Native story spec file
    const storiesDir = path.join(tmpRoot, ".crew", "native-stories");
    await fs.mkdir(storiesDir, { recursive: true });
    await atomicWriteFile(path.join(storiesDir, `${SMOKE_STORY_ULID}.md`), SMOKE_SOURCE_STORY);
    // In-progress manifest — story is pre-claimed
    manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${SMOKE_STORY_REF}.yaml`);
    await atomicWriteFile(manifestPath, [
        `ref: "${SMOKE_STORY_REF}"`,
        `status: in-progress`,
        `adapter: native`,
        `source_path: ".crew/native-stories/${SMOKE_STORY_ULID}.md"`,
        `source_hash: "${"a".repeat(64)}"`,
        `depends_on: []`,
        `acceptance_criteria:`,
        `  - text: "Given the dev has completed implementation."`,
        `    kind: integration`,
        `title: "Smoke Story — Rubber Stamp Reproducer"`,
        `narrative: "As an operator, I want target-file.txt to exist."`,
        `withdrawn: false`,
        `claimed_by: "${SESSION_ULID}"`,
    ].join("\n"));
    // docs/standards.md
    await fs.mkdir(path.join(tmpRoot, "docs"), { recursive: true });
    await atomicWriteFile(path.join(tmpRoot, "docs", "standards.md"), SMOKE_STANDARDS);
    // Persona files (needed by buildPersonaSpawnPrompt inside processDevTranscript)
    await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "team", "generalist-reviewer"), { recursive: true });
    await atomicWriteFile(path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"), [
        `---`,
        `role: generalist-dev`,
        `domain: "implementation"`,
        `model_tier: sonnet`,
        `tools_allow:`,
        `  - Read`,
        `locked_phrases:`,
        `  handoff: "Handoff to reviewer — story <story-id> ready for review."`,
        `  yield: "This sits in <role>'s domain — handing off"`,
        `  verdict: "**Verdict: <SENTINEL>**"`,
        `hired_at: "2026-01-01T00:00:00.000Z"`,
        `catalogue_version: "0.1.0"`,
        `---`,
        ``,
        `# Generalist Dev`,
        ``,
        `## Domain`,
        ``,
        `Implements stories.`,
        ``,
        `## Mandate`,
        ``,
        `- Implement.`,
        ``,
        `## Out of mandate`,
        ``,
        `- Review.`,
        ``,
        `## Prompt`,
        ``,
        `You are the dev.`,
        ``,
        `## Knowledge`,
        ``,
        `None.`,
    ].join("\n"));
    await atomicWriteFile(path.join(tmpRoot, "team", "generalist-reviewer", "PERSONA.md"), [
        `---`,
        `role: generalist-reviewer`,
        `domain: "code review"`,
        `model_tier: sonnet`,
        `tools_allow:`,
        `  - runReviewerSession`,
        `locked_phrases:`,
        `  handoff: "Handoff to reviewer — story <story-id> ready for review."`,
        `  yield: "This sits in <role>'s domain — handing off"`,
        `  verdict: "**Verdict: <SENTINEL>**"`,
        `hired_at: "2026-01-01T00:00:00.000Z"`,
        `catalogue_version: "0.1.0"`,
        `---`,
        ``,
        `# Generalist Reviewer`,
        ``,
        `## Domain`,
        ``,
        `Reviews stories.`,
        ``,
        `## Mandate`,
        ``,
        `- Review.`,
        ``,
        `## Out of mandate`,
        ``,
        `- Implement.`,
        ``,
        `## Prompt`,
        ``,
        `You are the reviewer.`,
        ``,
        `## Knowledge`,
        ``,
        `None.`,
    ].join("\n"));
    // NOTE: target-file.txt is intentionally NOT created here.
    // The dev claims to have created it in the transcript, but it doesn't exist.
    // Mock deriveSourceBaseline for completeStory's hand-edit guard
    mockDeriveSourceBaseline.mockResolvedValue({
        sourceHash: "a".repeat(64),
        sourceFields: {
            title: "Smoke Story — Rubber Stamp Reproducer",
            narrative: "As an operator, I want target-file.txt to exist.",
            acceptance_criteria: [{ text: "Given the dev has completed implementation.", kind: "integration" }],
            implementation_notes: undefined,
            depends_on: [],
            withdrawn: false,
        },
    });
    __resetGhErrorMapCacheForTests();
});
afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
});
// ---------------------------------------------------------------------------
// Discriminating execaImpl stub for runReviewerSession
// ---------------------------------------------------------------------------
function makeSmokeStubbedExeca(opts = {}) {
    return vi.fn().mockImplementation(async (cmd, _args, _callOpts) => {
        if (cmd === "gh") {
            return { stdout: FAKE_PR_DIFF, stderr: "", exitCode: 0, timedOut: false };
        }
        if (cmd === "pnpm") {
            const exitCode = opts.vitestExitCode ?? 0;
            return { stdout: "", stderr: "", exitCode, timedOut: false };
        }
        return { stdout: "", stderr: `unexpected command: ${cmd}`, exitCode: 1, timedOut: false };
    });
}
// ---------------------------------------------------------------------------
// AC5 smoke test
// ---------------------------------------------------------------------------
describe("AC5 (user-surface): rubber-stamp failure mode is closed by runReviewerSession", () => {
    it("dev claims handoff without creating target-file.txt → reviewer detects missing artifact → verdict is NOT READY FOR MERGE → manifest stays in in-progress/", async () => {
        // -----------------------------------------------------------------------
        // Step 1: Simulate the dev subagent's handoff (without creating the artifact).
        // The transcript claims the file was built but target-file.txt is absent.
        // -----------------------------------------------------------------------
        const devTranscript = makeRubberStampDevTranscript(SMOKE_STORY_REF);
        const devResult = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: SMOKE_STORY_REF,
            devTranscript,
        });
        expect(devResult.next).toBe("spawn-reviewer");
        if (devResult.next !== "spawn-reviewer")
            return;
        // prNumber must have been extracted from the transcript
        expect(devResult.prNumber).toBe(99);
        // -----------------------------------------------------------------------
        // Step 2: Run the reviewer's session tool. target-file.txt does NOT exist,
        // so acResults[1].status MUST be "fail".
        // This is the TOOL-LAYER evidence that closes the rubber-stamp loop.
        // -----------------------------------------------------------------------
        const sessionResult = await runReviewerSession({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: SMOKE_STORY_REF,
            prNumber: devResult.prNumber,
            execaImpl: makeSmokeStubbedExeca(),
        });
        // The artifact check MUST fail (target-file.txt does not exist)
        const ac1Result = sessionResult.acResults[1];
        expect(ac1Result).toBeDefined();
        expect(ac1Result.applicability).toBe("runnable-artifact-check");
        if (ac1Result.applicability !== "runnable-artifact-check")
            return;
        expect(ac1Result.status).toBe("fail");
        expect(ac1Result.reason).toContain(SMOKE_ARTIFACT_PATH);
        expect(ac1Result.reason).toContain("ENOENT");
        // -----------------------------------------------------------------------
        // Step 3: Compose the reviewer transcript from the structured result.
        // This simulates what the generalist-reviewer persona MUST emit under the
        // Task 8.3 rules: no READY FOR MERGE when any acResults[*].status === "fail".
        // -----------------------------------------------------------------------
        const reviewerTranscript = composeReviewerTranscript(sessionResult.acResults);
        // -----------------------------------------------------------------------
        // Step 4: Assert the verdict transcript satisfies the AC5 contract (spec §5b, 5d).
        // -----------------------------------------------------------------------
        assertVerdictTranscriptContract(reviewerTranscript);
        // -----------------------------------------------------------------------
        // Step 5: Drive processReviewerTranscript to confirm the manifest stays
        // in in-progress/ (spec §5c).
        // -----------------------------------------------------------------------
        const reviewerResult = await processReviewerTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: SMOKE_STORY_REF,
            manifestPath,
            reviewerTranscript,
        });
        // NEEDS CHANGES → rework-dev (manifest stays in in-progress, rework_count incremented)
        expect(reviewerResult.next).toBe("rework-dev");
        // Manifest MUST NOT be in done/ (spec §5c)
        await assertManifestStaysInProgress(tmpRoot, SMOKE_STORY_REF);
    });
});
// ---------------------------------------------------------------------------
// Negative sanity check: if the artifact DOES exist, the reviewer CAN emit
// READY FOR MERGE (verifies the harness itself is correct).
// ---------------------------------------------------------------------------
describe("AC5 negative sanity: if artifact exists, READY FOR MERGE is not blocked", () => {
    it("creates target-file.txt before the session → acResults[1].status === 'pass'", async () => {
        // Create the artifact that was supposed to be built
        await atomicWriteFile(path.join(tmpRoot, SMOKE_ARTIFACT_PATH), "built by dev\n");
        const devTranscript = makeRubberStampDevTranscript(SMOKE_STORY_REF);
        const devResult = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: SMOKE_STORY_REF,
            devTranscript,
        });
        expect(devResult.next).toBe("spawn-reviewer");
        if (devResult.next !== "spawn-reviewer")
            return;
        const sessionResult = await runReviewerSession({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: SMOKE_STORY_REF,
            prNumber: devResult.prNumber,
            execaImpl: makeSmokeStubbedExeca(),
        });
        const ac1Result = sessionResult.acResults[1];
        expect(ac1Result.applicability).toBe("runnable-artifact-check");
        if (ac1Result.applicability !== "runnable-artifact-check")
            return;
        // Artifact exists → pass
        expect(ac1Result.status).toBe("pass");
        // A passing result DOES permit READY FOR MERGE
        const reviewerTranscript = composeReviewerTranscript(sessionResult.acResults);
        expect(reviewerTranscript).toContain("**Verdict: READY FOR MERGE**");
    });
});
