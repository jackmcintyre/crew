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
import { execa as defaultExeca } from "execa";
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
    cleanup: () => Promise<{
        warnings: string[];
    }>;
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
export declare function materialiseDevStoryWorktree(opts: DevStoryWorktreeOpts): Promise<DevStoryWorktreeResult>;
