/**
 * Story 4.14 AC3 — structural-anchor test for the `/crew:smoke-setup` SKILL.md.
 *
 * Mirrors `start-skill-content.test.ts`: parses the on-disk skill file's YAML
 * front-matter, then asserts the five step labels AND each step's checkpoint
 * MCP-tool name are present in the body. The intent (per Epic-4 retro
 * carry-forward on locked-phrase grammar drift) is that prose changes which
 * silently remove a step or rename a checkpoint tool trip this test rather
 * than discover the regression in a future smoke run.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";

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
  "smoke-setup",
  "SKILL.md",
);

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  if (!match) {
    throw new Error("SKILL.md has no valid YAML front-matter delimited by ---");
  }
  return { frontmatter: match[1]!, body: match[2]! };
}

describe("Story 4.14 AC3 — /crew:smoke-setup SKILL.md structural anchors", () => {
  let raw: string;
  let frontmatter: Record<string, unknown>;
  let body: string;

  beforeAll(async () => {
    raw = await fs.readFile(SKILL_FILE, "utf8");
    const split = splitFrontmatter(raw);
    frontmatter = yamlParse(split.frontmatter) as Record<string, unknown>;
    body = split.body;
  });

  it("name field is exactly 'crew:smoke-setup'", () => {
    expect(frontmatter["name"]).toBe("crew:smoke-setup");
  });

  it("allowed_tools contains the four checkpoint MCP tools", () => {
    const allowedTools = new Set(frontmatter["allowed_tools"] as string[]);
    for (const tool of [
      "createSmokeScratchRepo",
      "getTeamSnapshot",
      "readBacklogInventory",
      "listClaimableTodos",
    ]) {
      expect(allowedTools, `Expected allowed_tools to contain '${tool}'`).toContain(tool);
    }
  });

  // -------------------------------------------------------------------------
  // AC3: five step labels and their checkpoint MCP-tool names are present.
  // -------------------------------------------------------------------------

  const stepAnchors: ReadonlyArray<{ stepNumber: number; name: string; tool: string | null }> = [
    { stepNumber: 1, name: "scratch-repo", tool: "createSmokeScratchRepo" },
    { stepNumber: 2, name: "skip-hiring", tool: "getTeamSnapshot" },
    { stepNumber: 3, name: "plan", tool: "readBacklogInventory" },
    { stepNumber: 4, name: "scan", tool: "listClaimableTodos" },
    // step 5 (start) has no MCP checkpoint — it's the terminal handoff line.
    { stepNumber: 5, name: "start", tool: null },
  ];

  for (const { stepNumber, name, tool } of stepAnchors) {
    it(`step ${stepNumber} label '${name}' is present in body`, () => {
      // Match either the numbered-list "1. **scratch-repo**" anchor or the
      // emitted "[smoke-setup] step N (<name>):" log line — the AC requires
      // BOTH, so we assert both shapes individually.
      expect(body).toMatch(new RegExp(`\\*\\*${name}\\*\\*`));
      expect(body).toContain(`[smoke-setup] step ${stepNumber} (${name}):`);
    });

    if (tool) {
      it(`step ${stepNumber} checkpoint cites MCP tool '${tool}'`, () => {
        expect(body).toContain(tool);
      });
    }
  }

  it("body contains the terminal 'Ready. Run /crew:start in this scratch repo.' handoff line", () => {
    expect(body).toContain("Ready. Run /crew:start in this scratch repo.");
  });

  it("body explicitly forbids auto-invoking /crew:start", () => {
    expect(body).toContain("Do NOT auto-invoke `/crew:start`");
  });

  it("body cites the Story 4.14 behavioural contract spec path", () => {
    expect(raw).toContain("4-14-smoke-harness-wrapper-skill.md");
  });

  it("body documents the `[smoke-setup] step N (<name>): ok` log-line shape", () => {
    expect(body).toContain("[smoke-setup] step N (<name>): ok");
  });

  it("body documents the failure log-line shape", () => {
    expect(body).toContain("[smoke-setup] step N (<name>): FAILED — <reason>");
  });

  it("body warns the operator about the --plugin-dir launch requirement", () => {
    expect(body).toContain("--plugin-dir");
  });
});
