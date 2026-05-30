/**
 * `runDevTerminalAction` MCP tool — Story 4.4.
 *
 * The dev subagent's terminal action: after completing implementation work,
 * the subagent calls this tool to (a) create a story branch, (b) commit in
 * conventional-commits format, (c) push to origin, and (d) open a PR via
 * `gh pr create` with a machine-readable body section (story link, ACs
 * checklist mirrored from the spec) followed by a free-form summary.
 *
 * @see _bmad-output/implementation-artifacts/4-4-dev-subagent-git-push-and-gh-pr-create-terminal-action.md § Behavioural contract
 *
 * Worktree isolation (Story 8.16): by default the branch/commit/push/PR are
 * produced inside a dedicated git worktree distinct from `targetRepoRoot`,
 * carrying ONLY the dev's own changed paths (an explicit stage set — never
 * `git add .`). This leaves the orchestrating session's checkout untouched and
 * prevents a stray uncommitted change from being swept into the story PR. The
 * worktree is always torn down (success or failure) so repeated drains never
 * accumulate orphans. Pass `worktree: false` to commit in `targetRepoRoot`
 * directly (the legacy Story 4.4 path, retained for that story's tests).
 *
 * Invariants (the validation invariants are enforced BEFORE any subprocess spawn):
 * - `type` MUST be in the conventional-commits set.
 * - Branch slug MUST be renderable from `ref` + `title`.
 * - Steps execute in strict order: validateType → branchSlug → readManifest →
 *   extractAcs → materialiseWorktree → createBranch → commit → push →
 *   composePrBody → gh pr create → cleanup.
 * - The commit stages an EXPLICIT path set (the dev's own changes), never an
 *   indiscriminate `git add .`.
 * - No flags are passed to push or gh pr create beyond the closed v1 signatures.
 * - The manifest is read-only.
 * - No telemetry emitted in v1.
 * - Returns `{ ok: true, branch, commitSha, prUrl }` on success; raises a
 *   typed error on failure.
 *
 * (Story 4.4 FR29 / Pattern §9 / NFR16; worktree isolation: Story 8.16)
 */
import * as path from "node:path";
import { ConventionalCommitTypeUnknownError, GhPrCreateFailedError, } from "../errors.js";
import { extractAcsFromSpec } from "../lib/extract-acs-from-spec.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import { gh } from "../lib/gh.js";
import { gitCommit, gitCreateBranch, gitPush, CONVENTIONAL_COMMIT_TYPES, } from "../lib/git.js";
import { buildBranchSlug, composeCommitSubject, composePrBody, wrapCommitBody, } from "../lib/pr-body.js";
import { readManifest } from "../lib/manifest-io.js";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { materialiseDevStoryWorktree } from "../lib/dev-story-worktree.js";
const ROLE = "generalist-dev";
/**
 * Run the dev subagent's terminal action end-to-end.
 *
 * @param opts.targetRepoRoot  Absolute path to the target repo.
 * @param opts.ref             Story reference (e.g. `4-4-dev-subagent-...`).
 * @param opts.title           Story title (human-readable).
 * @param opts.type            Conventional-commits type (`feat`, `fix`, etc.).
 * @param opts.body            Commit body (free-form; hard-wrapped at 72 here).
 * @param opts.summary         Free-form PR summary (appended after machine block).
 * @param opts.manifestPath    Absolute path to the in-progress manifest YAML.
 * @param opts.sessionUlid     ULID of the calling session (for context).
 * @param opts.base            PR base branch. Defaults to `dev` — crew's working
 *                             trunk — so autonomous PRs target the trunk rather
 *                             than the GitHub default branch (`main`). Callers
 *                             targeting a repo whose trunk is not `dev` must pass
 *                             this explicitly (a productization follow-up will
 *                             source it from adapter config).
 * @param opts.worktree        Worktree isolation (Story 8.16). Defaults to ON:
 *                             the branch/commit/push/PR are produced inside a
 *                             dedicated git worktree distinct from
 *                             `targetRepoRoot`, carrying ONLY the dev's own
 *                             changed paths (an explicit set — never `git add .`)
 *                             so the orchestrating checkout is left untouched and
 *                             a stray uncommitted change is never swept into the
 *                             PR. Pass `false` to commit in `targetRepoRoot`
 *                             directly (legacy behaviour; used by Story 4.4's
 *                             integration tests).
 * @param opts.baselineDirtyPaths  Repo-relative paths already dirty BEFORE the
 *                             dev started — excluded from the worktree transplant
 *                             so unrelated working-tree changes never ride along
 *                             (AC2). The drain workflow captures this snapshot
 *                             immediately before spawning the dev. Ignored when
 *                             `worktree` is `false`.
 * @param opts.execaImpl       Optional test seam (production callers omit this).
 */
export async function runDevTerminalAction(opts) {
    const { targetRepoRoot, ref, title, type, body, summary, manifestPath, sessionUlid, } = opts;
    const base = opts.base ?? "dev";
    const useWorktree = opts.worktree !== false;
    const execaImpl = opts.execaImpl;
    // (i) Validate conventional-commits type BEFORE any subprocess spawn.
    if (!CONVENTIONAL_COMMIT_TYPES.includes(type)) {
        throw new ConventionalCommitTypeUnknownError({
            attempted_type: type,
            allowed_types: CONVENTIONAL_COMMIT_TYPES,
        });
    }
    // (i) Compose branch slug (raises BranchSlugUnrenderableError if un-renderable).
    const branch = buildBranchSlug({ ref, title });
    // (ii) Read manifest to derive spec path. Done BEFORE any worktree/branch work
    // so a malformed manifest fails fast with the orchestrating tree untouched.
    const manifest = await readManifest(manifestPath);
    // source_path is either repo-relative or absolute; resolve against targetRepoRoot.
    const specPath = path.isAbsolute(manifest.source_path)
        ? manifest.source_path
        : path.join(targetRepoRoot, manifest.source_path);
    // (iii) Extract ACs from the spec file.
    const acs = await extractAcsFromSpec(specPath);
    // (iv) Materialise the dev's isolated worktree (Story 8.16). All subsequent git
    // work (branch/commit/push) and `gh pr create` target `gitRoot` — the worktree
    // when isolation is on, else `targetRepoRoot`. The worktree carries ONLY the
    // dev's own changed paths, so the orchestrating checkout is left untouched and
    // a stray uncommitted change can never be swept into the PR. `committedPaths`
    // is the explicit stage set (never `git add .`); in worktree mode the transplant
    // already populated those paths, so we stage exactly them; in legacy mode we
    // fall back to `["."]` (Story 4.4 behaviour).
    let gitRoot = targetRepoRoot;
    let committedPaths = ["."];
    let cleanupWorktree;
    if (useWorktree) {
        const wt = await materialiseDevStoryWorktree({
            targetRepoRoot,
            sessionUlid,
            ref,
            base,
            ...(opts.baselineDirtyPaths ? { baselineDirtyPaths: opts.baselineDirtyPaths } : {}),
            ...(execaImpl ? { execaImpl } : {}),
        });
        gitRoot = wt.worktreePath;
        // Stage the explicit transplanted set. An empty set (the dev produced no
        // changes the orchestrating tree didn't already have) still must commit
        // something or `git commit` fails — but a dev that handed off with no
        // changes is itself a defect, so we let the empty-commit guard in gitCommit
        // surface it. We pass the carried paths; "." would re-introduce the
        // git-add-everything hazard inside the worktree (harmless there, since the
        // worktree only contains the transplant, but explicit is clearer).
        committedPaths = wt.carriedPaths.length > 0 ? wt.carriedPaths : ["."];
        cleanupWorktree = wt.cleanup;
    }
    try {
        // (v) Create the story branch inside the (worktree or main) repo root.
        await gitCreateBranch({
            targetRepoRoot: gitRoot,
            branchName: branch,
            ...(execaImpl ? { execaImpl } : {}),
        });
        // (vi) Compose commit subject and wrap body.
        const subject = composeCommitSubject({ type, ref, title });
        const wrappedBody = wrapCommitBody(body);
        // (vii) Commit — explicit path set, never an indiscriminate `git add .`.
        const commitResult = await gitCommit({
            targetRepoRoot: gitRoot,
            paths: committedPaths,
            message: subject,
            role: ROLE,
            messageShape: "conventional",
            body: wrappedBody || undefined,
            ...(execaImpl ? { execaImpl } : {}),
        });
        // (viii) Push.
        await gitPush({
            targetRepoRoot: gitRoot,
            branchName: branch,
            role: ROLE,
            ...(execaImpl ? { execaImpl } : {}),
        });
        // (ix) Compose PR body.
        // specPath for the PR body should be repo-relative if possible.
        const specPathForPr = path.isAbsolute(manifest.source_path)
            ? path.relative(targetRepoRoot, manifest.source_path)
            : manifest.source_path;
        const prBody = composePrBody({
            ref,
            specPath: specPathForPr,
            acs,
            summary,
        });
        // (x) gh pr create — cwd pinned to gitRoot so `gh` resolves the intended
        // repo when the dev operates in a worktree (the worktree shares the same
        // .git object store and `origin` remote as targetRepoRoot).
        const pluginRoot = getPluginRoot();
        const permissions = await loadRolePermissions({ role: ROLE, pluginRoot });
        const ghResult = await gh({
            role: ROLE,
            permissions,
            subcommand: "pr-create",
            args: ["--title", subject, "--body", prBody, "--base", base],
            cwd: gitRoot,
            ...(execaImpl ? { execaImpl } : {}),
        });
        if (ghResult.exitCode !== 0) {
            throw new GhPrCreateFailedError({
                stderr: ghResult.stderr,
                diagnostic: `gh pr create exited with code ${ghResult.exitCode}`,
            });
        }
        const prUrl = ghResult.stdout.trim();
        if (!prUrl || !prUrl.startsWith("https://github.com/")) {
            throw new GhPrCreateFailedError({
                stderr: ghResult.stderr,
                diagnostic: "stdout did not contain a PR URL",
            });
        }
        // (xi) Extract prNumber from the PR URL.
        const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
        if (!prNumberMatch) {
            throw new GhPrCreateFailedError({
                stderr: ghResult.stderr,
                diagnostic: "PR URL stdout contained no /pull/<n> segment",
            });
        }
        const prNumber = parseInt(prNumberMatch[1], 10);
        // (xii) Atomically write dev-outcome.json to the session directory under
        // targetRepoRoot (NOT the worktree — the worktree is torn down, and
        // processDevTranscript reads the orchestrating checkout's session dir).
        // This must happen BEFORE return so the machine-authoritative PR number
        // is available to processDevTranscript without relying on LLM-authored text.
        const devOutcomePath = path.resolve(targetRepoRoot, ".crew", "state", "sessions", sessionUlid, "dev-outcome.json");
        await atomicWriteFile(devOutcomePath, JSON.stringify({ prUrl, prNumber, branch, commitSha: commitResult.commitSha }, null, 2));
        // (xiii) Return success.
        return {
            ok: true,
            branch,
            commitSha: commitResult.commitSha,
            prUrl,
        };
    }
    finally {
        // Always tear down the worktree — on success AND on any failure mid-build —
        // so repeated drains never accumulate orphaned worktrees and a failure does
        // not leave one wedged. Cleanup is best-effort: its warnings are non-fatal.
        if (cleanupWorktree) {
            await cleanupWorktree();
        }
    }
}
