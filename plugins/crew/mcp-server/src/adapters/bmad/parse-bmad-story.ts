import { createHash } from "node:crypto";
import * as path from "node:path";
import { MalformedBmadStoryError } from "../../errors.js";
import type { AC, SourceStory } from "../adapter.js";
import { mapBmadStatusToExecution, type BmadStatus } from "./map-bmad-status.js";

/**
 * Pure BMad story parser — no I/O. The caller (the adapter's
 * `listSourceStories`/`readSourceStory`) is responsible for reading the
 * file and passing the bytes in.
 *
 * See {@link plugins/crew/docs/spikes/bmad-format.md} for the source
 * shape this parser handles.
 */
export function parseBmadStory(absPath: string, fileContents: string): SourceStory {
  const filename = path.basename(absPath);
  // Story 3.8 Task 1.2: optional [a-z] captures letter suffix (e.g. "b" in "4-8b-...").
  // Group 1=epic, Group 2=story-number, Group 3=optional-suffix, Group 4=slug.
  const filenameMatch = /^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$/.exec(filename);
  if (!filenameMatch) {
    throw new MalformedBmadStoryError({
      path: absPath,
      reason: `filename '${filename}' does not match <epic>-<story>[<letter>]-<slug>.md`,
      details: { filename },
    });
  }
  const epicFromName = filenameMatch[1]!;
  // Story 3.8 Task 1.3: combine number + optional letter suffix.
  const storyFromName = filenameMatch[2]! + (filenameMatch[3] ?? "");
  const slug = filenameMatch[4]!;

  // Strip a leading BOM if present, normalise CRLF -> LF.
  const text = fileContents.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // H1 — first line that starts with "# ".
  const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1Idx === -1) {
    throw new MalformedBmadStoryError({
      path: absPath,
      reason: "no H1 heading found",
    });
  }
  const h1Line = lines[h1Idx]!;
  // Story 3.8 Task 1.4: H1 regex tolerates a letter suffix on the story number.
  const h1Match = /^#\s+Story\s+(\d+)\.(\d+[a-z]?)\s*:\s*(.+?)\s*$/.exec(h1Line);
  if (!h1Match) {
    throw new MalformedBmadStoryError({
      path: absPath,
      reason: `H1 '${h1Line}' does not match '# Story <epic>.<story>[<letter>]: <title>'`,
      details: { h1: h1Line },
    });
  }
  const epicFromH1 = h1Match[1]!;
  const storyFromH1 = h1Match[2]!;
  const title = h1Match[3]!.trim();
  if (epicFromH1 !== epicFromName || storyFromH1 !== storyFromName) {
    throw new MalformedBmadStoryError({
      path: absPath,
      reason:
        `H1 numbering ${epicFromH1}.${storyFromH1} disagrees with ` +
        `filename ${epicFromName}.${storyFromName}`,
      details: {
        h1Epic: epicFromH1,
        h1Story: storyFromH1,
        filenameEpic: epicFromName,
        filenameStory: storyFromName,
      },
    });
  }

  // Status line — first line matching `Status: <value>` after the H1.
  let statusValue: string | undefined;
  for (let i = h1Idx + 1; i < lines.length; i++) {
    const m = /^Status:\s*(\S.*?)\s*$/.exec(lines[i]!);
    if (m) {
      statusValue = m[1]!;
      break;
    }
    // Stop scanning after the first section heading — Status must come early.
    if (/^##\s/.test(lines[i]!)) break;
  }
  // Story 3.8 Task 2.1: missing Status defaults to "backlog" instead of throwing.
  let statusDefaulted: boolean | undefined;
  let statusUnknown: { raw: string; reason: string } | undefined;
  if (statusValue === undefined) {
    statusValue = "backlog";
    statusDefaulted = true;
  } else if (!isKnownBmadStatus(statusValue)) {
    // Story 3.8 Task 3.1: unknown Status — return a valid SourceStory with
    // status_unknown attached. The scan-sources loop routes to blocked/ (not
    // the parser). Do NOT throw here — the parser surfaces facts; routing is
    // the caller's responsibility (Story 3.5 pattern).
    const rawValue = statusValue;
    statusUnknown = { raw: rawValue, reason: "status-vocabulary-unknown" };
    // Use "backlog" for execution-mapping purposes so downstream helpers don't
    // hit an unknown value. The caller must check status_unknown and NOT trust
    // the execution-mapped status for routing decisions.
    statusValue = "backlog";
  }

  // Split into top-level sections keyed by `## <name>` headings.
  const sections = splitTopLevelSections(lines, h1Idx + 1);

  // Narrative: body of `## Story`, excluding any `### *` subsections.
  const storySection = sections.get("Story");
  const narrative = storySection ? extractNarrativeFromStorySection(storySection) : "";

  // Acceptance criteria.
  const acSection = sections.get("Acceptance Criteria");
  const acceptance_criteria = acSection ? parseAcceptanceCriteria(acSection, absPath) : [];

  // Dependencies.
  const depSection = sections.get("Dependencies");
  const depends_on = depSection ? parseDependencies(depSection) : [];

  // Implementation notes.
  const implSection = sections.get("Dev Notes") ?? sections.get("Implementation Notes");
  const implementation_notes = implSection
    ? implSection.bodyLines.join("\n").trim() || undefined
    : undefined;

  // Ship-gate detection (Story 3.5 Task 4.1).
  // BMad stories can be tagged as ship-gate via a `tags:` frontmatter line
  // (if present) or a YAML block before the H1. In practice, BMad story files
  // in v1 do not include YAML front-matter blocks; the "tags" field is typically
  // embedded as a Status-style line. We look for any `Tags:` or `tags:` line
  // containing the literal substring "ship-gate" (case-insensitive) in the
  // preamble before the first section heading.
  //
  // If no such tag is found, `ship_gate` is set to `undefined` — ship-gate
  // detection for BMad stories is operator-driven in v1. A future story may
  // light up full BMad-side ship-gate enforcement without re-touching this parser.
  let shipGate: true | undefined;
  for (let i = h1Idx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^[Tt]ags?:\s*(.+?)\s*$/.exec(line);
    if (m) {
      const tagsRaw = m[1]!.toLowerCase();
      if (tagsRaw.includes("ship-gate")) {
        shipGate = true;
      }
      break;
    }
    if (/^##\s/.test(line)) break;
  }

  const raw_frontmatter: Record<string, unknown> = {
    status: statusValue,
    title,
    // Story 3.8 Tasks 1.5-1.6: id and ref preserve the letter suffix.
    id: `${epicFromName}.${storyFromName}`,
    filename_slug: slug,
    ...(shipGate !== undefined ? { ship_gate: shipGate } : {}),
    // Story 3.8 Task 2.2: flag when Status was absent and defaulted.
    ...(statusDefaulted === true ? { status_defaulted: true } : {}),
    // Story 3.8 Task 3.1: flag when Status was present but unrecognised.
    ...(statusUnknown !== undefined ? { status_unknown: statusUnknown } : {}),
  };

  const source_hash = createHash("sha256").update(fileContents).digest("hex");

  return {
    ref: `bmad:${epicFromName}.${storyFromName}`,
    title,
    narrative,
    acceptance_criteria,
    depends_on,
    implementation_notes,
    raw_path: absPath,
    raw_frontmatter,
    source_hash,
  };
}

function isKnownBmadStatus(s: string): s is BmadStatus {
  return (
    s === "backlog" ||
    s === "ready-for-dev" ||
    s === "in-progress" ||
    s === "done" ||
    s === "optional" ||
    s === "contexted"
  );
}

// Convenience: skip rule for listSourceStories.
export function shouldSkipBmadStatus(status: BmadStatus): boolean {
  return status === "optional";
}

// Re-export the execution mapping so the adapter has a single import surface.
export { mapBmadStatusToExecution };

type Section = { name: string; bodyLines: string[] };

function splitTopLevelSections(lines: string[], startIdx: number): Map<string, Section> {
  const out = new Map<string, Section>();
  let current: Section | null = null;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      // Push prior.
      if (current) out.set(current.name, current);
      current = { name: m[1]!, bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) out.set(current.name, current);
  return out;
}

function extractNarrativeFromStorySection(section: Section): string {
  // Walk lines; stop emitting once we hit a `### ` heading.
  const out: string[] = [];
  for (const line of section.bodyLines) {
    if (/^###\s/.test(line)) break;
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n").trim();
}

function parseAcceptanceCriteria(section: Section, absPath: string): AC[] {
  // AC headings look like `**AC1:**` or `**AC2 (user-surface):**`.
  // We split on lines that match the heading shape.
  const headingRe = /^\*\*AC(\d+)(?:\s*\(([^)]+)\))?:\*\*\s*$/;
  const acs: { idx: number; tag: string | undefined; body: string[] }[] = [];
  let current: { idx: number; tag: string | undefined; body: string[] } | null = null;
  for (const raw of section.bodyLines) {
    const m = headingRe.exec(raw);
    if (m) {
      if (current) acs.push(current);
      current = { idx: parseInt(m[1]!, 10), tag: m[2]?.trim(), body: [] };
      continue;
    }
    if (current) current.body.push(raw);
  }
  if (current) acs.push(current);

  if (acs.length === 0) {
    throw new MalformedBmadStoryError({
      path: absPath,
      reason: "## Acceptance Criteria section contains no recognisable **AC<n>:** headings",
    });
  }

  return acs.map((ac) => {
    // Strip HTML comments. Strip trailing whitespace per line.
    const text = ac.body
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .trim();
    const tag = (ac.tag ?? "").toLowerCase();
    const kind: AC["kind"] = tag === "integration" || tag === "user-surface" ? "integration" : "unit";
    return { text, kind };
  });
}

function parseDependencies(section: Section): string[] {
  const out: string[] = [];
  for (const line of section.bodyLines) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const ref = normaliseDepRef(m[1]!);
    if (ref) out.push(ref);
  }
  return out;
}

function normaliseDepRef(raw: string): string | null {
  // Accept `bmad:<epic>.<story>` directly.
  const direct = /^bmad:(\d+)\.(\d+)\b/.exec(raw);
  if (direct) return `bmad:${direct[1]}.${direct[2]}`;
  // Accept `<epic>-<story>-<slug>` (slug optional).
  const fileStyle = /^(\d+)-(\d+)(?:-[a-z0-9-]+)?\b/.exec(raw);
  if (fileStyle) return `bmad:${fileStyle[1]}.${fileStyle[2]}`;
  return null;
}
