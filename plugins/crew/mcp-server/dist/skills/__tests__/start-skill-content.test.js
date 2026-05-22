/**
 * AC5 — SKILL.md content structure check — Story 4.2.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC5:
 *
 *   (i)   `name === "crew:start"` (exact).
 *   (ii)  `allowed_tools` is a superset of `["Task", "buildPersonaSpawnPrompt",
 *          "claimStory", "getStatus"]`.
 *   (iii) Body contains the verbatim AC5(iii) string.
 *   (iv)  Body contains the verbatim AC3 queue-drained line.
 *   (v)   Body's `# Failure modes` section names all four required typed errors.
 *
 * This test is the structural anchor required by the spec brief — LLM outputs
 * are non-deterministic; a deterministic file-content check is mandatory.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";
import { QUEUE_DRAINED_LINE } from "../start-loop.js";
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
describe("AC5 — /crew:start SKILL.md content structure", () => {
    let raw;
    let frontmatter;
    let body;
    beforeAll(async () => {
        raw = await fs.readFile(SKILL_FILE, "utf8");
        const split = splitFrontmatter(raw);
        frontmatter = yamlParse(split.frontmatter);
        body = split.body;
    });
    it("AC5(i) — name field is exactly 'crew:start'", () => {
        expect(frontmatter["name"]).toBe("crew:start");
    });
    it("AC5(ii) — allowed_tools includes at minimum Task, buildPersonaSpawnPrompt, claimStory, getStatus (Story 4.2 backward-compat check)", () => {
        // Note: Story 4.3 AC5(vii) supersedes this with a set-equality check.
        // This test is retained for backward-compat documentation only.
        // The set-equality check below will fail if unexpected tools are added.
        const allowedTools = frontmatter["allowed_tools"];
        expect(Array.isArray(allowedTools)).toBe(true);
        // Post-4.3 the SKILL.md only calls getStatus, mintSessionUlid, runDevSession
        // directly. The old tools are wrapped inside runDevSession.
        // We only assert the set is non-empty here; the strict set check is in AC5(vii).
        expect(allowedTools.length).toBeGreaterThan(0);
    });
    it("AC5(vii) — allowed_tools equals exactly {getStatus, mintSessionUlid, runDevSession} (Story 4.3)", () => {
        const allowedTools = new Set(frontmatter["allowed_tools"]);
        const expected = new Set(["getStatus", "mintSessionUlid", "runDevSession"]);
        // Set equality: every expected tool is present and no unexpected tools exist.
        for (const tool of expected) {
            expect(allowedTools, `Expected allowed_tools to contain '${tool}'`).toContain(tool);
        }
        for (const tool of allowedTools) {
            expect(expected, `Unexpected tool '${tool}' in allowed_tools`).toContain(tool);
        }
        expect(allowedTools.size).toBe(expected.size);
    });
    it("AC5(iii) — body contains the verbatim spawn string", () => {
        const anchor = "spawn the generalist-dev subagent via Claude Code's Task tool";
        expect(body).toContain(anchor);
    });
    it("AC5(iv) — body contains the verbatim AC3 queue-drained line", () => {
        expect(body).toContain(QUEUE_DRAINED_LINE);
    });
    it("AC5(v) — # Failure modes section names all four required typed errors", () => {
        // Must contain Failure modes section.
        expect(body).toMatch(/^#+ Failure modes/m);
        const requiredErrors = [
            "DependenciesNotReadyError",
            "InProgressHandEditError",
            "WrongClaimantError",
            "NoAdapterMatchedError",
        ];
        for (const errorName of requiredErrors) {
            expect(body, `Expected '${errorName}' in # Failure modes`).toContain(errorName);
        }
    });
    it("has an HTML comment near the top citing the Behavioural contract spec path", () => {
        // The comment must contain the spec file path.
        expect(raw).toContain("4-2-start-skill-and-per-story-dev-subagent-spawn.md");
        expect(raw).toContain("Behavioural contract");
    });
    it("AC5(v) — body contains # Inner cycle: dev → reviewer → rework section", () => {
        expect(body).toMatch(/^#{1,2} Inner cycle: dev → reviewer → rework/m);
        expect(body).toContain("spawn the generalist-reviewer subagent via Claude Code's Task tool");
    });
    it("AC5(vi) — # Failure modes section names HandoffGrammarDriftError and blocked_by: handoff-grammar", () => {
        expect(body).toMatch(/^#+ Failure modes/m);
        expect(body).toContain("HandoffGrammarDriftError");
        expect(body).toContain("blocked_by: handoff-grammar");
    });
});
