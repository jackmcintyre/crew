/**
 * Integration tests for the drain's dev-step worktree isolation — Story 8.16.
 *
 * Exercises `runDevTerminalAction` in its default (worktree) mode against a real
 * tmpdir git repo with a real `origin` (a sibling bare repo, so `git push`
 * genuinely succeeds), stubbing ONLY `gh pr create` (the network terminal
 * action). Asserts:
 *
 *   AC1 — a worktree was created for the story and the dev's changes are
 *         committed inside it, while `git -C <targetRepoRoot> status --porcelain`
 *         is clean of the dev's changes after the step.
 *   AC2 — an unrelated, pre-existing uncommitted change is NOT in the story
 *         commit (the commit stages an explicit dev-only path set, never
 *         `git add .`).
 *   AC3 — the PR is opened against the expected branch (the worktree's git
 *         context resolves the right repo) and no leftover worktree for the
 *         story remains registered after the step returns (success AND failure).
 *
 * vitest: plugins/crew/mcp-server/src/tools/__tests__/dev-worktree-isolation.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa as realExeca } from "execa";
import { stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { runDevTerminalAction } from "../run-dev-terminal-action.js";
import { snapshotDirtyPaths } from "../snapshot-dirty-paths.js";
import { GhPrCreateFailedError } from "../../errors.js";
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const REF = "8-16-per-dev-worktree";
const TITLE = "Per-dev worktree on the drain path";
const TYPE = "feat";
const BODY = "Isolate the dev's git work product inside a dedicated worktree.";
const SUMMARY = "Worktree isolation on the drain dev step.";
const FAKE_PR_URL = "https://github.com/owner/repo/pull/816";
const SESSION_ULID = "01HZSESSION00000000008160";
const SOURCE_HASH = "b".repeat(64);
const FIXTURE_SPEC = `
# Story 8.16: Per-dev worktree

Status: ready-for-dev

## Acceptance Criteria

**AC1 (integration):**
The dev builds in a dedicated worktree.

**AC2 (integration):**
The commit stages only the dev's own changes.

**AC3 (integration):**
The worktree is cleaned up.
`;
/**
 * Stand up a real git repo with a real `origin` (a sibling bare repo). The
 * default branch is `dev` so `runDevTerminalAction`'s default base resolves and
 * `git worktree add ... dev` succeeds.
 */
async function setupRepo() {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-worktree-iso-"));
    const repoRoot = path.join(tmp, "work");
    const originDir = path.join(tmp, "origin.git");
    await fs.mkdir(repoRoot, { recursive: true });
    // Bare origin so `git push -u origin <branch>` genuinely works.
    await realExeca("git", ["init", "--bare", "-b", "dev", originDir]);
    await realExeca("git", ["-C", repoRoot, "init", "-b", "dev"]);
    await realExeca("git", ["-C", repoRoot, "config", "user.email", "t@t.com"]);
    await realExeca("git", ["-C", repoRoot, "config", "user.name", "Test User"]);
    await realExeca("git", ["-C", repoRoot, "remote", "add", "origin", originDir]);
    // Seed a committed file so HEAD exists, then publish dev to origin.
    const srcDir = path.join(repoRoot, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await atomicWriteFile(path.join(srcDir, "index.ts"), "export const x = 1;\n");
    await realExeca("git", ["-C", repoRoot, "add", "."]);
    await realExeca("git", ["-C", repoRoot, "commit", "-m", "chore: initial commit"]);
    await realExeca("git", ["-C", repoRoot, "push", "-u", "origin", "dev"]);
    // Manifest + spec the tool reads for ACs.
    const specRelPath = `_bmad-output/implementation-artifacts/${REF}.md`;
    const specDir = path.join(repoRoot, "_bmad-output", "implementation-artifacts");
    await fs.mkdir(specDir, { recursive: true });
    await atomicWriteFile(path.join(specDir, `${REF}.md`), FIXTURE_SPEC);
    const stateDir = path.join(repoRoot, ".crew", "state", "in-progress");
    await fs.mkdir(stateDir, { recursive: true });
    const manifestPath = path.join(stateDir, `${REF}.yaml`);
    await atomicWriteFile(manifestPath, yamlStringify({
        ref: REF,
        status: "in-progress",
        adapter: "bmad",
        source_path: specRelPath,
        source_hash: SOURCE_HASH,
        depends_on: [],
        acceptance_criteria: [{ text: "AC1 text", kind: "integration" }],
        title: TITLE,
        narrative: "As a maintainer, I want worktree isolation.",
        withdrawn: false,
        claimed_by: SESSION_ULID,
    }));
    // Commit the manifest + spec so they are NOT counted as dirty paths the dev
    // "changed" (they are scaffolding present before the dev runs).
    await realExeca("git", ["-C", repoRoot, "add", "."]);
    await realExeca("git", ["-C", repoRoot, "commit", "-m", "chore: scaffold story"]);
    await realExeca("git", ["-C", repoRoot, "push", "origin", "dev"]);
    return { repoRoot, originDir, manifestPath };
}
/**
 * execaImpl that runs real git everywhere, but stubs `gh` so no network call is
 * made. `cwd` from the gh call is captured so AC3 can assert the gh process was
 * pinned to the worktree (the right repo context).
 */
function makeStubExeca(opts) {
    return vi.fn(async (cmd, args, options) => {
        if (cmd === "gh") {
            opts.ghCwds.push(typeof options?.cwd === "string" ? options.cwd : "");
            if (opts.ghShouldFail) {
                return { stdout: "", stderr: "gh pr create failed", exitCode: 1 };
            }
            return { stdout: opts.ghStdout ?? FAKE_PR_URL, stderr: "", exitCode: 0 };
        }
        // Real git for everything else.
        const result = await realExeca(cmd, args, { ...options, reject: false });
        return {
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
            exitCode: typeof result.exitCode === "number" ? result.exitCode : 0,
        };
    });
}
/** Repo-relative file list of a commit by sha (HEAD by default), in a given repo root. */
async function commitFiles(repoRoot, sha = "HEAD") {
    const r = await realExeca("git", ["-C", repoRoot, "show", "--name-only", "--pretty=format:", sha], { reject: false });
    return (r.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
}
/** Registered worktree paths for a repo (`git worktree list --porcelain`). */
async function registeredWorktrees(repoRoot) {
    const r = await realExeca("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], { reject: false });
    return (r.stdout ?? "")
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice("worktree ".length).trim());
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let ctx;
beforeEach(async () => {
    ctx = await setupRepo();
});
afterEach(async () => {
    // Clean up the whole tmp tree (parent of repoRoot).
    await fs.rm(path.dirname(ctx.repoRoot), { recursive: true, force: true });
});
describe("dev-worktree isolation — AC1 (worktree created; orchestrating tree clean)", () => {
    it("commits the dev's change inside a worktree and leaves git -C <root> clean of it", async () => {
        const ghCwds = [];
        const spy = makeStubExeca({ ghStdout: FAKE_PR_URL, ghCwds });
        // Snapshot baseline BEFORE the dev edits (clean tree → empty).
        const baseline = (await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot })).dirtyPaths;
        // Dev does its work: edits a tracked file + adds a new file in targetRepoRoot.
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "index.ts"), "export const x = 2; // dev edit\n");
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "feature.ts"), "export const feature = true;\n");
        const result = await runDevTerminalAction({
            targetRepoRoot: ctx.repoRoot,
            ref: REF,
            title: TITLE,
            type: TYPE,
            body: BODY,
            summary: SUMMARY,
            manifestPath: ctx.manifestPath,
            sessionUlid: SESSION_ULID,
            baselineDirtyPaths: baseline,
            execaImpl: spy,
        });
        expect(result.ok).toBe(true);
        expect(result.branch).toMatch(/^story\//);
        // (a) A worktree was created — the gh call ran with cwd pointed at a
        // dev-<ref>-worktree path under the session dir, NOT targetRepoRoot.
        const expectedWorktreeDir = path.join(ctx.repoRoot, ".crew", "state", "sessions", SESSION_ULID);
        expect(ghCwds.length).toBe(1);
        expect(ghCwds[0]).toContain(expectedWorktreeDir);
        expect(ghCwds[0]).toContain("worktree");
        expect(ghCwds[0]).not.toBe(ctx.repoRoot);
        // (b) The orchestrating checkout is clean of the DEV's changes: index.ts is
        // restored to its committed content and feature.ts (dev-created) is gone.
        const restored = await fs.readFile(path.join(ctx.repoRoot, "src", "index.ts"), "utf8");
        expect(restored).toBe("export const x = 1;\n");
        await expect(fs.access(path.join(ctx.repoRoot, "src", "feature.ts"))).rejects.toBeTruthy();
        // Clean of the dev's STORY changes. The `.crew/state/sessions/` dir holds
        // dev-outcome.json (machine ledger, operator-collectable garbage) and is
        // deliberately never treated as a dev change — so we assert no non-`.crew`
        // path remains dirty.
        const porcelain = await realExeca("git", ["-C", ctx.repoRoot, "status", "--porcelain"], { reject: false });
        const dirtyNonState = porcelain.stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .filter((l) => !l.includes(".crew/state/"));
        expect(dirtyNonState).toEqual([]);
        // (c) The dev's change DID land — it is on the pushed story branch in origin.
        const originFiles = await commitFiles(ctx.originDir, result.branch);
        expect(originFiles).toContain("src/index.ts");
        expect(originFiles).toContain("src/feature.ts");
    });
});
describe("dev-worktree isolation — AC2 (commit excludes unrelated pre-existing change)", () => {
    it("does not sweep an unrelated tracked-but-modified file into the story commit", async () => {
        const ghCwds = [];
        const spy = makeStubExeca({ ghStdout: FAKE_PR_URL, ghCwds });
        // Seed an UNRELATED, pre-existing uncommitted change (a stray edit present
        // when the dev step begins) — this is the baseline the workflow captures.
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "index.ts"), "export const x = 1; // STRAY pre-existing edit\n");
        const baseline = (await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot })).dirtyPaths;
        expect(baseline).toContain("src/index.ts");
        // Now the dev makes its OWN change (a brand-new file).
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "feature.ts"), "export const feature = true;\n");
        const result = await runDevTerminalAction({
            targetRepoRoot: ctx.repoRoot,
            ref: REF,
            title: TITLE,
            type: TYPE,
            body: BODY,
            summary: SUMMARY,
            manifestPath: ctx.manifestPath,
            sessionUlid: SESSION_ULID,
            baselineDirtyPaths: baseline,
            execaImpl: spy,
        });
        // The story commit contains ONLY the dev's own file, never the stray edit.
        const committed = await commitFiles(ctx.originDir, result.branch);
        expect(committed).toContain("src/feature.ts");
        expect(committed).not.toContain("src/index.ts");
        // The stray change is left exactly as-is in the orchestrating checkout.
        const strayStill = await fs.readFile(path.join(ctx.repoRoot, "src", "index.ts"), "utf8");
        expect(strayStill).toBe("export const x = 1; // STRAY pre-existing edit\n");
    });
});
describe("dev-worktree isolation — AC3 (repo resolves; worktree cleaned up)", () => {
    it("opens the PR against the expected branch and leaves no registered worktree on success", async () => {
        const ghCwds = [];
        const spy = makeStubExeca({ ghStdout: FAKE_PR_URL, ghCwds });
        const baseline = (await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot })).dirtyPaths;
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "feature.ts"), "export const feature = true;\n");
        const result = await runDevTerminalAction({
            targetRepoRoot: ctx.repoRoot,
            ref: REF,
            title: TITLE,
            type: TYPE,
            body: BODY,
            summary: SUMMARY,
            manifestPath: ctx.manifestPath,
            sessionUlid: SESSION_ULID,
            baselineDirtyPaths: baseline,
            execaImpl: spy,
        });
        // gh pr create targeted the right base, and the branch it pushed is the
        // expected story branch (the worktree's git context resolved the right repo).
        const ghCall = spy.mock.calls.find(([c]) => c === "gh");
        expect(ghCall).toBeDefined();
        const ghArgs = ghCall[1];
        expect(ghArgs[ghArgs.indexOf("--base") + 1]).toBe("dev");
        // The branch genuinely exists in origin (push resolved the intended repo).
        const lsRemote = await realExeca("git", ["-C", ctx.repoRoot, "ls-remote", "--heads", "origin", result.branch], { reject: false });
        expect(lsRemote.stdout).toContain(`refs/heads/${result.branch}`);
        // No leftover worktree registered for the story after the step returns.
        const worktrees = await registeredWorktrees(ctx.repoRoot);
        const leftover = worktrees.filter((w) => w.includes(`dev-${REF}`));
        expect(leftover).toEqual([]);
        // And the worktree directory is physically gone.
        await expect(fs.access(path.join(ctx.repoRoot, ".crew", "state", "sessions", SESSION_ULID, `dev-${REF}-worktree`))).rejects.toBeTruthy();
    });
    it("removes the worktree even when the step fails mid-build (gh pr create fails)", async () => {
        const ghCwds = [];
        const spy = makeStubExeca({ ghShouldFail: true, ghCwds });
        const baseline = (await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot })).dirtyPaths;
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "feature.ts"), "export const feature = true;\n");
        await expect(runDevTerminalAction({
            targetRepoRoot: ctx.repoRoot,
            ref: REF,
            title: TITLE,
            type: TYPE,
            body: BODY,
            summary: SUMMARY,
            manifestPath: ctx.manifestPath,
            sessionUlid: SESSION_ULID,
            baselineDirtyPaths: baseline,
            execaImpl: spy,
        })).rejects.toBeInstanceOf(GhPrCreateFailedError);
        // Failure mid-build must NOT leave the worktree wedged.
        const worktrees = await registeredWorktrees(ctx.repoRoot);
        const leftover = worktrees.filter((w) => w.includes(`dev-${REF}`));
        expect(leftover).toEqual([]);
        await expect(fs.access(path.join(ctx.repoRoot, ".crew", "state", "sessions", SESSION_ULID, `dev-${REF}-worktree`))).rejects.toBeTruthy();
        // And the orchestrating checkout is restored clean of the dev's change.
        await expect(fs.access(path.join(ctx.repoRoot, "src", "feature.ts"))).rejects.toBeTruthy();
    });
});
describe("snapshotDirtyPaths — baseline helper", () => {
    it("returns the set of currently-dirty repo-relative paths", async () => {
        await atomicWriteFile(path.join(ctx.repoRoot, "src", "index.ts"), "export const x = 99;\n");
        const { dirtyPaths } = await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot });
        expect(dirtyPaths).toContain("src/index.ts");
    });
    it("returns an empty list for a clean tree", async () => {
        const { dirtyPaths } = await snapshotDirtyPaths({ targetRepoRoot: ctx.repoRoot });
        expect(dirtyPaths).toEqual([]);
    });
});
