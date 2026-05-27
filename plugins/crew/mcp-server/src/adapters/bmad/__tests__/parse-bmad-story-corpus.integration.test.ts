/**
 * Corpus integration test for parseBmadStory (Story 5.14 AC2).
 *
 * Walks every .md file in the real repo's _bmad-output/implementation-artifacts/
 * that matches the parser's expected filename pattern (<epic>-<story>-<slug>.md,
 * where epic and story are pure digits). This mirrors the BMAD_FILENAME_RE used
 * by listSourceStories in the BmadAdapter — retro docs, sprint-status.yaml, and
 * sub-story variants with letter suffixes (1-7a, 3-3b, etc.) are skipped exactly
 * as the real scanner skips them.
 *
 * AC2 focus: zero Status-vocabulary MalformedBmadStoryError throws.
 * After Story 5.14 widens the vocabulary to include draft/approved/review,
 * no file in this corpus should fail on `unknown Status value '...'`.
 *
 * Pre-existing AC-heading format failures in Epic 1 stories (authored before
 * the **AC<n>:** convention was established) are out of this story's scope —
 * they are reported but do NOT cause this test to fail. Only Status-vocabulary
 * errors cause failure.
 *
 * Path arithmetic (7 `..` from __dirname to repo root):
 *   __tests__/ → bmad/ → adapters/ → src/ → mcp-server/ → crew/ → plugins/ → repo root
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseBmadStory } from "../parse-bmad-story.js";
import { MalformedBmadStoryError } from "../../../errors.js";

const CORPUS_ROOT = path.resolve(
  __dirname,
  "../../../../../../../_bmad-output/implementation-artifacts",
);

// The filename pattern the BmadAdapter's listSourceStories uses.
const PARSEABLE_FILENAME_RE = /^\d+-\d+-[a-z0-9-]+\.md$/;

// Minimal regex to extract the on-disk Status: value from the first 30 lines.
// Deliberately NOT using the parser's extraction logic to avoid circular assertion.
function extractStatusFromDisk(filePath: string): string | undefined {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").slice(0, 30);
  for (const line of lines) {
    const m = /^Status:\s*(\S.*?)\s*$/.exec(line);
    if (m) return m[1]!;
    // Stop after the first ## heading (parser does the same)
    if (/^##\s/.test(line)) break;
  }
  return undefined;
}

let mdFiles: string[] = [];

beforeAll(() => {
  // Fail fast if the path arithmetic is wrong — protects against future repo-layout changes.
  if (!fs.existsSync(CORPUS_ROOT)) {
    throw new Error(
      `Corpus root does not exist: ${CORPUS_ROOT}\n` +
        `This likely means the 7-segment path arithmetic from __dirname is wrong.\n` +
        `__dirname resolved to: ${__dirname}`,
    );
  }

  mdFiles = fs
    .readdirSync(CORPUS_ROOT)
    .filter((f) => PARSEABLE_FILENAME_RE.test(f))
    .sort()
    .map((f) => path.join(CORPUS_ROOT, f));

  if (mdFiles.length === 0) {
    throw new Error(`No parseable .md files found in corpus root: ${CORPUS_ROOT}`);
  }
});

describe("parseBmadStory corpus integration — zero Status-vocabulary MalformedBmadStoryError throws", () => {
  it("corpus root exists and contains parseable .md files", () => {
    expect(fs.existsSync(CORPUS_ROOT)).toBe(true);
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  it("no file throws MalformedBmadStoryError due to unknown Status value (AC2 gate)", () => {
    // This is the primary AC2 assertion: after vocabulary widening,
    // zero files should throw due to `unknown Status value '...'`.
    // Other pre-existing parse errors (e.g. AC-heading format failures in
    // older Epic 1 stories) are collected separately and do NOT cause this test
    // to fail — they are out of Story 5.14's scope.

    const statusErrors: Array<{ file: string; error: string }> = [];
    const otherErrors: Array<{ file: string; error: string }> = [];

    for (const absPath of mdFiles) {
      const content = fs.readFileSync(absPath, "utf-8");
      try {
        parseBmadStory(absPath, content);
      } catch (err) {
        if (err instanceof MalformedBmadStoryError) {
          const msg = err.message;
          if (msg.includes("unknown Status value")) {
            statusErrors.push({ file: path.basename(absPath), error: msg });
          } else {
            otherErrors.push({ file: path.basename(absPath), error: msg });
          }
        } else {
          throw err; // unexpected error — always re-throw
        }
      }
    }

    // Report pre-existing non-Status errors for observability (not a failure).
    if (otherErrors.length > 0) {
      console.warn(
        `[story-5.14] ${otherErrors.length} pre-existing non-Status parse error(s) in corpus (out of scope for this story):\n` +
          otherErrors.map((e) => `  ${e.file}`).join("\n"),
      );
    }

    // AC2 gate: zero Status-vocabulary errors.
    if (statusErrors.length > 0) {
      const summary = statusErrors.map((e) => `  ${e.file}: ${e.error}`).join("\n");
      throw new Error(
        `${statusErrors.length} file(s) threw MalformedBmadStoryError due to unknown Status value:\n${summary}`,
      );
    }

    console.log(
      `Corpus: ${mdFiles.length} files walked, ${statusErrors.length} Status errors (expected 0), ${otherErrors.length} other pre-existing errors.`,
    );
  });
});

describe("parseBmadStory corpus integration — per-file status round-trip", () => {
  it("every parseable file that parses successfully: raw_frontmatter.status round-trips the on-disk Status: literal", () => {
    if (mdFiles.length === 0) {
      throw new Error("No corpus files loaded — beforeAll may not have run yet");
    }

    const mismatches: Array<{ file: string; onDisk: string | undefined; parsed: unknown }> = [];
    let successCount = 0;

    for (const absPath of mdFiles) {
      const content = fs.readFileSync(absPath, "utf-8");
      const onDiskStatus = extractStatusFromDisk(absPath);

      let result;
      try {
        result = parseBmadStory(absPath, content);
      } catch {
        // Files with other parse errors (AC headings etc.) are skipped here;
        // the Status-error gate above catches Status failures.
        continue;
      }

      successCount++;
      const parsedStatus = result.raw_frontmatter["status"];
      if (parsedStatus !== onDiskStatus) {
        mismatches.push({
          file: path.basename(absPath),
          onDisk: onDiskStatus,
          parsed: parsedStatus,
        });
      }
    }

    if (mismatches.length > 0) {
      const summary = mismatches
        .map((m) => `  ${m.file}: on-disk="${m.onDisk}" parsed="${String(m.parsed)}"`)
        .join("\n");
      throw new Error(`${mismatches.length} status round-trip mismatch(es):\n${summary}`);
    }

    console.log(
      `Round-trip: ${successCount}/${mdFiles.length} files parsed successfully, 0 status mismatches.`,
    );
  });
});
