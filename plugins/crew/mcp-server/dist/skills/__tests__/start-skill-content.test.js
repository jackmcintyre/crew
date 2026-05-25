/**
 * AC6 — SKILL.md content structure check — Story 4.3b.
 * AC3 — SKILL.md content structure check — Story 4.3c (revised tool-layer seam architecture).
 * Story 4.6 revision 2 — operator-surface migration anchors.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC6:
 *
 *   (i)    `allowed_tools` is exactly {getStatus, mintSessionUlid, claimNextStory,
 *           processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt,
 *           runReviewerSession, Task} — eight tools, no completeStory.
 *   (ii)   Body contains the `# Inner cycle: dev → reviewer → rework` section.
 *   (iii)  That section contains `invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt`.
 *   (iv)   That section contains `invoke the Task tool with the reviewerPrompt returned by processDevTranscript`.
 *   (v)    That section contains `pass the captured devTranscript to processDevTranscript`.
 *   (vi)   That section contains `invoke processReviewerTranscript` WITHOUT a `reviewerTranscript` param
 *          (Story 4.6 rev-2: the reviewer transcript is no longer passed; the file is the verdict transport).
 *   (vii)  That section contains `MUST pass the transcript verbatim` (dev transcript invariant).
 *   (viii) The `# Failure modes` section names `HandoffGrammarDriftError`, `blocked_by: handoff-grammar`,
 *          and the three new reviewer verdict variants from Story 4.6 rev-2:
 *          `done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`,
 *          `done-blocked-no-session-result`.
 *
 * Story 4.6 rev-2 operator-surface anchors (H3 fix):
 *   - SKILL.md does NOT contain `reviewerTranscript` (deleted param must stay deleted).
 *   - SKILL.md does NOT contain `ReviewerGrammarDriftError` (removed in rev-2).
 *   - SKILL.md contains switch branches for `done-blocked-reviewer-needs-changes`,
 *     `done-blocked-reviewer-blocked`, `done-blocked-no-session-result`.
 *   - SKILL.md references `reviewer-result.json` (the verdict transport introduced in rev-2).
 *
 * Additional AC3 anchors (Story 4.3c revised):
 *   (AC3-vii)  `allowed_tools` equals exactly the 8-tool Story 4.6 set — NO `completeStory` entry.
 *              completeStory is now called internally by processReviewerTranscript, not through
 *              the MCP allowed_tools surface.
 *   (AC3-iii)  Inner-cycle section contains the literal string `completeStory` (referenced as an
 *              internal detail, not as a prose-layer call).
 *   (AC3-iv-new) Inner-cycle section contains `MUST NOT invoke completeStory directly` (new invariant).
 *   (AC3-v)   Inner-cycle section contains `story <ref> moved to done — claiming next` (em dash).
 *   (AC3-vi)  Inner-cycle section contains `claimNextStory` (loop-back step).
 *   (AC3-viii) `# Failure modes` section contains `completeStory`.
 *
 * Story 4.3b Task 11.1; Story 4.3c Task 7; Story 4.6 rev-2 H3 fix.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";
import { QUEUE_DRAINED_LINE } from "../../tools/claim-next-story.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.resolve(HERE, "..", // src/skills/
"..", // src/
"..", // mcp-server/
"..", // plugins/crew/
"..", // plugins/
"..", // repo root (worktree)
"plugins", "crew", "skills", "start", "SKILL.md");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function splitFrontmatter(raw) {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
    if (!match) {
        throw new Error("SKILL.md has no valid YAML front-matter delimited by ---");
    }
    return { frontmatter: match[1], body: match[2] };
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AC6 — /crew:start SKILL.md content structure (Story 4.3b)", () => {
    let raw;
    let frontmatter;
    let body;
    beforeAll(async () => {
        raw = await fs.readFile(SKILL_FILE, "utf8");
        const split = splitFrontmatter(raw);
        frontmatter = yamlParse(split.frontmatter);
        body = split.body;
    });
    it("name field is exactly 'crew:start'", () => {
        expect(frontmatter["name"]).toBe("crew:start");
    });
    it("AC6(i) / AC3(vii) — allowed_tools contains the required tools (no completeStory; Story 4.6 adds runReviewerSession; Story 4.6b adds postReviewerComments; Story 4.8 adds applyReviewerLabels; Story 5.10 adds Write)", () => {
        const allowedTools = new Set(frontmatter["allowed_tools"]);
        const expected = new Set([
            "getStatus",
            "mintSessionUlid",
            "claimNextStory",
            "processDevTranscript",
            "processReviewerTranscript",
            "buildPersonaSpawnPrompt",
            "Task",
            "runReviewerSession", // Story 4.6: added to allowed_tools
            "postReviewerComments", // Story 4.6b: added to allowed_tools
            "applyReviewerLabels", // Story 4.8: added to allowed_tools
            "Write", // Story 5.10: built-in Write tool for transcript persistence (must precede any MCP call)
        ]);
        // Set equality: every expected tool is present.
        for (const tool of expected) {
            expect(allowedTools, `Expected allowed_tools to contain '${tool}'`).toContain(tool);
        }
        // No unexpected tools.
        for (const tool of allowedTools) {
            expect(expected, `Unexpected tool '${tool}' in allowed_tools`).toContain(tool);
        }
        // Story 5.10 adds Write as the 11th tool.
        expect(allowedTools.size).toBe(11);
    });
    it("AC6(ii) — body contains the H1 or H2 heading 'Inner cycle: dev → reviewer → rework'", () => {
        expect(body).toMatch(/^#{1,2} Inner cycle: dev → reviewer → rework/m);
    });
    it("AC6(iii) — body contains dev-spawn invocation site anchor", () => {
        expect(body).toContain("invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt");
    });
    it("AC6(iv) — body contains reviewer-spawn invocation site anchor", () => {
        expect(body).toContain("invoke the Task tool with the reviewerPrompt returned by processDevTranscript");
    });
    it("AC6(v) — body contains dev-transcript handoff anchor", () => {
        expect(body).toContain("pass the captured devTranscript to processDevTranscript");
    });
    it("AC6(vi) / Story-4.6-rev2 — body contains reviewer processReviewerTranscript invocation WITHOUT reviewerTranscript param", () => {
        // Story 4.6 rev-2: the reviewer chat is no longer the verdict transport.
        // processReviewerTranscript is invoked with { targetRepoRoot, sessionUlid, ref, manifestPath } only.
        expect(body).toContain("invoke processReviewerTranscript({ targetRepoRoot, sessionUlid, ref, manifestPath })");
        // Negative: the deleted param must stay deleted.
        expect(body).not.toContain("reviewerTranscript");
    });
    it("AC6(vii) — body contains absolute-modal verbatim invariant (dev transcript)", () => {
        expect(body).toContain("MUST pass the transcript verbatim");
    });
    it("AC6(viii) — # Failure modes section names handoff grammar-drift anchor and rev-2 reviewer variants", () => {
        expect(body).toMatch(/^#+ Failure modes/m);
        expect(body).toContain("HandoffGrammarDriftError");
        expect(body).toContain("blocked_by: handoff-grammar");
        // Story 4.6 rev-2: old grammar-drift errors replaced by file-based verdict variants.
        expect(body).not.toContain("ReviewerGrammarDriftError");
        expect(body).toContain("done-blocked-reviewer-needs-changes");
        expect(body).toContain("done-blocked-reviewer-blocked");
        expect(body).toContain("done-blocked-no-session-result");
    });
    it("Story-4.6-rev2 — SKILL.md does NOT contain ReviewerGrammarDriftError (retired in rev-2)", () => {
        expect(body).not.toContain("ReviewerGrammarDriftError");
    });
    it("Story-4.6-rev2 — inner-cycle section contains new switch branches for all three rev-2 verdict variants", () => {
        const section = extractInnerCycleSection(body);
        expect(section).not.toBe("");
        expect(section).toContain("done-blocked-reviewer-needs-changes");
        expect(section).toContain("done-blocked-reviewer-blocked");
        expect(section).toContain("done-blocked-no-session-result");
    });
    it("Story-4.6-rev2 — SKILL.md references reviewer-result.json (the verdict transport)", () => {
        expect(body).toContain("reviewer-result.json");
    });
    it("body contains the verbatim AC3 queue-drained line", () => {
        expect(body).toContain(QUEUE_DRAINED_LINE);
    });
    it("HTML comment near the top cites the Story 4.3b behavioural contract spec path", () => {
        expect(raw).toContain("4-3b-harness-task-spawn-seam-for-rundevsession.md");
        expect(raw).toContain("Behavioural contract");
    });
    it("body still cites the Story 4.2 spec path (backward-compat)", () => {
        expect(raw).toContain("4-2-start-skill-and-per-story-dev-subagent-spawn.md");
    });
    // ---------------------------------------------------------------------------
    // AC3 — Story 4.3c additions
    // ---------------------------------------------------------------------------
    /** Extract the text from the inner-cycle H1/H2 heading through the next top-level heading. */
    function extractInnerCycleSection(b) {
        // Match only the actual heading line (# or ## prefix), not inline text
        const match = /^#{1,2} Inner cycle: dev → reviewer → rework/m.exec(b);
        if (!match)
            return "";
        const start = match.index;
        // Find the next H1 heading after the section start.
        const rest = b.slice(start);
        const nextH1 = rest.search(/\n# [^\n]/);
        return nextH1 === -1 ? rest : rest.slice(0, nextH1);
    }
    /** Extract the text from the Failure modes heading to end of body. */
    function extractFailureModesSection(b) {
        const start = b.search(/^#+ Failure modes/m);
        if (start === -1)
            return "";
        return b.slice(start);
    }
    it("AC3(iii) — inner-cycle section contains the literal string 'completeStory' (referenced as internal detail)", () => {
        const section = extractInnerCycleSection(body);
        expect(section).not.toBe("");
        expect(section).toContain("completeStory");
    });
    it("AC3(iv-new) — inner-cycle section contains MUST NOT invoke completeStory directly invariant", () => {
        const section = extractInnerCycleSection(body);
        expect(section).not.toBe("");
        expect(section).toContain("MUST NOT invoke completeStory directly");
    });
    it("AC3(v) — inner-cycle section contains verbatim chat-line anchor (em dash U+2014)", () => {
        const section = extractInnerCycleSection(body);
        expect(section).not.toBe("");
        // em dash U+2014, lowercase, no drift
        expect(section).toContain("story <ref> moved to done — claiming next");
    });
    it("AC3(vi) — inner-cycle section contains claimNextStory (loop-back step anchor)", () => {
        const section = extractInnerCycleSection(body);
        expect(section).not.toBe("");
        expect(section).toContain("claimNextStory");
    });
    it("AC3(viii) — # Failure modes section contains completeStory", () => {
        const section = extractFailureModesSection(body);
        expect(section).not.toBe("");
        expect(section).toContain("completeStory");
    });
    it("HTML comment near the top cites the Story 4.3c behavioural contract spec path (revised)", () => {
        expect(raw).toContain("4-3c-call-completestory-after-ready-for-merge.md");
        expect(raw).toContain("Completion seam (revised)");
    });
});
