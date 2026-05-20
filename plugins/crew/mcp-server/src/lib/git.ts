import { execa as defaultExeca } from "execa";
import { GitCommitMessageMalformedError } from "../errors.js";

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
const COMMIT_MESSAGE_REGEX = /^[a-z][a-z0-9-]*: [^\s].+$/;

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
 * Refuses calls whose message does not match the required shape AND
 * calls with an empty `paths` set, in both cases BEFORE any
 * subprocess spawn (verified by an `execaImpl` spy in tests).
 *
 * Single-purpose: no retry, no `--no-verify`, no `-S` signing, no
 * `--amend`. Three `execa` calls, in order: `add`, `commit`, then
 * `rev-parse HEAD` to harvest the commit SHA.
 */
export async function gitCommit(opts: {
  targetRepoRoot: string;
  paths: readonly string[];
  message: string;
  role: string;
  execaImpl?: typeof defaultExeca;
}): Promise<GitCommitResult> {
  const { targetRepoRoot, paths, message } = opts;
  const execaImpl = opts.execaImpl ?? defaultExeca;

  if (paths.length === 0) {
    throw new GitCommitMessageMalformedError({
      message,
      paths,
      reason: "paths must not be empty",
    });
  }

  if (!COMMIT_MESSAGE_REGEX.test(message)) {
    throw new GitCommitMessageMalformedError({
      message,
      paths,
      reason: "message does not match required shape",
    });
  }

  await execaImpl("git", ["-C", targetRepoRoot, "add", ...paths]);

  const commitResult = await execaImpl("git", [
    "-C",
    targetRepoRoot,
    "commit",
    "-m",
    message,
  ]);

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
