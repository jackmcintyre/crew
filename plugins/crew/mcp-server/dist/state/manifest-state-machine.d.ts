import type { ExecutionManifest } from "../schemas/execution-manifest.js";
/**
 * The canonical state-machine directory names. A manifest at
 * `<targetRepoRoot>/.crew/state/<state>/<ref>.yaml` is
 * "in" the named state by virtue of its parent directory. (NFR8)
 */
export declare const STATE_NAMES: readonly ["to-do", "in-progress", "blocked", "done"];
export type StateName = (typeof STATE_NAMES)[number];
export interface MoveResult {
    from: StateName;
    to: StateName;
    ref: string;
    absFromPath: string;
    absToPath: string;
}
/**
 * Narrow filesystem-injection seam used for testing the EXDEV /
 * spy-on-call-count paths. Production callers must NOT pass `fsImpl` —
 * the default binds to `node:fs/promises`. The interface deliberately
 * exposes ONLY `rename`, `mkdir`, `stat` so a maintainer cannot
 * accidentally introduce a copy+delete fallback (which would violate
 * NFR8's single-syscall atomicity).
 */
export interface FsImpl {
    rename(from: string, to: string): Promise<void>;
    mkdir(dir: string, opts: {
        recursive: true;
    }): Promise<unknown>;
    stat(p: string): Promise<unknown>;
}
/**
 * Move a manifest between two canonical state directories via a
 * single `fs.rename(2)` syscall. This is the ONLY file in
 * `mcp-server/src/**` permitted to invoke `rename` against a
 * state-machine path (enforced by a static guard in
 * `tests/canonical-fs-guard.test.ts`).
 *
 * The function is a pure structural primitive — it does NOT read or
 * write manifest contents, does NOT emit telemetry, does NOT acquire
 * locks. POSIX `rename(2)` (and the macOS/Linux equivalents) is itself
 * the atomicity guarantee within a single filesystem. Cross-filesystem
 * moves are explicitly out of v1 scope: an `EXDEV` errno surfaces as
 * a typed `CrossFilesystemMoveError` with no copy+delete fallback.
 *
 * See Story 1.6, `core-architectural-decisions.md` lines 27–40,
 * NFR8 / NFR9 / NFR19.
 */
export declare function moveBetweenStates(opts: {
    targetRepoRoot: string;
    ref: string;
    from: StateName;
    to: StateName;
    fsImpl?: FsImpl;
}): Promise<MoveResult>;
/**
 * Single load-bearing predicate for the dev-loop claim path.
 *
 * Returns `true` iff the manifest is eligible to be claimed by the dev loop:
 * the manifest must be in the `to-do` state AND must not have been withdrawn
 * via `/crew:plan discard`. Once `withdrawn: true` is set (Story 3.6), the
 * manifest is permanently out of the claim candidate set until an operator
 * hand-edits it back (Story 3.7's territory).
 *
 * **Pure — no I/O.** Epic 5's claim loop imports this predicate as the single
 * source of truth for "withdrawn means skipped". Co-located here with the
 * other state-machine primitives to ensure it is imported from one place.
 *
 * Story 3.6 — `isClaimable` predicate.
 * Epic 5 pickup: the claim loop calls `isClaimable(manifest)` before claiming.
 */
export declare function isClaimable(manifest: ExecutionManifest): boolean;
