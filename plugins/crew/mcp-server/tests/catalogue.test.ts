import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCatalogueRole } from "../src/validators/catalogue-role.js";
import { CatalogueRoleMalformedError } from "../src/errors.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE_DIR = path.resolve(HERE, "..", "..", "catalogue");

/**
 * The fixed v1 catalogue roster. Story 2.1 ACs reference this exact
 * set of 10 file basenames. Any addition / removal / rename is a
 * breaking change and must update this list deliberately.
 */
const EXPECTED_ROSTER = [
  "hiring-manager.md",
  "planner.md",
  "generalist-dev.md",
  "generalist-reviewer.md",
  "retro-analyst.md",
  "orchestrator.md",
  "security-specialist.md",
  "test-specialist.md",
  "docs-specialist.md",
  "debugger.md",
] as const;

describe("Story 2.1 — catalogue file format and shipped role templates", () => {
  describe("AC1: catalogue directory contains exactly the v1 roster", () => {
    it("lists exactly the 10 expected files (plus the `.gitkeep` placeholder)", async () => {
      const entries = await fs.readdir(CATALOGUE_DIR);
      const markdown = entries.filter((e) => e.endsWith(".md")).sort();
      expect(markdown).toEqual([...EXPECTED_ROSTER].sort());
    });
  });

  describe("AC2 / AC4: every shipped catalogue file parses against the schema", () => {
    for (const filename of EXPECTED_ROSTER) {
      it(`${filename} parses with required frontmatter and required sections`, async () => {
        const abs = path.join(CATALOGUE_DIR, filename);
        const raw = await fs.readFile(abs, "utf8");
        const parsed = parseCatalogueRole(raw, abs);

        // Frontmatter contract.
        expect(parsed.role).toBe(filename.replace(/\.md$/, ""));
        expect(parsed.domain.length).toBeGreaterThan(0);
        expect(["opus", "sonnet", "haiku"]).toContain(parsed.model_tier);
        expect(parsed.tools_allow.length).toBeGreaterThan(0);
        expect(Array.isArray(parsed.gh_allow)).toBe(true);
        expect(parsed.locked_phrases.handoff.length).toBeGreaterThan(0);
        expect(parsed.locked_phrases.yield.length).toBeGreaterThan(0);
        expect(parsed.locked_phrases.verdict.length).toBeGreaterThan(0);

        // Section contract.
        expect(parsed.sections.Domain.length).toBeGreaterThan(0);
        expect(parsed.sections.Mandate.length).toBeGreaterThan(0);
        expect(parsed.sections["Out of mandate"].length).toBeGreaterThan(0);
        expect(parsed.sections.Prompt.length).toBeGreaterThan(0);

        // sourcePath stamp.
        expect(parsed.sourcePath).toBe(abs);
      });
    }
  });

  describe("AC3 / AC4: domains are distinct across the v1 catalogue", () => {
    it("no two shipped catalogue files share a `domain:` string", async () => {
      const domains: { role: string; domain: string }[] = [];
      for (const filename of EXPECTED_ROSTER) {
        const abs = path.join(CATALOGUE_DIR, filename);
        const raw = await fs.readFile(abs, "utf8");
        const parsed = parseCatalogueRole(raw, abs);
        domains.push({ role: parsed.role, domain: parsed.domain });
      }
      const seen = new Map<string, string>();
      const collisions: string[] = [];
      for (const { role, domain } of domains) {
        const prior = seen.get(domain);
        if (prior) {
          collisions.push(`'${domain}': ${prior} and ${role}`);
        } else {
          seen.set(domain, role);
        }
      }
      expect(collisions).toEqual([]);
      expect(new Set(domains.map((d) => d.domain)).size).toBe(EXPECTED_ROSTER.length);
    });
  });

  describe("parser: error paths", () => {
    it("throws CatalogueRoleMalformedError when the file has no frontmatter opener", () => {
      const bad = "# Role\n\n## Domain\nx\n";
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });

    it("throws CatalogueRoleMalformedError on missing required frontmatter key", () => {
      const bad = [
        "---",
        "role: foo",
        "domain: bar",
        "model_tier: sonnet",
        "tools_allow: [Read]",
        // locked_phrases missing on purpose
        "---",
        "# Foo",
        "## Domain",
        "x",
        "## Mandate",
        "x",
        "## Out of mandate",
        "x",
        "## Prompt",
        "x",
        "",
      ].join("\n");
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });

    it("throws CatalogueRoleMalformedError on unknown frontmatter key", () => {
      const bad = [
        "---",
        "role: foo",
        "domain: bar",
        "model_tier: sonnet",
        "tools_allow: [Read]",
        "gh_allow: []",
        "locked_phrases:",
        "  handoff: a",
        "  yield: b",
        "  verdict: c",
        "surprise: nope",
        "---",
        "# Foo",
        "## Domain",
        "x",
        "## Mandate",
        "x",
        "## Out of mandate",
        "x",
        "## Prompt",
        "x",
        "",
      ].join("\n");
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });

    it("throws CatalogueRoleMalformedError when a required '##' section is missing", () => {
      const bad = [
        "---",
        "role: foo",
        "domain: bar",
        "model_tier: sonnet",
        "tools_allow: [Read]",
        "gh_allow: []",
        "locked_phrases:",
        "  handoff: a",
        "  yield: b",
        "  verdict: c",
        "---",
        "# Foo",
        "## Domain",
        "x",
        "## Mandate",
        "x",
        // 'Out of mandate' missing
        "## Prompt",
        "x",
        "",
      ].join("\n");
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });

    it("rejects non-kebab-case role ids", () => {
      const bad = [
        "---",
        "role: FooBar",
        "domain: bar",
        "model_tier: sonnet",
        "tools_allow: [Read]",
        "gh_allow: []",
        "locked_phrases:",
        "  handoff: a",
        "  yield: b",
        "  verdict: c",
        "---",
        "## Domain",
        "x",
        "## Mandate",
        "x",
        "## Out of mandate",
        "x",
        "## Prompt",
        "x",
        "",
      ].join("\n");
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });

    it("rejects invalid model_tier values", () => {
      const bad = [
        "---",
        "role: foo",
        "domain: bar",
        "model_tier: turbo",
        "tools_allow: [Read]",
        "gh_allow: []",
        "locked_phrases:",
        "  handoff: a",
        "  yield: b",
        "  verdict: c",
        "---",
        "## Domain",
        "x",
        "## Mandate",
        "x",
        "## Out of mandate",
        "x",
        "## Prompt",
        "x",
        "",
      ].join("\n");
      expect(() => parseCatalogueRole(bad, "/fake/path.md")).toThrow(
        CatalogueRoleMalformedError,
      );
    });
  });
});
