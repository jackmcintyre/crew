/**
 * `snapshotDirtyPaths` tool — Story 8.16.
 *
 * Read-only snapshot of the repo-relative paths that are already dirty in
 * `targetRepoRoot` at the moment of the call (`git status --porcelain`). The
 * drain workflow calls this immediately BEFORE spawning the generalist-dev so
 * `runDevTerminalAction` can subtract this baseline from the dev's changes and
 * transplant ONLY the dev's own files into its isolated worktree — an unrelated,
 * pre-existing uncommitted change is therefore never swept into the story PR
 * (Story 8.16 AC2).
 *
 * Pure read: no branch, no commit, no state mutation. Returns `{ dirtyPaths }`.
 * On a non-zero `git status` (not a repo, etc.) returns an empty list rather
 * than throwing — a missing baseline degrades gracefully to "carry all current
 * changes", which still isolates the orchestrating checkout.
 */

import { execa as defaultExeca } from "execa";

export interface SnapshotDirtyPathsResult {
  dirtyPaths: string[];
}

/**
 * Parse `git status --porcelain -z` (NUL-separated) into changed repo-relative
 * paths. Renames/copies (`R`/`C`) emit the destination path as the next record.
 */
function parsePorcelainZ(stdout: string): string[] {
  const out: string[] = [];
  const records = stdout.split("\0").filter((r) => r.length > 0);
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const xy = rec.slice(0, 2);
    const p = rec.slice(3);
    if (xy[0] === "R" || xy[0] === "C") {
      const dest = records[i + 1];
      if (dest !== undefined) {
        out.push(dest);
        i++;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export async function snapshotDirtyPaths(opts: {
  targetRepoRoot: string;
  execaImpl?: typeof defaultExeca;
}): Promise<SnapshotDirtyPathsResult> {
  const { targetRepoRoot } = opts;
  const execaImpl = opts.execaImpl ?? defaultExeca;

  const result = await execaImpl(
    "git",
    ["-C", targetRepoRoot, "status", "--porcelain", "-z"],
    { reject: false },
  );
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : 1;
  if (exitCode !== 0) {
    return { dirtyPaths: [] };
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  return { dirtyPaths: parsePorcelainZ(stdout) };
}
