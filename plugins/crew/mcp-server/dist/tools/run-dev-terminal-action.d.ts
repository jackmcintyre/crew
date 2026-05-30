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
 *   extractAcs → materialiseWorktree → createBranch → commit → fullBuildGate →
 *   push → composePrBody → gh pr create → cleanup.
 * - The full-build gate (Story 8.17) runs the project's full build — the same
 *   whole-project type-check CI runs (`pnpm build` at `plugins/crew`) — in the
 *   dev's working directory AFTER the commit and BEFORE `gh pr create`, so a red
 *   build raises `PrePrBuildFailedError` and NO PR is opened. This is a
 *   deterministic tool-layer seam: the dev agent cannot skip the build under load
 *   the way a prose mandate could (the #211 failure class).
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
import { execa as defaultExeca } from "execa";
export interface DevTerminalActionResult {
    ok: true;
    branch: string;
    commitSha: string;
    prUrl: string;
}
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
export declare function runDevTerminalAction(opts: {
    targetRepoRoot: string;
    ref: string;
    title: string;
    type: string;
    body: string;
    summary: string;
    manifestPath: string;
    sessionUlid: string;
    base?: string;
    worktree?: boolean;
    baselineDirtyPaths?: readonly string[];
    execaImpl?: typeof defaultExeca;
}): Promise<DevTerminalActionResult>;
