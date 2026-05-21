import { createHash } from "node:crypto";
import { MalformedNativeStoryError } from "../../errors.js";
import type { AC, SourceStory } from "../adapter.js";

/**
 * Pure native-story parser — no I/O. The caller (the adapter's
 * `listSourceStories`/`readSourceStory`) is responsible for reading the
 * file and passing the bytes in.
 *
 * Native story body shape (Story 3.4):
 *   # <Title>  (required)
 *   ## Narrative   (required)
 *   ## Acceptance Criteria  (required, must have ≥1 parseable AC)
 *   ## Implementation Notes (optional)
 *   ## Dependencies (optional, bullet list of refs)
 *
 * @see _bmad-output/implementation-artifacts/3-4-native-adapter-planner-subagent-and-plan-skill.md § Task 2
 */
export function parseNativeStory(absPath: string, fileContents: string): SourceStory {
  // Normalise CRLF and strip BOM.
  const text = fileContents.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // H1 — first line matching `# <title>`.
  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Idx === -1) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "H1",
      reason: "no H1 heading found",
    });
  }
  const h1Line = lines[h1Idx]!;
  const h1Match = /^#\s+(.+?)\s*$/.exec(h1Line);
  if (!h1Match) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "H1",
      reason: "H1 heading is empty",
    });
  }
  const title = h1Match[1]!.trim();

  // Split into top-level `## <name>` sections starting after H1.
  const sections = splitTopLevelSections(lines, h1Idx + 1);

  // Narrative (required).
  const narrativeSection = sections.get("Narrative");
  if (!narrativeSection) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "## Narrative",
      reason: "missing required '## Narrative' section",
    });
  }
  const narrative = narrativeSection.bodyLines.join("\n").trim();

  // Acceptance Criteria (required, ≥1 parseable AC).
  const acSection = sections.get("Acceptance Criteria");
  if (!acSection) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "## Acceptance Criteria",
      reason: "missing required '## Acceptance Criteria' section",
    });
  }
  const acceptance_criteria = parseAcceptanceCriteria(acSection.bodyLines, absPath);
  if (acceptance_criteria.length === 0) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "## Acceptance Criteria",
      reason: "no parseable AC blocks found under '## Acceptance Criteria'",
    });
  }

  // Implementation Notes (optional).
  const implSection = sections.get("Implementation Notes");
  const implementation_notes = implSection
    ? implSection.bodyLines.join("\n").trim() || undefined
    : undefined;

  // Dependencies (optional, bullet list of refs).
  const depSection = sections.get("Dependencies");
  const depends_on = depSection ? parseDependencies(depSection.bodyLines, absPath) : [];

  const ulid = deriveUlidFromPath(absPath);
  const ref = `native:${ulid}`;

  const source_hash = createHash("sha256").update(fileContents).digest("hex");

  return {
    ref,
    title,
    narrative,
    acceptance_criteria,
    depends_on,
    implementation_notes,
    raw_path: absPath,
    raw_frontmatter: { title, ref },
    source_hash,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Section = { name: string; bodyLines: string[] };

function splitTopLevelSections(lines: string[], startIdx: number): Map<string, Section> {
  const out = new Map<string, Section>();
  let current: Section | null = null;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) out.set(current.name, current);
      current = { name: m[1]!, bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) out.set(current.name, current);
  return out;
}

/**
 * Parse AC blocks from the body lines of the `## Acceptance Criteria` section.
 *
 * Expected shape per line:
 *   `**AC1:**` or `**AC2 (integration):**`
 * followed by `**Given** … **When** … **Then** …` prose.
 *
 * The `(integration)` parenthetical tag → `kind: "integration"`.
 * Any other tag (including `(user-surface)`) or no tag → `kind: "unit"`.
 */
function parseAcceptanceCriteria(bodyLines: string[], absPath: string): AC[] {
  const headingRe = /^\*\*AC(\d+)(?:\s*\(([^)]+)\))?:\*\*\s*$/;
  const acs: { idx: number; tag: string | undefined; body: string[] }[] = [];
  let current: { idx: number; tag: string | undefined; body: string[] } | null = null;

  for (const raw of bodyLines) {
    const m = headingRe.exec(raw.trim());
    if (m) {
      if (current) acs.push(current);
      current = { idx: parseInt(m[1]!, 10), tag: m[2]?.trim(), body: [] };
      continue;
    }
    if (current) current.body.push(raw);
  }
  if (current) acs.push(current);

  return acs.map((ac) => {
    const text = ac.body
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .trim();

    // Require Given/When/Then prose.
    if (!/\*\*Given\*\*/.test(text) || !/\*\*When\*\*/.test(text) || !/\*\*Then\*\*/.test(text)) {
      throw new MalformedNativeStoryError({
        path: absPath,
        section: `## Acceptance Criteria / AC${ac.idx}`,
        reason: `AC${ac.idx} body must contain **Given**, **When**, and **Then** clauses`,
      });
    }

    const tag = (ac.tag ?? "").toLowerCase();
    const kind: AC["kind"] = tag === "integration" ? "integration" : "unit";
    return { text, kind };
  });
}

/** Ref patterns accepted in `## Dependencies` bullet items. */
const NATIVE_REF_RE = /^native:[0-9A-HJKMNP-TV-Z]{26}$/;
const BMAD_REF_RE = /^bmad:\d+\.\d+$/;

function parseDependencies(bodyLines: string[], absPath: string): string[] {
  const out: string[] = [];
  for (const line of bodyLines) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const ref = m[1]!.trim();
    if (!NATIVE_REF_RE.test(ref) && !BMAD_REF_RE.test(ref)) {
      throw new MalformedNativeStoryError({
        path: absPath,
        section: "## Dependencies",
        reason: `dependency bullet '${ref}' does not parse as a valid ref (expected 'native:<ULID>' or 'bmad:<epic>.<story>')`,
      });
    }
    out.push(ref);
  }
  return out;
}

/**
 * Derive the ULID from the file's basename. The native adapter uses the
 * bare ULID as the filename (`<ULID>.md`) and the colonised form
 * (`native:<ULID>`) as the ref. The parser recovers the ref from the path
 * so there is no ambiguity.
 */
function deriveUlidFromPath(absPath: string): string {
  const base = absPath.split("/").pop() ?? absPath;
  const m = /^([0-9A-HJKMNP-TV-Z]{26})\.md$/.exec(base);
  if (!m) {
    throw new MalformedNativeStoryError({
      path: absPath,
      section: "filename",
      reason: `filename '${base}' does not match the native-story ULID pattern (<26-char ULID>.md)`,
    });
  }
  return m[1]!;
}
