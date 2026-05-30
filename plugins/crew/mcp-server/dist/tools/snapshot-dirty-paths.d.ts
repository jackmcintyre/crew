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
export declare function snapshotDirtyPaths(opts: {
    targetRepoRoot: string;
    execaImpl?: typeof defaultExeca;
}): Promise<SnapshotDirtyPathsResult>;
