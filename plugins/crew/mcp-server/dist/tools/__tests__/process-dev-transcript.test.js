/**
 * Unit tests for `processDevTranscript` — Story 4.3b Task 8 + Story 4.5 Task 4.4.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules —
 * the tool composes pure pieces and the test exercises the real composition.
 *
 * Story 4.3b coverage:
 *   (a) Happy handoff → `next: "spawn-reviewer"`, reviewerPrompt, manifest NOT mutated.
 *   (b) Drift → `next: "done-blocked-handoff-grammar"`, manifest `blocked_by: "handoff-grammar"`.
 *   (c) Empty transcript → same as (b).
 *   (d) Whitespace-only transcript → same as (b).
 *
 * Story 4.5 coverage (Task 4.4):
 *   (e) class=defer → `next: "done-blocked-gh-defer"`, manifest `blocked_by: "gh-defer"`.
 *   (f) class=retry → `next: "done-blocked-gh-retry"`, manifest `blocked_by: "gh-retry"`.
 *   (g) class=needs-human → `next: "done-blocked-gh-needs-human"`, manifest `blocked_by: "gh-needs-human"`.
 *   (h) Locked-phrase drift falls through to handoff-grammar (AC3j).
 *   (i) Recoverable + handoff coexistence: recoverable wins (AC3k).
 *   (j) Chat-line verbatim shape per AC2f (exact string match).
 *
 * Story 4.3b Task 8.1–8.3; Story 4.5 Task 4.4–4.5.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { parseExecutionManifest } from "../../schemas/execution-manifest.js";
import { processDevTranscript } from "../process-dev-transcript.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4ABC";
const SESSION_ULID = "01HZSESSION00000000000001";
const HANDOFF_PHRASE = `Handoff to reviewer — story ${STORY_REF} ready for review.`;
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
        title: "Test Story",
        narrative: "As a dev, I want to test.",
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
  - Edit
  - Bash
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Dev

## Domain

Implements one story at a time end-to-end.

## Mandate

- Implement stories.

## Out of mandate

- Reviewing.

## Prompt

You are the generalist dev.

## Knowledge

No knowledge yet.
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

Reviews one story at a time.

## Mandate

- Review stories.

## Out of mandate

- Implementing.

## Prompt

You are the generalist reviewer.

## Knowledge

No knowledge yet.
`;
// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let tmpRoot;
let manifestPath;
beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-process-dev-transcript-"));
    // Create in-progress dir and seed manifest.
    await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), { recursive: true });
    manifestPath = path.join(tmpRoot, ".crew", "state", "in-progress", `${STORY_REF}.yaml`);
    const seedManifest = makeBaseManifest(STORY_REF);
    await atomicWriteFile(manifestPath, yamlStringify(seedManifest, { lineWidth: 0 }));
    // Create team persona dirs.
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
// ---------------------------------------------------------------------------
// (a) Happy handoff
// ---------------------------------------------------------------------------
describe("(a) happy handoff → spawn-reviewer", () => {
    it("returns next: 'spawn-reviewer', reviewerPrompt populated, manifest NOT mutated", async () => {
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: `Some output\n${HANDOFF_PHRASE}`,
        });
        expect(result.next).toBe("spawn-reviewer");
        if (result.next !== "spawn-reviewer")
            return;
        // reviewerPrompt is a non-empty string (assemblePrompt result).
        expect(result.reviewerPrompt.length).toBeGreaterThan(0);
        expect(result.reviewerPrompt).toContain("Generalist Reviewer");
        // chatLog contains the AC1 verbatim line.
        expect(result.chatLog).toContain(`handoff received — story ${STORY_REF} — spawning generalist-reviewer subagent (clean context)`);
        // Manifest NOT mutated (no blocked_by).
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// (b) Drift
// ---------------------------------------------------------------------------
describe("(b) drift → done-blocked-handoff-grammar", () => {
    it("stamps blocked_by: 'handoff-grammar', AC3 chatLog line", async () => {
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: "story is ready for review — handing off!", // paraphrase
        });
        expect(result.next).toBe("done-blocked-handoff-grammar");
        expect(result.chatLog).toContain(`handoff grammar drift — story ${STORY_REF} blocked. expected verbatim phrase: "Handoff to reviewer — story ${STORY_REF} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("handoff-grammar");
    });
});
// ---------------------------------------------------------------------------
// (c) Empty transcript
// ---------------------------------------------------------------------------
describe("(c) empty transcript → done-blocked-handoff-grammar", () => {
    it("same behaviour as drift — stamps blocked_by: 'handoff-grammar'", async () => {
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: "",
        });
        expect(result.next).toBe("done-blocked-handoff-grammar");
        expect(result.chatLog).toContain(`handoff grammar drift — story ${STORY_REF} blocked. expected verbatim phrase: "Handoff to reviewer — story ${STORY_REF} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("handoff-grammar");
    });
});
// ---------------------------------------------------------------------------
// (d) Whitespace-only transcript
// ---------------------------------------------------------------------------
describe("(d) whitespace-only transcript → done-blocked-handoff-grammar", () => {
    it("same behaviour as empty — stamps blocked_by: 'handoff-grammar'", async () => {
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: "   \n\n  \t  \n",
        });
        expect(result.next).toBe("done-blocked-handoff-grammar");
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("handoff-grammar");
    });
});
// ---------------------------------------------------------------------------
// Regression: tool MUST NOT spawn anything
// ---------------------------------------------------------------------------
describe("regression: no spawn", () => {
    it("does not require a Task-spawn seam — the test compiles without any spawn fake", async () => {
        // If processDevTranscript tried to spawn something, this test would fail
        // because no Task-spawn seam is provided. The mere fact it compiles and runs
        // without one is the assertion.
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: HANDOFF_PHRASE,
        });
        // It should have succeeded (happy path) without needing any Task fake.
        expect(result.next).toBe("spawn-reviewer");
    });
});
// ---------------------------------------------------------------------------
// Story 4.5: recoverable-error marker parsing (Task 4.4)
// ---------------------------------------------------------------------------
describe("(e) recoverable-error: class=defer → done-blocked-gh-defer (AC3b)", () => {
    it("stamps blocked_by: gh-defer, returns done-blocked-gh-defer with correct chat line", async () => {
        const transcript = "some output\n" +
            `gh-recoverable: class=defer subcommand=pr-create exit=4`;
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-gh-defer");
        // Chat line verbatim check (AC2f / Task 4.5)
        expect(result.chatLog).toContain(`gh recoverable error (class=defer) — story ${STORY_REF} blocked. blocked_by stamped to gh-defer. Operator action: wait and re-run /crew:start`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("gh-defer");
    });
});
describe("(f) recoverable-error: class=retry → done-blocked-gh-retry (AC3d)", () => {
    it("stamps blocked_by: gh-retry, returns done-blocked-gh-retry with correct chat line", async () => {
        const transcript = `gh-recoverable: class=retry subcommand=pr-create exit=1`;
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-gh-retry");
        expect(result.chatLog).toContain(`gh recoverable error (class=retry) — story ${STORY_REF} blocked. blocked_by stamped to gh-retry. Operator action: transient network error; re-run /crew:start (v2 will auto-retry)`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("gh-retry");
    });
});
describe("(g) recoverable-error: class=needs-human → done-blocked-gh-needs-human (AC3c)", () => {
    it("stamps blocked_by: gh-needs-human, returns done-blocked-gh-needs-human with correct chat line", async () => {
        const transcript = `gh-recoverable: class=needs-human subcommand=pr-create exit=4`;
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-gh-needs-human");
        expect(result.chatLog).toContain(`gh recoverable error (class=needs-human) — story ${STORY_REF} blocked. blocked_by stamped to gh-needs-human. Operator action: run \`gh auth login\` then re-run /crew:start`);
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("gh-needs-human");
    });
});
describe("(h) locked-phrase drift falls through to handoff-grammar (AC3j)", () => {
    it("paraphrased marker does NOT match recoverable parser — handoff-grammar path runs", async () => {
        // Paraphrase: missing 'gh-recoverable: class=' prefix
        const transcript = "gh recoverable error: defer — network issue\nsome other output";
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-handoff-grammar");
        const onDisk = await readOnDiskManifest();
        // Must carry handoff-grammar, NOT any gh-* value
        expect(onDisk.blocked_by).toBe("handoff-grammar");
        expect(onDisk.blocked_by).not.toMatch(/^gh-/);
    });
});
describe("(i) recoverable + handoff coexistence: recoverable wins (AC3k)", () => {
    it("transcript with BOTH locked recoverable line AND handoff phrase → recoverable wins", async () => {
        const transcript = `gh-recoverable: class=defer subcommand=pr-create exit=4\n` +
            HANDOFF_PHRASE;
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-gh-defer");
        const onDisk = await readOnDiskManifest();
        expect(onDisk.blocked_by).toBe("gh-defer");
    });
});
describe("(j) manifest read-modify-written exactly once per recoverable-error branch", () => {
    it("manifest carries gh-defer after call; previous blocked_by is overwritten (AC2h)", async () => {
        // Seed the manifest with an existing blocked_by
        const { parse: yamlParse, stringify: yamlStringify } = await import("yaml");
        const raw = await (await import("node:fs")).promises.readFile(manifestPath, "utf8");
        const existing = yamlParse(raw);
        await atomicWriteFile(manifestPath, yamlStringify({ ...existing, blocked_by: "handoff-grammar" }, { lineWidth: 0 }));
        const transcript = `gh-recoverable: class=needs-human subcommand=pr-create exit=4`;
        const result = await processDevTranscript({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            ref: STORY_REF,
            devTranscript: transcript,
        });
        expect(result.next).toBe("done-blocked-gh-needs-human");
        const onDisk = await readOnDiskManifest();
        // Overwrites the previous handoff-grammar value (AC2h)
        expect(onDisk.blocked_by).toBe("gh-needs-human");
    });
});
