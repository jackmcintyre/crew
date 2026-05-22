import { execa as defaultExeca } from "execa";
export interface GitCommitResult {
    commitSha: string;
    stdout: string;
    stderr: string;
}
/**
 * Required shape for conventional-commits subject lines (Story 4.4).
 * Format: `<type>(<ref>): <subject>` where type is one of the
 * CONVENTIONAL_COMMIT_TYPES set. The ref is the story ref (kebab/digits).
 * The subject is non-empty.
 */
export declare const CONVENTIONAL_COMMIT_TYPES: readonly ["feat", "fix", "refactor", "test", "docs", "chore", "build", "ci", "perf", "style", "revert"];
/**
 * Assert that `args` contains none of the unconditionally forbidden flags.
 * Throws `NegativeCapabilityDeniedError` BEFORE any subprocess spawn on
 * the first offending flag found.
 *
 * Exported so `lib/gh.ts` can re-use without duplicating the set.
 * (Story 4.4 Task 1.3)
 */
export declare function assertNoNegativeFlags(args: readonly string[], role: string, callSite: "gh" | "git"): void;
/**
 * Single entrypoint for plugin-side git commits (Story 1.5 AC4).
 * Stages the given `paths` then commits with the given `message`.
 *
 * The static guard in `tests/canonical-fs-guard.test.ts` forbids any
 * file other than this one from spawning `git` directly (AC6f).
 *
 * `role` is accepted for forward-compat (a later story will surface
 * it in the structured telemetry event for the commit). It is NOT
 * yet allowlist-checked — git is reached only from MCP tools that
 * themselves were already role-gated, so an extra git-side allowlist
 * would be redundant in v1.
 *
 * **`messageShape`** (Story 4.4 Task 2.3):
 * - `"plugin-internal"` (default): existing shape `<tool-name>: <ref>`.
 * - `"conventional"`: validates against the conventional-commits
 *   subject regex `^<type>(<ref>): <subject>$`. The `body` field
 *   (already wrapped at 72 chars by the caller) is passed as a second
 *   `-m` flag.
 *
 * Refuses calls whose message does not match the required shape AND
 * calls with an empty `paths` set, in both cases BEFORE any
 * subprocess spawn (verified by an `execaImpl` spy in tests).
 *
 * Single-purpose: no retry, no `--no-verify`, no `-S` signing, no
 * `--amend`. Three `execa` calls (plugin-internal) or four
 * (conventional with body), in order: `add`, `commit`, then
 * `rev-parse HEAD` to harvest the commit SHA.
 */
export declare function gitCommit(opts: {
    targetRepoRoot: string;
    paths: readonly string[];
    message: string;
    role: string;
    messageShape?: "plugin-internal" | "conventional";
    body?: string;
    execaImpl?: typeof defaultExeca;
}): Promise<GitCommitResult>;
/**
 * Create and check out a new branch in the target repo.
 *
 * The branch name MUST match `^story/[a-z0-9-]+$` — a defence-in-depth
 * check that guards against callers bypassing `buildBranchSlug`. Throws
 * `GitBranchNameMalformedError` BEFORE any spawn on regex failure.
 *
 * Runs `git -C <root> checkout -b <branchName>`.
 *
 * (Story 4.4 Task 2.1)
 */
export declare function gitCreateBranch(opts: {
    targetRepoRoot: string;
    branchName: string;
    execaImpl?: typeof defaultExeca;
}): Promise<void>;
/**
 * Push the given branch to `origin` with `-u` (set-upstream).
 *
 * The v1 signature is CLOSED — there is no `args` passthrough. This is
 * structural prevention of `--force-with-lease` / `--no-verify` injection
 * (belt-and-braces alongside the wrapper-level `assertNoNegativeFlags`
 * check). (Story 4.4 Task 2.2 / AC1e)
 *
 * Runs `git -C <root> push -u origin <branchName>`.
 * Throws `GitPushFailedError` on non-zero exit.
 */
export declare function gitPush(opts: {
    targetRepoRoot: string;
    branchName: string;
    role: string;
    execaImpl?: typeof defaultExeca;
}): Promise<void>;
/**
 * Read up to `limit` recent commit titles from the target repo via
 * `git log -<limit> --pretty=%s`. Best-effort: on non-zero exit (no
 * git, no commits, not a repo, etc.) returns `[]`. Used by
 * `readRepoSignals` (Story 2.4 FR85).
 *
 * Lives here so the `canonical-fs-guard.test.ts` AC6f static guard
 * (which forbids any file under `src/**` other than `lib/git.ts` from
 * spawning `git`) stays satisfied.
 */
export declare function readRecentCommitTitles(opts: {
    cwd: string;
    limit?: number;
    execaImpl?: typeof defaultExeca;
}): Promise<string[]>;
