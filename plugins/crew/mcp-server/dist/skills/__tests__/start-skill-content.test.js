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
    it("AC5(ii) — allowed_tools includes at minimum Task, buildPersonaSpawnPrompt, claimStory, getStatus", () => {
        const allowedTools = frontmatter["allowed_tools"];
        expect(Array.isArray(allowedTools)).toBe(true);
        const required = ["Task", "buildPersonaSpawnPrompt", "claimStory", "getStatus"];
        for (const tool of required) {
            expect(allowedTools, `Expected allowed_tools to include '${tool}'`).toContain(tool);
        }
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
});
