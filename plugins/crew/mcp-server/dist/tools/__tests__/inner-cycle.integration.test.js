/**
 * Integration tests for the inner dev → reviewer cycle through tool composition
 * — Story 4.3b Task 10; Story 4.3c Task 4.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract
 *   _bmad-output/implementation-artifacts/4-3c-call-completestory-after-ready-for-merge.md § Behavioural contract
 *
 * Composes `processDevTranscript`, `processReviewerTranscript`, `claimNextStory`,
 * and `completeStory` in the order the SKILL.md prose will compose them. The
 * Claude Code `Task` tool is NOT in the loop — this is a unit-level integration
 * test of the MCP layer's composition correctness.
 *
 * Each test case seeds a fixture tmpdir with:
 *   - `.crew/config.yaml` (native adapter)
 *   - `.crew/state/in-progress/<ref>.yaml` (pre-claimed manifest)
 *   - `team/generalist-dev/PERSONA.md`
 *   - `team/generalist-reviewer/PERSONA.md`
 *
 * Covers the AC4 branches (a)–(g):
 *   (a) Happy handoff + READY FOR MERGE.
 *   (b) Rework loop: NEEDS CHANGES × 1 → READY FOR MERGE.
 *   (c) Grammar drift (handoff drift).
 *   (d) Two-iteration rework convergence.
 *   (e) Reviewer grammar drift.
 *   (f) Reviewer BLOCKED passthrough.
 *   (g) Tool count assertion (22 tools, contains new tools, does not contain runDevSession).
 *
 * AC4 (4.3c) — two-story drain with completeStory:
 *   (a)–(g) Two stories driven through claimNextStory → processDevTranscript →
 *           processReviewerTranscript → completeStory, then third claimNextStory
 *           returns queue-drained.
 *   (h) Blocked branch: completeStory NOT called, manifest stays in in-progress/.
 *   (i) Reviewer-grammar-drift branch: same MUST NOT pattern as (h).
 *
 * Story 4.3b Task 10.1–10.4; Story 4.3c Task 4.1–4.10.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { processDevTranscript } from "../process-dev-transcript.js";
import { processReviewerTranscript } from "../process-reviewer-transcript.js";
import { claimNextStory } from "../claim-next-story.js";
import { completeStory } from "../complete-story.js";
import { scanSources } from "../scan-sources.js";
import { registerAllTools } from "../register.js";
import { createServer } from "../../server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4GHI";
const SESSION_ULID = "01HZSESSION00000000000003";
const HANDOFF_PHRASE = `Handoff to reviewer — story ${STORY_REF} ready for review.`;
const READY_FOR_MERGE = `**Verdict: READY FOR MERGE**`;
const NEEDS_CHANGES = `**Verdict: NEEDS CHANGES** [2 issues]`;
const BLOCKED_VERDICT = `**Verdict: BLOCKED**`;
// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
function makeBaseManifest(ref) {
    return {
        ref,
        status: "in-progress",
        adapter: "native",
        source_path: `.crew/native-stories/${ref}.yaml`,
        source_hash: "a".repeat(64),
        depends_on: [],
        acceptance_criteria: [{ text: "Given x, when y, then z.", kind: "integration" }],
        title: "Integration Test Story",
        narrative: "As a dev, I want to integrate test.",
        withdrawn: false,
        claimed_by: SESSION_ULID,
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

Implements stories.

## Mandate

- Implement.

## Out of mandate

- Review.

## Prompt

You are the dev.

## Knowledge

None.
`;
const FIXTURE_REVIEWER_PERSONA_MD = `---
role: generalist-reviewer
domain: "code review in a story scope"
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

# Generalist Reviewer

## Domain

Reviews stories.

## Mandate

- Review.

## Out of mandate

- Implement.

## Prompt

You are the reviewer.

## Knowledge

None.
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
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-inner-cycle-integration-"));
    // .crew state dirs
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "to-do"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "done"), { recursive: true });
    // .crew/config.yaml (native adapter)
    await atomicWriteFile(path.join(tmpRoot, ".crew", "config.yaml"), "adapter: native\n");
    manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`);
    await seedManifest(makeBaseManifest(STORY_REF));
    // team personas
    await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "team", "generalist-reviewer"), { recursive: true });
    await atomicWriteFile(path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"), FIXTURE_DEV_PERSONA_MD);
    await atomicWriteFile(path.join(tmpRoot, "team", "generalist-reviewer", "PERSONA.md"), FIXTURE_REVIEWER_PERSONA_MD);
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
function makeDevOpts(devTranscript) {
    return { targetRepoRoot: tmpRoot, sessionUlid: SESSION_ULID, ref: STORY_REF, devTranscript };
}
function makeReviewerOpts(reviewerTranscript) {
    return {
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        ref: STORY_REF,
        manifestPath,
        reviewerTranscript,
    };
}
// ---------------------------------------------------------------------------
// AC4(a): Happy handoff + READY FOR MERGE
// ---------------------------------------------------------------------------
describe("AC4(a): happy handoff + READY FOR MERGE", () => {
    it("full cycle: spawn-reviewer → done-ready-for-merge, no manifest mutations, verbatim chatLog", async () => {
        const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        expect(devResult.next).toBe("spawn-reviewer");
        if (devResult.next !== "spawn-reviewer")
            return;
        const reviewerResult = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
        expect(reviewerResult.next).toBe("done-ready-for-merge");
        // Cumulative chatLog contains AC1 verbatim line.
        const allChatLog = [...devResult.chatLog, ...reviewerResult.chatLog];
        expect(allChatLog).toContain(`handoff received — story ${STORY_REF} — spawning generalist-reviewer subagent (clean context)`);
        // READY FOR MERGE line.
        expect(allChatLog).toContain(`reviewer verdict: READY FOR MERGE — story ${STORY_REF} ready for merge gate`);
        // No rework_count, no blocked_by.
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBeUndefined();
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// AC4(b): Rework loop — one NEEDS CHANGES → READY FOR MERGE
// ---------------------------------------------------------------------------
describe("AC4(b): NEEDS CHANGES (rework_count undefined → 1) → second cycle READY FOR MERGE", () => {
    it("rework-dev → reworkIteration: 1, then done-ready-for-merge; manifest rework_count: 1; verbatim AC2 line", async () => {
        // First dev turn: happy handoff.
        const devResult1 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        expect(devResult1.next).toBe("spawn-reviewer");
        if (devResult1.next !== "spawn-reviewer")
            return;
        // First reviewer turn: NEEDS CHANGES.
        const reviewerResult1 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
        expect(reviewerResult1.next).toBe("rework-dev");
        if (reviewerResult1.next !== "rework-dev")
            return;
        expect(reviewerResult1.reworkIteration).toBe(1);
        // Second dev turn: happy handoff again.
        const devResult2 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        expect(devResult2.next).toBe("spawn-reviewer");
        if (devResult2.next !== "spawn-reviewer")
            return;
        // Second reviewer turn: READY FOR MERGE.
        const reviewerResult2 = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
        expect(reviewerResult2.next).toBe("done-ready-for-merge");
        // Cumulative chatLog contains AC2 verbatim line with <n>=1.
        const allChatLog = [
            ...devResult1.chatLog,
            ...reviewerResult1.chatLog,
            ...devResult2.chatLog,
            ...reviewerResult2.chatLog,
        ];
        expect(allChatLog).toContain(`reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`);
        // Manifest final state: rework_count: 1.
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBe(1);
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// AC4(c): Grammar drift (handoff drift)
// ---------------------------------------------------------------------------
describe("AC4(c): handoff grammar drift → done-blocked-handoff-grammar", () => {
    it("processReviewerTranscript is NOT called; manifest blocked_by: 'handoff-grammar'; verbatim AC3 line", async () => {
        const devResult = await processDevTranscript(makeDevOpts("story is ready for review — handing off!"));
        expect(devResult.next).toBe("done-blocked-handoff-grammar");
        expect(devResult.chatLog).toContain(`handoff grammar drift — story ${STORY_REF} blocked. expected verbatim phrase: "Handoff to reviewer — story ${STORY_REF} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("handoff-grammar");
    });
});
// ---------------------------------------------------------------------------
// AC4(d): Two-iteration rework convergence
// ---------------------------------------------------------------------------
describe("AC4(d): two-iteration rework: NEEDS CHANGES × 2 → READY FOR MERGE", () => {
    it("final manifest rework_count: 2; AC2 line appears twice with <n>=1 and <n>=2", async () => {
        const allChatLog = [];
        // Cycle 1: dev handoff → NEEDS CHANGES.
        const dev1 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        allChatLog.push(...dev1.chatLog);
        expect(dev1.next).toBe("spawn-reviewer");
        if (dev1.next !== "spawn-reviewer")
            return;
        const rev1 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
        allChatLog.push(...rev1.chatLog);
        expect(rev1.next).toBe("rework-dev");
        if (rev1.next !== "rework-dev")
            return;
        expect(rev1.reworkIteration).toBe(1);
        // Cycle 2: dev handoff → NEEDS CHANGES.
        const dev2 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        allChatLog.push(...dev2.chatLog);
        expect(dev2.next).toBe("spawn-reviewer");
        if (dev2.next !== "spawn-reviewer")
            return;
        const rev2 = await processReviewerTranscript(makeReviewerOpts(NEEDS_CHANGES));
        allChatLog.push(...rev2.chatLog);
        expect(rev2.next).toBe("rework-dev");
        if (rev2.next !== "rework-dev")
            return;
        expect(rev2.reworkIteration).toBe(2);
        // Cycle 3: dev handoff → READY FOR MERGE.
        const dev3 = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        allChatLog.push(...dev3.chatLog);
        if (dev3.next !== "spawn-reviewer")
            return;
        const rev3 = await processReviewerTranscript(makeReviewerOpts(READY_FOR_MERGE));
        allChatLog.push(...rev3.chatLog);
        expect(rev3.next).toBe("done-ready-for-merge");
        // AC2 line appears twice.
        const n1Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 1)`;
        const n2Line = `reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration 2)`;
        expect(allChatLog).toContain(n1Line);
        expect(allChatLog).toContain(n2Line);
        // Final manifest: rework_count: 2, no blocked_by.
        const onDisk = await readOnDiskManifest();
        expect(onDisk.rework_count).toBe(2);
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// AC4(e): Reviewer grammar drift
// ---------------------------------------------------------------------------
describe("AC4(e): reviewer grammar drift → done-blocked-reviewer-grammar", () => {
    it("stamps blocked_by: 'reviewer-grammar'; verbatim reviewer-grammar-drift line", async () => {
        const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        expect(devResult.next).toBe("spawn-reviewer");
        if (devResult.next !== "spawn-reviewer")
            return;
        // Reviewer emits an unrecognised sentinel (not bold-wrapped).
        const reviewerResult = await processReviewerTranscript(makeReviewerOpts("Verdict: APPROVED"));
        expect(reviewerResult.next).toBe("done-blocked-reviewer-grammar");
        expect(reviewerResult.chatLog).toContain(`reviewer grammar drift — story ${STORY_REF} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("reviewer-grammar");
    });
});
// ---------------------------------------------------------------------------
// AC4(f): Reviewer BLOCKED passthrough
// ---------------------------------------------------------------------------
describe("AC4(f): reviewer BLOCKED passthrough → done-blocked-reviewer-verdict", () => {
    it("manifest NOT mutated; chatLog has verbatim BLOCKED line", async () => {
        const devResult = await processDevTranscript(makeDevOpts(HANDOFF_PHRASE));
        expect(devResult.next).toBe("spawn-reviewer");
        if (devResult.next !== "spawn-reviewer")
            return;
        const reviewerResult = await processReviewerTranscript(makeReviewerOpts(BLOCKED_VERDICT));
        expect(reviewerResult.next).toBe("done-blocked-reviewer-verdict");
        expect(reviewerResult.chatLog).toContain(`reviewer verdict: BLOCKED — story ${STORY_REF} awaiting human`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBeUndefined();
        expect(onDisk.rework_count).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// AC4(g): Tool count — 21 tools, contains new tools, does NOT contain runDevSession
// ---------------------------------------------------------------------------
describe("AC4(g): tool count and required tools present", () => {
    it("registered tool list has exactly 22 entries and contains the three new tools but NOT runDevSession", async () => {
        const server = createServer();
        registerAllTools(server);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "ac4g-test-client", version: "0.0.0" }, { capabilities: {} });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            const result = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
            const toolNames = result.tools.map((t) => t.name);
            expect(toolNames).toContain("claimNextStory");
            expect(toolNames).toContain("processDevTranscript");
            expect(toolNames).toContain("processReviewerTranscript");
            expect(toolNames).not.toContain("runDevSession");
            expect(toolNames.length).toBe(22);
        }
        finally {
            await client.close();
            await server.close();
        }
    });
});
// ---------------------------------------------------------------------------
// AC4 (4.3c): Two-story drain with completeStory — green path
// ---------------------------------------------------------------------------
/**
 * Build a minimal native-adapter workspace with two independent stories.
 * Returns { root, refA, refB } where refA and refB are the native refs.
 *
 * This helper mirrors the pattern from claim-complete-loop.integration.test.ts.
 */
async function buildTwoStoryWorkspace(scratch) {
    const root = scratch;
    // Config
    await atomicWriteFile(path.join(root, ".crew", "config.yaml"), "adapter: native\nadapter_config: {}\n");
    // Native stories directory
    const storiesDir = path.join(root, ".crew", "native-stories");
    await fs.mkdir(storiesDir, { recursive: true });
    // State directories
    await fs.mkdir(path.join(root, ".crew", "state", "to-do"), { recursive: true });
    await fs.mkdir(path.join(root, ".crew", "state", "in-progress"), { recursive: true });
    await fs.mkdir(path.join(root, ".crew", "state", "done"), { recursive: true });
    // Story A — ULID that sorts before B alphabetically
    const ulidA = "01J9P0K2N3MZX0YV4S5RTQ4AAA";
    const ulidB = "01J9P0K2N3MZX0YV4S5RTQ4BBB";
    const refA = `native:${ulidA}`;
    const refB = `native:${ulidB}`;
    function makeStoryContent(title) {
        return [
            `# ${title}`,
            "",
            "## Narrative",
            "",
            `As a dev, I want ${title.toLowerCase()} so that I can verify the drain.`,
            "",
            "## Acceptance Criteria",
            "",
            "**AC1 (integration):**",
            `**Given** ${title} is live, **When** accessed, **Then** it works.`,
            "",
            "## Implementation Notes",
            "",
            `Implement ${title}.`,
            "",
            "## Dependencies",
            "",
            "",
        ].join("\n");
    }
    await atomicWriteFile(path.join(storiesDir, `${ulidA}.md`), makeStoryContent("Story A"));
    await atomicWriteFile(path.join(storiesDir, `${ulidB}.md`), makeStoryContent("Story B"));
    // Team personas
    await fs.mkdir(path.join(root, "team", "generalist-dev"), { recursive: true });
    await fs.mkdir(path.join(root, "team", "generalist-reviewer"), { recursive: true });
    await atomicWriteFile(path.join(root, "team", "generalist-dev", "PERSONA.md"), FIXTURE_DEV_PERSONA_MD);
    await atomicWriteFile(path.join(root, "team", "generalist-reviewer", "PERSONA.md"), FIXTURE_REVIEWER_PERSONA_MD);
    // Scan sources to populate to-do/
    await scanSources({ targetRepoRoot: root });
    return { root, refA, refB };
}
describe("AC4 (4.3c): green-path two-story drain calls completeStory and reaches queue-drained", () => {
    let twoStoryRoot;
    beforeEach(async () => {
        twoStoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-ac4-4-3c-two-story-"));
    });
    afterEach(async () => {
        await fs.rm(twoStoryRoot, { recursive: true, force: true });
    });
    it("drives two stories through claim → dev → reviewer-ready → complete, then queue-drained", async () => {
        const sessionUlid = "01HZSESSION4_3CTWO_STORY_0001";
        const { root, refA, refB } = await buildTwoStoryWorkspace(twoStoryRoot);
        const syntheticChatLog = [];
        // ---------- Story A ----------
        // AC4(a): claim story A
        const claimA = await claimNextStory({ targetRepoRoot: root, sessionUlid });
        expect(claimA.next).toBe("spawn-dev");
        if (claimA.next !== "spawn-dev")
            return;
        expect(claimA.ref).toBe(refA);
        syntheticChatLog.push(...claimA.chatLog);
        // Assert manifest moved to in-progress/
        await expect(fs.stat(path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`))).resolves.toBeDefined();
        await expect(fs.stat(path.join(root, ".crew", "state", "to-do", `${refA}.yaml`))).rejects.toThrow();
        const handoffPhraseA = `Handoff to reviewer — story ${refA} ready for review.`;
        // AC4(b): processDevTranscript → spawn-reviewer
        const devA = await processDevTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            devTranscript: handoffPhraseA,
        });
        expect(devA.next).toBe("spawn-reviewer");
        syntheticChatLog.push(...devA.chatLog);
        // AC4(c): processReviewerTranscript → done-ready-for-merge
        const reviewerA = await processReviewerTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            manifestPath: path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`),
            reviewerTranscript: READY_FOR_MERGE,
        });
        expect(reviewerA.next).toBe("done-ready-for-merge");
        syntheticChatLog.push(...reviewerA.chatLog);
        // AC4(d): completeStory moves manifest to done/
        const completeA = await completeStory({ targetRepoRoot: root, ref: refA, sessionUlid });
        expect(completeA.ref).toBe(refA);
        // Assert in-progress/ no longer has refA; done/ does
        await expect(fs.stat(path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`))).rejects.toThrow(); // ENOENT
        const doneManifestARaw = await fs.readFile(path.join(root, ".crew", "state", "done", `${refA}.yaml`), "utf8");
        const doneManifestA = parseExecutionManifest(yamlParse(doneManifestARaw), {
            absPath: path.join(root, ".crew", "state", "done", `${refA}.yaml`),
        });
        expect(doneManifestA.status).toBe("done");
        expect(doneManifestA.claimed_by).toBe(sessionUlid);
        // AC4(e): synthetic chat log contains the verbatim completion line AFTER the READY FOR MERGE line
        const completionLineA = `story ${refA} moved to done — claiming next`;
        syntheticChatLog.push(completionLineA);
        const readyForMergeLineA = `reviewer verdict: READY FOR MERGE — story ${refA} ready for merge gate`;
        const readyIdx = syntheticChatLog.indexOf(readyForMergeLineA);
        const doneIdx = syntheticChatLog.indexOf(completionLineA);
        expect(readyIdx).toBeGreaterThanOrEqual(0);
        expect(doneIdx).toBeGreaterThan(readyIdx);
        // ---------- Story B ----------
        // AC4(a) for story B: claim story B
        const claimB = await claimNextStory({ targetRepoRoot: root, sessionUlid });
        expect(claimB.next).toBe("spawn-dev");
        if (claimB.next !== "spawn-dev")
            return;
        expect(claimB.ref).toBe(refB);
        syntheticChatLog.push(...claimB.chatLog);
        await expect(fs.stat(path.join(root, ".crew", "state", "in-progress", `${refB}.yaml`))).resolves.toBeDefined();
        const handoffPhraseB = `Handoff to reviewer — story ${refB} ready for review.`;
        const devB = await processDevTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refB,
            devTranscript: handoffPhraseB,
        });
        expect(devB.next).toBe("spawn-reviewer");
        syntheticChatLog.push(...devB.chatLog);
        const reviewerB = await processReviewerTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refB,
            manifestPath: path.join(root, ".crew", "state", "in-progress", `${refB}.yaml`),
            reviewerTranscript: READY_FOR_MERGE,
        });
        expect(reviewerB.next).toBe("done-ready-for-merge");
        syntheticChatLog.push(...reviewerB.chatLog);
        const completeB = await completeStory({ targetRepoRoot: root, ref: refB, sessionUlid });
        expect(completeB.ref).toBe(refB);
        await expect(fs.stat(path.join(root, ".crew", "state", "in-progress", `${refB}.yaml`))).rejects.toThrow();
        const doneManifestBRaw = await fs.readFile(path.join(root, ".crew", "state", "done", `${refB}.yaml`), "utf8");
        const doneManifestB = parseExecutionManifest(yamlParse(doneManifestBRaw), {
            absPath: path.join(root, ".crew", "state", "done", `${refB}.yaml`),
        });
        expect(doneManifestB.status).toBe("done");
        expect(doneManifestB.claimed_by).toBe(sessionUlid);
        const completionLineB = `story ${refB} moved to done — claiming next`;
        syntheticChatLog.push(completionLineB);
        const readyForMergeLineB = `reviewer verdict: READY FOR MERGE — story ${refB} ready for merge gate`;
        const readyIdxB = syntheticChatLog.lastIndexOf(readyForMergeLineB);
        const doneIdxB = syntheticChatLog.lastIndexOf(completionLineB);
        expect(readyIdxB).toBeGreaterThanOrEqual(0);
        expect(doneIdxB).toBeGreaterThan(readyIdxB);
        // AC4(f): third claimNextStory → queue-drained
        const claimThird = await claimNextStory({ targetRepoRoot: root, sessionUlid });
        expect(claimThird.next).toBe("queue-drained");
        expect(claimThird.chatLog[0]).toBe("queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.");
        // AC4(g): final on-disk state
        const todoFiles = await fs.readdir(path.join(root, ".crew", "state", "to-do"));
        expect(todoFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
        const inProgressFiles = await fs.readdir(path.join(root, ".crew", "state", "in-progress"));
        expect(inProgressFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
        const doneFiles = await fs.readdir(path.join(root, ".crew", "state", "done"));
        const doneYaml = doneFiles.filter((f) => f.endsWith(".yaml"));
        expect(doneYaml).toHaveLength(2);
        expect(doneYaml).toContain(`${refA}.yaml`);
        expect(doneYaml).toContain(`${refB}.yaml`);
    });
});
// ---------------------------------------------------------------------------
// AC4 (4.3c): Blocked branches do NOT call completeStory
// ---------------------------------------------------------------------------
describe("AC4 (4.3c): blocked branches do NOT call completeStory", () => {
    let blockedRoot;
    beforeEach(async () => {
        blockedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-ac4-4-3c-blocked-"));
    });
    afterEach(async () => {
        await fs.rm(blockedRoot, { recursive: true, force: true });
    });
    /**
     * AC4(h): Reviewer BLOCKED branch — test code does NOT call completeStory,
     * manifest stays in in-progress/, done/ is empty.
     */
    it("AC4(h): reviewer BLOCKED verdict — manifest stays in-progress, done/ empty", async () => {
        const sessionUlid = "01HZSESSION4_3CBLOCKED_001";
        const { root, refA } = await buildTwoStoryWorkspace(blockedRoot);
        // Claim story A
        const claim = await claimNextStory({ targetRepoRoot: root, sessionUlid });
        expect(claim.next).toBe("spawn-dev");
        if (claim.next !== "spawn-dev")
            return;
        expect(claim.ref).toBe(refA);
        const handoffPhrase = `Handoff to reviewer — story ${refA} ready for review.`;
        const devResult = await processDevTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            devTranscript: handoffPhrase,
        });
        expect(devResult.next).toBe("spawn-reviewer");
        // Reviewer returns BLOCKED
        const reviewerResult = await processReviewerTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            manifestPath: path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`),
            reviewerTranscript: BLOCKED_VERDICT,
        });
        expect(reviewerResult.next).toBe("done-blocked-reviewer-verdict");
        // Prose-layer guard: on done-blocked-reviewer-verdict, the test code simulates
        // the SKILL.md prose NOT calling completeStory. We verify the manifest state
        // without invoking completeStory at all.
        const inProgressStat = await fs.stat(path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`));
        expect(inProgressStat.isFile()).toBe(true);
        const doneFiles = await fs.readdir(path.join(root, ".crew", "state", "done"));
        expect(doneFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
        // The chatLog contains the verbatim BLOCKED line (from Story 4.3b)
        expect(reviewerResult.chatLog).toContain(`reviewer verdict: BLOCKED — story ${refA} awaiting human`);
    });
    /**
     * AC4(i): Reviewer grammar drift — manifest stays in-progress/ with
     * blocked_by: "reviewer-grammar", done/ is empty. completeStory NOT called.
     */
    it("AC4(i): reviewer grammar drift — manifest stays in-progress with blocked_by, done/ empty", async () => {
        const sessionUlid = "01HZSESSION4_3CGRAMMAR_001";
        const { root, refA } = await buildTwoStoryWorkspace(blockedRoot);
        // Claim story A
        const claim = await claimNextStory({ targetRepoRoot: root, sessionUlid });
        expect(claim.next).toBe("spawn-dev");
        if (claim.next !== "spawn-dev")
            return;
        expect(claim.ref).toBe(refA);
        const handoffPhrase = `Handoff to reviewer — story ${refA} ready for review.`;
        const devResult = await processDevTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            devTranscript: handoffPhrase,
        });
        expect(devResult.next).toBe("spawn-reviewer");
        // Reviewer emits an unrecognised sentinel (grammar drift)
        const reviewerResult = await processReviewerTranscript({
            targetRepoRoot: root,
            sessionUlid,
            ref: refA,
            manifestPath: path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`),
            reviewerTranscript: "Verdict: APPROVED", // not bold-wrapped — grammar drift
        });
        expect(reviewerResult.next).toBe("done-blocked-reviewer-grammar");
        // Prose-layer guard: on done-blocked-reviewer-grammar, completeStory is NOT called.
        // Manifest stays in in-progress/ with blocked_by: "reviewer-grammar".
        const inProgressRaw = await fs.readFile(path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`), "utf8");
        const onDisk = parseExecutionManifest(yamlParse(inProgressRaw), {
            absPath: path.join(root, ".crew", "state", "in-progress", `${refA}.yaml`),
        });
        expect(onDisk.blocked_by).toBe("reviewer-grammar");
        const doneFiles = await fs.readdir(path.join(root, ".crew", "state", "done"));
        expect(doneFiles.filter((f) => f.endsWith(".yaml"))).toHaveLength(0);
    });
});
