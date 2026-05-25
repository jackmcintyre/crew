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
 * Invariants (all enforced BEFORE any subprocess spawn):
 * - `type` MUST be in the conventional-commits set.
 * - Branch slug MUST be renderable from `ref` + `title`.
 * - The five steps execute in strict order: createBranch → readManifest →
 *   extractAcs → commit → push → composePrBody → gh pr create.
 * - No flags are passed to push or gh pr create beyond the closed v1 signatures.
 * - No file outside the git working tree is mutated (manifest is read-only).
 * - No telemetry emitted in v1.
 * - Returns `{ ok: true, branch, commitSha, prUrl }` on success; raises a
 *   typed error on failure.
 *
 * (Story 4.4 FR29 / Pattern §9 / NFR16)
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
    execaImpl?: typeof defaultExeca;
    /**
     * Story 4.12 AC7: skip the pre-handoff `pnpm -w typecheck && pnpm -w test --run`
     * gate. Production callers default to running the gate; tests opt out.
     * `false` (default) → run the gate; `true` → skip.
     */
    skipPreHandoffSuite?: boolean;
}): Promise<DevTerminalActionResult>;
