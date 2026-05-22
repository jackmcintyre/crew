/**
 * AC6 — SKILL.md content structure check — Story 4.3b.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC6:
 *
 *   (i)    `allowed_tools` is exactly {getStatus, mintSessionUlid, claimNextStory,
 *           processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt, Task}.
 *   (ii)   Body contains the `# Inner cycle: dev → reviewer → rework` section.
 *   (iii)  That section contains `invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt`.
 *   (iv)   That section contains `invoke the Task tool with the reviewerPrompt returned by processDevTranscript`.
 *   (v)    That section contains `pass the captured devTranscript to processDevTranscript`.
 *   (vi)   That section contains `pass the captured reviewerTranscript to processReviewerTranscript`.
 *   (vii)  That section contains `MUST pass the transcript verbatim`.
 *   (viii) The `# Failure modes` section names `HandoffGrammarDriftError`, `blocked_by: handoff-grammar`,
 *          `ReviewerGrammarDriftError`, `blocked_by: reviewer-grammar`.
 *
 * Story 4.3b Task 11.1.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";
import { QUEUE_DRAINED_LINE } from "../../tools/claim-next-story.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SKILL_FILE = path.resolve(
  HERE,
  "..", // src/skills/
  "..", // src/
  "..", // mcp-server/
  "..", // plugins/crew/
  "..", // plugins/
  "..", // repo root (worktree)
  "plugins",
  "crew",
  "skills",
  "start",
  "SKILL.md",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  if (!match) {
    throw new Error("SKILL.md has no valid YAML front-matter delimited by ---");
  }
  return { frontmatter: match[1]!, body: match[2]! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AC6 — /crew:start SKILL.md content structure (Story 4.3b)", () => {
  let raw: string;
  let frontmatter: Record<string, unknown>;
  let body: string;

  beforeAll(async () => {
    raw = await fs.readFile(SKILL_FILE, "utf8");
    const split = splitFrontmatter(raw);
    frontmatter = yamlParse(split.frontmatter) as Record<string, unknown>;
    body = split.body;
  });

  it("name field is exactly 'crew:start'", () => {
    expect(frontmatter["name"]).toBe("crew:start");
  });

  it("AC6(i) — allowed_tools equals exactly the 7-tool set for Story 4.3b", () => {
    const allowedTools = new Set(frontmatter["allowed_tools"] as string[]);
    const expected = new Set([
      "getStatus",
      "mintSessionUlid",
      "claimNextStory",
      "processDevTranscript",
      "processReviewerTranscript",
      "buildPersonaSpawnPrompt",
      "Task",
    ]);

    // Set equality: every expected tool is present.
    for (const tool of expected) {
      expect(allowedTools, `Expected allowed_tools to contain '${tool}'`).toContain(tool);
    }
    // No unexpected tools.
    for (const tool of allowedTools) {
      expect(expected, `Unexpected tool '${tool}' in allowed_tools`).toContain(tool);
    }
    expect(allowedTools.size).toBe(expected.size);
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

  it("AC6(vi) — body contains reviewer-transcript handoff anchor", () => {
    expect(body).toContain("pass the captured reviewerTranscript to processReviewerTranscript");
  });

  it("AC6(vii) — body contains absolute-modal verbatim invariant", () => {
    expect(body).toContain("MUST pass the transcript verbatim");
  });

  it("AC6(viii) — # Failure modes section names all required grammar-drift anchors", () => {
    expect(body).toMatch(/^#+ Failure modes/m);
    expect(body).toContain("HandoffGrammarDriftError");
    expect(body).toContain("blocked_by: handoff-grammar");
    expect(body).toContain("ReviewerGrammarDriftError");
    expect(body).toContain("blocked_by: reviewer-grammar");
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
});
