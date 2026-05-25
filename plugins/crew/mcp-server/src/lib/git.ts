import { execa as defaultExeca } from "execa";
import {
  GitCommitMessageMalformedError,
  NegativeCapabilityDeniedError,
  GitBranchNameMalformedError,
  GitPushFailedError,
} from "../errors.js";

export interface GitCommitResult {
  commitSha: string;
  stdout: string;
  stderr: string;
}

/**
 * Required shape for plugin-side commit messages (Story 1.5 AC4 /
 * Epic-1 AC4): `<tool-name>: <ref-or-proposal-id>`. Lowercase tool
 * name (kebab allowed), colon, single space, non-whitespace body of
 * at least two characters.
 *
 * Matches `regenerateStandards: bmad:1.2.3` (architecture example)
 * and `appendPersonaKnowledge: <ulid>` (anticipated later usage).
 *
 * Note: `[a-z][a-z0-9-]*` is lowercase only — `regenerateStandards`
 * is rejected as written, but the architecture example uses that
 * exact string verbatim. We accept lowercase-letter-first plus
 * lowercase/digit/hyphen body to match the spec's stated regex
 * `/^[a-z][a-z0-9-]*: [^\s].+$/`. Tool names that happen to be
 * camelCase in code are written kebab-cased here.
 */
const PLUGIN_INTERNAL_COMMIT_REGEX = /^[a-z][a-z0-9-]*: [^\s].+$/;

/**
 * Required shape for conventional-commits subject lines (Story 4.4).
 * Format: `<type>(<ref>): <subject>` where type is one of the
 * CONVENTIONAL_COMMIT_TYPES set. The ref is the story ref (kebab/digits).
 * The subject is non-empty.
 */
export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "build",
  "ci",
  "perf",
  "style",
  "revert",
] as const;

const CONVENTIONAL_COMMIT_SUBJECT_REGEX =
  /^(feat|fix|refactor|test|docs|chore|build|ci|perf|style|revert)\([a-z0-9-]+\): [^\s].+$/;

/**
 * Branch name pattern: `story/<kebab-alphanumeric>`. The slug-builder
 * in `pr-body.ts` always produces conforming names; this is a
 * defence-in-depth check in `gitCreateBranch`. (Story 4.4 Task 2.1)
 */
const STORY_BRANCH_REGEX = /^story\/[a-z0-9-]+$/;

// ---------------------------------------------------------------------------
// Negative-capability refusal helper (Story 4.4 AC2 / NFR16 / Pattern §9)
// ---------------------------------------------------------------------------

/**
 * The set of flags unconditionally refused by both the `git` and `gh`
 * wrappers in v1. No caller-supplied escape hatch exists in v1.
 *
 * - `--no-verify`: skips git hooks; forbidden globally.
 * - `--force`: bare force push; more dangerous than `--force-with-lease`.
 * - `--force-with-lease`: destructive; refused until an explicit
 *   operator-set escape hatch lands in a future story.
 * - `--force-with-lease=<ref>` (prefix form): same refusal.
 *
 * (Story 4.4 AC2 / NFR16 / Pattern §9)
 */
const NEGATIVE_FLAGS = new Set(["--no-verify", "--force", "--force-with-lease"]);

/**
 * Assert that `args` contains none of the unconditionally forbidden flags.
 * Throws `NegativeCapabilityDeniedError` BEFORE any subprocess spawn on
 * the first offending flag found.
 *
 * Exported so `lib/gh.ts` can re-use without duplicating the set.
 * (Story 4.4 Task 1.3)
 */
export function assertNoNegativeFlags(
  args: readonly string[],
  role: string,
  callSite: "gh" | "git",
): void {
  for (const arg of args) {
    if (
      NEGATIVE_FLAGS.has(arg) ||
      arg.startsWith("--force-with-lease=")
    ) {
      throw new NegativeCapabilityDeniedError({
        attempted_flag: NEGATIVE_FLAGS.has(arg) ? arg : "--force-with-lease",
        role,
        callSite,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// gitCommit (Story 1.5 AC4, extended by Story 4.4 Task 2.3)
// ---------------------------------------------------------------------------

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
export async function gitCommit(opts: {
  targetRepoRoot: string;
  paths: readonly string[];
  message: string;
  role: string;
  messageShape?: "plugin-internal" | "conventional";
  body?: string;
  execaImpl?: typeof defaultExeca;
}): Promise<GitCommitResult> {
  const { targetRepoRoot, paths, message } = opts;
  const messageShape = opts.messageShape ?? "plugin-internal";
  const execaImpl = opts.execaImpl ?? defaultExeca;

  if (paths.length === 0) {
    throw new GitCommitMessageMalformedError({
      message,
      paths,
      reason: "paths must not be empty",
    });
  }

  if (messageShape === "plugin-internal") {
    if (!PLUGIN_INTERNAL_COMMIT_REGEX.test(message)) {
      throw new GitCommitMessageMalformedError({
        message,
        paths,
        reason: "message does not match required shape",
      });
    }
  } else {
    // "conventional"
    if (!CONVENTIONAL_COMMIT_SUBJECT_REGEX.test(message)) {
      throw new GitCommitMessageMalformedError({
        message,
        paths,
        reason:
          "conventional-commits subject does not match required shape " +
          "`<type>(<ref>): <subject>` with recognised type",
      });
    }
  }

  await execaImpl("git", ["-C", targetRepoRoot, "add", ...paths]);

  const commitArgs: string[] = ["-C", targetRepoRoot, "commit", "-m", message];
  if (messageShape === "conventional" && opts.body) {
    commitArgs.push("-m", opts.body);
  }

  const commitResult = await execaImpl("git", commitArgs);

  const revResult = await execaImpl("git", [
    "-C",
    targetRepoRoot,
    "rev-parse",
    "HEAD",
  ]);

  return {
    commitSha: (revResult.stdout ?? "").trim(),
    stdout: commitResult.stdout ?? "",
    stderr: commitResult.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// gitCreateBranch (Story 4.4 Task 2.1)
// ---------------------------------------------------------------------------

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
export async function gitCreateBranch(opts: {
  targetRepoRoot: string;
  branchName: string;
  execaImpl?: typeof defaultExeca;
}): Promise<void> {
  const { targetRepoRoot, branchName } = opts;
  const execaImpl = opts.execaImpl ?? defaultExeca;

  if (!STORY_BRANCH_REGEX.test(branchName)) {
    throw new GitBranchNameMalformedError({ branchName });
  }

  await execaImpl("git", ["-C", targetRepoRoot, "checkout", "-b", branchName]);
}

// ---------------------------------------------------------------------------
// gitPush (Story 4.4 Task 2.2)
// ---------------------------------------------------------------------------

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
export async function gitPush(opts: {
  targetRepoRoot: string;
  branchName: string;
  role: string;
  execaImpl?: typeof defaultExeca;
}): Promise<void> {
  const { targetRepoRoot, branchName } = opts;
  const execaImpl = opts.execaImpl ?? defaultExeca;

  const result = await execaImpl(
    "git",
    ["-C", targetRepoRoot, "push", "-u", "origin", branchName],
    { reject: false },
  );

  if ((result.exitCode ?? 0) !== 0) {
    throw new GitPushFailedError({
      branchName,
      stderr: (result as unknown as { stderr?: string }).stderr ?? "",
    });
  }
}

// ---------------------------------------------------------------------------
// readRecentCommitTitles (Story 2.4 FR85)
// ---------------------------------------------------------------------------

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
export async function readRecentCommitTitles(opts: {
  cwd: string;
  limit?: number;
  execaImpl?: typeof defaultExeca;
}): Promise<string[]> {
  const limit = opts.limit ?? 5;
  const execaImpl = opts.execaImpl ?? defaultExeca;
  const result = await execaImpl("git", ["log", `-${limit}`, "--pretty=%s"], {
    cwd: opts.cwd,
    reject: false,
  });
  if (result.exitCode !== 0) return [];
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// gitInitWithEmptyCommit (Story 4.14 — smoke-harness scratch repo)
// ---------------------------------------------------------------------------

/**
 * Initialise a fresh git repository at `cwd` and create an initial empty
 * commit. Used by `createSmokeScratchRepo` to seed the smoke-harness
 * scratch directory so downstream tools (notably the planner) don't see
 * `git rev-parse failed: HEAD` against a repo with no commits yet.
 *
 * Sequence:
 *   1. `git init -b main` — initialise the repo with a deterministic
 *      default branch name (avoids depending on the operator's
 *      `init.defaultBranch` config).
 *   2. `git -c user.email -c user.name commit --allow-empty -m "<msg>"`
 *      — author the empty commit with inline identity so the call
 *      succeeds even when global git identity is unset (CI, fresh
 *      containers). The `-c` flag scopes the identity to this one
 *      `commit` invocation; the repo's persistent config is untouched.
 *
 * Lives in `lib/git.ts` so the AC6f static guard
 * (`tests/canonical-fs-guard.test.ts`) stays satisfied — no other file
 * may spawn `git` directly. Story 4.14.
 */
export async function gitInitWithEmptyCommit(opts: {
  cwd: string;
  initialCommitMessage?: string;
  execaImpl?: typeof defaultExeca;
}): Promise<void> {
  const execaImpl = opts.execaImpl ?? defaultExeca;
  const message = opts.initialCommitMessage ?? "chore: initialise smoke scratch repo";

  await execaImpl("git", ["-C", opts.cwd, "init", "-b", "main"]);
  await execaImpl("git", [
    "-C",
    opts.cwd,
    "-c",
    "user.email=crew-smoke@local",
    "-c",
    "user.name=crew-smoke",
    "commit",
    "--allow-empty",
    "-m",
    message,
  ]);
}
