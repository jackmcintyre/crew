/**
 * `materialiseDevStoryWorktree` — Story 8.16.
 *
 * Materialises a dedicated git worktree for the drain's generalist-dev step so
 * the dev's branch / commit / PR are produced in a checkout *distinct* from the
 * orchestrating session's `targetRepoRoot`. This closes the two coupled defects
 * the first real end-to-end drain surfaced (2026-05-30, PR #211):
 *
 *   1. The dev edited files in the same checkout the orchestrating session ran
 *      from — interrupted runs left work-in-progress in the shared tree.
 *   2. `runDevTerminalAction` committed via `git add .`, so any stray
 *      uncommitted change present at commit time was swept into the story PR.
 *
 * The dev subagent has no way to change its own cwd (the workflow runtime spawns
 * it pinned to `targetRepoRoot`), so it necessarily edits in `targetRepoRoot`.
 * This module makes the *git work product* — not the editing surface — isolated:
 * it creates a worktree off `base`, transplants ONLY the dev's own changed paths
 * into it (an explicit path set, never `git add .`), and leaves the orchestrating
 * checkout's tree clean of those changes. The branch / commit / push / PR then
 * run with the repo root pointed at the worktree, which shares the same `.git`
 * object store and `origin` remote — so `gh` resolves the same GitHub repo and
 * the cwd-inference snag the 8.5 scope flagged cannot occur.
 *
 * Mirrors the precedent `materialise-pr-branch-worktree.ts` (Story 5.26): a
 * sibling `dev-<ref>-worktree/` under `.crew/state/sessions/<sessionUlid>/`,
 * `git worktree add` off the base, and a best-effort idempotent `cleanup()`.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execa as defaultExeca } from "execa";
import { DevStoryWorktreeError } from "../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevStoryWorktreeResult {
  /** Absolute path to the materialised worktree (the new repo root for the dev's git work). */
  worktreePath: string;
  /** The explicit set of repo-relative paths transplanted into the worktree (the dev's own changes). */
  carriedPaths: string[];
  /** Diagnostic log from the setup phase (stale-worktree reaping, transplant notices, etc.). */
  setupLog: string[];
  /**
   * Best-effort teardown: removes the worktree and restores the orchestrating
   * checkout's working tree to clean of the dev's changes. Errors become
   * warnings, NOT fatal — repeated drains must not accumulate orphaned worktrees,
   * and a failure mid-build must not leave the worktree wedged.
   */
  cleanup: () => Promise<{ warnings: string[] }>;
}

export interface DevStoryWorktreeOpts {
  /** The orchestrating session's checkout — where the dev edited its files. */
  targetRepoRoot: string;
  sessionUlid: string;
  /** Story ref — used to name the worktree path deterministically. */
  ref: string;
  /** Base branch the worktree (and ultimately the PR) is cut from. */
  base: string;
  /**
   * Paths that were already dirty in `targetRepoRoot` BEFORE the dev started.
   * These are excluded from the transplant so an unrelated, pre-existing
   * uncommitted change is never swept into the story commit (AC2). The drain
   * workflow captures this snapshot immediately before spawning the dev.
   * Omitted / empty → every currently-dirty path is treated as the dev's.
   */
  baselineDirtyPaths?: readonly string[];
  /** Test seam — production callers do not pass this. */
  execaImpl?: typeof defaultExeca;
}

// ---------------------------------------------------------------------------
// Internal: run a git subcommand via execa (mirrors the materialise-pr-branch
// precedent — git operations bypass the gh allowlist).
// ---------------------------------------------------------------------------

async function runGit(
  args: string[],
  cwd: string,
  execaImpl: typeof defaultExeca,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execaImpl("git", args, { cwd, reject: false });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
  };
}

/**
 * Parse `git status --porcelain` (v1, NUL-separated) into the set of changed
 * repo-relative paths. Handles renames (`R  old\0new`) by taking the new path.
 * Drops paths under `.crew/state/` — the backlog ledger is the tools' domain and
 * must never ride along in a story commit.
 */
function parsePorcelainZ(stdout: string): string[] {
  const out: string[] = [];
  const records = stdout.split("\0").filter((r) => r.length > 0);
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    // Each record: XY<space>PATH. The two status columns + a space, then path.
    const xy = rec.slice(0, 2);
    const p = rec.slice(3);
    // A rename/copy emits the destination path as the NEXT NUL-record.
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function materialiseDevStoryWorktree(
  opts: DevStoryWorktreeOpts,
): Promise<DevStoryWorktreeResult> {
  const { targetRepoRoot, sessionUlid, ref, base } = opts;
  const execaImpl = opts.execaImpl ?? defaultExeca;
  const baseline = new Set(opts.baselineDirtyPaths ?? []);
  const setupLog: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Snapshot the dev's changed paths in the orchestrating checkout.
  // dev paths = current dirty paths − baseline dirty paths (− .crew/state/**).
  // -------------------------------------------------------------------------
  const statusResult = await runGit(
    ["-C", targetRepoRoot, "status", "--porcelain", "-z"],
    targetRepoRoot,
    execaImpl,
  );
  if (statusResult.exitCode !== 0) {
    throw new DevStoryWorktreeError({
      ref,
      phase: "status",
      underlyingMessage:
        `git status --porcelain failed (exit ${statusResult.exitCode}): ${statusResult.stderr}`,
    });
  }
  const allDirty = parsePorcelainZ(statusResult.stdout);
  const carriedPaths = allDirty.filter(
    (p) =>
      !baseline.has(p) &&
      !p.startsWith(".crew/state/") &&
      p !== ".crew/state",
  );

  // -------------------------------------------------------------------------
  // Step 2: Compute the worktree path and reap any stale worktree there.
  // -------------------------------------------------------------------------
  const worktreePath = path.join(
    targetRepoRoot,
    ".crew",
    "state",
    "sessions",
    sessionUlid,
    `dev-${ref.replace(/[^A-Za-z0-9._-]/g, "-")}-worktree`,
  );

  let staleExists = false;
  try {
    await fs.access(worktreePath);
    staleExists = true;
  } catch {
    // Nothing to reap.
  }
  if (staleExists) {
    setupLog.push(
      `[dev-story-worktree] stale worktree detected at ${worktreePath}; reaping.`,
    );
    const reap = await runGit(
      ["-C", targetRepoRoot, "worktree", "remove", worktreePath, "--force"],
      targetRepoRoot,
      execaImpl,
    );
    if (reap.exitCode !== 0) {
      setupLog.push(
        `[dev-story-worktree] git worktree remove failed (exit ${reap.exitCode}): ${reap.stderr}. ` +
          `Falling back to fs.rm.`,
      );
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
      } catch (rmErr) {
        setupLog.push(
          `[dev-story-worktree] fs.rm also failed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}.`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: git worktree add <path> <base> — a detached-from-base checkout the
  // dev's branch will be created in. `--detach` keeps `base` usable elsewhere;
  // runDevTerminalAction creates the story branch inside the worktree next.
  // -------------------------------------------------------------------------
  const add = await runGit(
    ["-C", targetRepoRoot, "worktree", "add", "--detach", worktreePath, base],
    targetRepoRoot,
    execaImpl,
  );
  if (add.exitCode !== 0) {
    throw new DevStoryWorktreeError({
      ref,
      phase: "worktree-add",
      underlyingMessage:
        `git worktree add ${worktreePath} ${base} failed (exit ${add.exitCode}): ${add.stderr}`,
    });
  }

  // -------------------------------------------------------------------------
  // Step 4: Transplant the dev's own changed paths into the worktree. For each
  // path: if it still exists in targetRepoRoot, copy it across (preserving the
  // dev's edit); if it was deleted, delete it in the worktree too. This stages
  // an EXPLICIT path set — never `git add .` — so a stray pre-existing change
  // (excluded above as baseline) can never ride along (AC2).
  // -------------------------------------------------------------------------
  for (const rel of carriedPaths) {
    const srcAbs = path.join(targetRepoRoot, rel);
    const destAbs = path.join(worktreePath, rel);
    let srcExists = false;
    try {
      await fs.access(srcAbs);
      srcExists = true;
    } catch {
      // Source missing → the dev deleted this path.
    }
    if (srcExists) {
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.cp(srcAbs, destAbs, { recursive: true });
    } else {
      await fs.rm(destAbs, { recursive: true, force: true });
    }
  }
  setupLog.push(
    `[dev-story-worktree] transplanted ${carriedPaths.length} dev path(s) into ${worktreePath}.`,
  );

  // -------------------------------------------------------------------------
  // Step 5: Build cleanup — restore the orchestrating checkout AND remove the
  // worktree. Both are best-effort; failures surface as warnings, not throws.
  // -------------------------------------------------------------------------
  async function cleanup(): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];

    // (a) Restore targetRepoRoot to clean of the dev's changes so the
    //     orchestrating session's tree is left untouched. Tracked dev edits are
    //     reverted; dev-created untracked files are removed. Baseline/stray
    //     changes are left exactly as they were.
    for (const rel of carriedPaths) {
      const checkout = await runGit(
        ["-C", targetRepoRoot, "checkout", "--", rel],
        targetRepoRoot,
        execaImpl,
      );
      if (checkout.exitCode !== 0) {
        // The path was untracked (no committed version to restore) → remove it.
        try {
          await fs.rm(path.join(targetRepoRoot, rel), {
            recursive: true,
            force: true,
          });
        } catch (rmErr) {
          warnings.push(
            `[dev-story-worktree] cleanup: could not restore/remove ${rel}: ` +
              `${rmErr instanceof Error ? rmErr.message : String(rmErr)}.`,
          );
        }
      }
    }

    // (b) Remove the worktree. --force handles a dirty worktree (e.g. failure
    //     mid-build) so it is never left wedged.
    const remove = await runGit(
      ["-C", targetRepoRoot, "worktree", "remove", worktreePath, "--force"],
      targetRepoRoot,
      execaImpl,
    );
    if (remove.exitCode !== 0) {
      warnings.push(
        `[dev-story-worktree] cleanup: git worktree remove ${worktreePath} --force ` +
          `failed (exit ${remove.exitCode}): ${remove.stderr}. ` +
          `Run 'git worktree prune' to clean up.`,
      );
      // Belt-and-braces: also try a raw fs.rm so a future drain's stale-reap
      // does not trip over a half-removed directory.
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await runGit(
          ["-C", targetRepoRoot, "worktree", "prune"],
          targetRepoRoot,
          execaImpl,
        );
      } catch {
        // Already reported above.
      }
    }

    return { warnings };
  }

  return { worktreePath, carriedPaths, setupLog, cleanup };
}
