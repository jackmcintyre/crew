/**
 * Regression tests for concurrent git-lock-contention retry in the mutating
 * git helpers — `gitCreateBranch`, `gitCommit`, `gitPush` (src/lib/git.ts).
 *
 * Concurrent drain workers (Story 8.22) run these ops against the SAME shared
 * `.git` (worktrees share the common dir; they push to one origin). Git does NOT
 * serialise concurrent ref/config/push transactions — the loser exits non-zero
 * with a transient lock error. This surfaced as a flaky `concurrent-drains-
 * isolation` test that reds CI under load. The helpers now retry transient lock
 * failures with a short backoff and re-throw any non-lock failure unchanged.
 *
 * These tests are deterministic — they inject lock failures via a stub `execa`
 * (which throws on a git failure exactly as the real execa reject does, and
 * returns a non-zero result for the reject:false push path) and a no-op sleep,
 * so no real process races.
 *
 * vitest: plugins/crew/mcp-server/src/lib/__tests__/git-lock-retry.test.ts
 */

import { describe, expect, it } from "vitest";
import { gitCreateBranch, gitCommit, gitPush } from "../git.js";
import { GitPushFailedError } from "../../errors.js";

const LOCK = "fatal: could not lock ref 'refs/heads/story/x': Unable to create '.git/refs/heads/story/x.lock': File exists";
const NON_LOCK = "fatal: invalid reference: no-such-thing";
const noopSleep = async (): Promise<void> => {};

/** An execa-shaped thrown error (mirrors execa's reject: carries .stderr/.exitCode). */
function execaError(stderr: string): Error {
  const e = new Error(`Command failed with exit code 128: git\n${stderr}`) as Error & {
    stderr: string;
    exitCode: number;
  };
  e.stderr = stderr;
  e.exitCode = 128;
  return e;
}

function subcmd(args: readonly string[]): string {
  // args are like ["-C", root, "<subcmd>", ...] or ["-C", root, "push", ...]
  return args[2] ?? "";
}

describe("gitCreateBranch — lock-contention retry", () => {
  it("retries checkout -b on a transient lock error, then succeeds", async () => {
    let checkouts = 0;
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      if (subcmd(args) === "checkout") {
        checkouts += 1;
        if (checkouts === 1) throw execaError(LOCK);
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as unknown as Parameters<typeof gitCreateBranch>[0]["execaImpl"];

    await expect(
      gitCreateBranch({ targetRepoRoot: "/repo", branchName: "story/x", execaImpl, sleepImpl: noopSleep }),
    ).resolves.toBeUndefined();
    expect(checkouts).toBe(2);
  });

  it("does NOT retry a non-lock checkout failure — re-throws the original error", async () => {
    let checkouts = 0;
    const original = execaError(NON_LOCK);
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      if (subcmd(args) === "checkout") {
        checkouts += 1;
        throw original;
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as unknown as Parameters<typeof gitCreateBranch>[0]["execaImpl"];

    await expect(
      gitCreateBranch({ targetRepoRoot: "/repo", branchName: "story/x", execaImpl, sleepImpl: noopSleep }),
    ).rejects.toBe(original);
    expect(checkouts).toBe(1);
  });
});

describe("gitCommit — lock-contention retry on the commit", () => {
  it("retries the commit on a transient lock error, then returns the SHA", async () => {
    let commits = 0;
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      const s = subcmd(args);
      if (s === "commit") {
        commits += 1;
        if (commits === 1) throw execaError(LOCK);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (s === "rev-parse") return { stdout: "abc123\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 }; // add
    }) as unknown as Parameters<typeof gitCommit>[0]["execaImpl"];

    const result = await gitCommit({
      targetRepoRoot: "/repo",
      paths: ["src/x.ts"],
      message: "append-knowledge: bmad-8.23",
      role: "generalist-dev",
      execaImpl,
      sleepImpl: noopSleep,
    });

    expect(result.commitSha).toBe("abc123");
    expect(commits).toBe(2);
  });
});

describe("gitPush — lock-contention retry", () => {
  it("retries push on a transient lock error, then succeeds", async () => {
    let pushes = 0;
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      if (subcmd(args) === "push") {
        pushes += 1;
        if (pushes === 1) return { stdout: "", stderr: LOCK, exitCode: 128 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as unknown as Parameters<typeof gitPush>[0]["execaImpl"];

    await expect(
      gitPush({ targetRepoRoot: "/repo", branchName: "story/x", role: "generalist-dev", execaImpl, sleepImpl: noopSleep }),
    ).resolves.toBeUndefined();
    expect(pushes).toBe(2);
  });

  it("does NOT retry a non-lock push failure — throws GitPushFailedError after one attempt", async () => {
    let pushes = 0;
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      if (subcmd(args) === "push") {
        pushes += 1;
        return { stdout: "", stderr: "fatal: remote rejected", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as unknown as Parameters<typeof gitPush>[0]["execaImpl"];

    await expect(
      gitPush({ targetRepoRoot: "/repo", branchName: "story/x", role: "generalist-dev", execaImpl, sleepImpl: noopSleep }),
    ).rejects.toBeInstanceOf(GitPushFailedError);
    expect(pushes).toBe(1);
  });

  it("gives up after the attempt budget when the push lock never clears", async () => {
    let pushes = 0;
    const execaImpl = (async (_cmd: string, args: readonly string[]) => {
      if (subcmd(args) === "push") {
        pushes += 1;
        return { stdout: "", stderr: LOCK, exitCode: 128 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }) as unknown as Parameters<typeof gitPush>[0]["execaImpl"];

    await expect(
      gitPush({ targetRepoRoot: "/repo", branchName: "story/x", role: "generalist-dev", execaImpl, sleepImpl: noopSleep }),
    ).rejects.toBeInstanceOf(GitPushFailedError);
    expect(pushes).toBe(5);
  });
});
