/**
 * Extract acceptance-criteria entries from a story spec file.
 *
 * @see _bmad-output/implementation-artifacts/4-4-dev-subagent-git-push-and-gh-pr-create-terminal-action.md § Behavioural contract
 *
 * (Story 4.4 Task 3.2)
 */

import { promises as fs } from "node:fs";

export interface AcEntry {
  /** AC number as it appears in the spec (e.g. 1 for AC1, 3 for AC3). */
  index: number;
  /** First non-blank line of the AC body, truncated to 120 chars. */
  firstLine: string;
}

/**
 * Read the spec file at `specPath`, extract every AC heading that matches
 * the pattern `**AC<N>...:` (where `N` is one or more digits), and return
 * an array of `{ index, firstLine }` objects in numeric order.
 *
 * The regex matches:
 *   `**AC1:**`, `**AC2 (user-surface):**`, `**AC3 (integration):**`
 *
 * The `firstLine` is the first non-blank line of the AC's body (the text
 * that follows the `**ACN...**` heading line), truncated to 120 characters.
 *
 * Lines that are themselves AC headings are NOT included as firstLine
 * candidates — only the narrative body lines below the heading.
 */
export async function extractAcsFromSpec(specPath: string): Promise<AcEntry[]> {
  const raw = await fs.readFile(specPath, "utf8");
  const lines = raw.split("\n");

  // Regex to identify an AC heading line.
  // Matches: **AC1:** or **AC2 (user-surface):** or **AC3 (integration):**
  const AC_HEADING_RE = /^\*\*AC(\d+)(\s*\([^)]+\))?\s*:\*\*/;

  const results: AcEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = AC_HEADING_RE.exec(line);
    if (!headingMatch) continue;

    const index = parseInt(headingMatch[1]!, 10);

    // Find the first non-blank line after the heading.
    let firstLine = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]!.trim();
      if (candidate.length === 0) continue;
      // Stop if we hit another AC heading (no body between consecutive ACs).
      if (AC_HEADING_RE.test(candidate)) break;
      firstLine = candidate.slice(0, 120);
      break;
    }

    results.push({ index, firstLine });
  }

  // Sort numerically (specs are usually in order, but be defensive).
  results.sort((a, b) => a.index - b.index);

  return results;
}
