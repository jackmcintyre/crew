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

import * as path from "node:path";
import {
  ConventionalCommitTypeUnknownError,
  GhPrCreateFailedError,
} from "../errors.js";
import { extractAcsFromSpec } from "../lib/extract-acs-from-spec.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import { gh } from "../lib/gh.js";
import {
  gitCommit,
  gitCreateBranch,
  gitPush,
  CONVENTIONAL_COMMIT_TYPES,
} from "../lib/git.js";
import {
  buildBranchSlug,
  composeCommitSubject,
  composePrBody,
  wrapCommitBody,
} from "../lib/pr-body.js";
import { readManifest } from "../lib/manifest-io.js";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { execa as defaultExeca } from "execa";

export interface DevTerminalActionResult {
  ok: true;
  branch: string;
  commitSha: string;
  prUrl: string;
}

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
 * @param opts.execaImpl       Optional test seam (production callers omit this).
 */
export async function runDevTerminalAction(opts: {
  targetRepoRoot: string;
  ref: string;
  title: string;
  type: string;
  body: string;
  summary: string;
  manifestPath: string;
  sessionUlid: string;
  execaImpl?: typeof defaultExeca;
}): Promise<DevTerminalActionResult> {
  const {
    targetRepoRoot,
    ref,
    title,
    type,
    body,
    summary,
    manifestPath,
    sessionUlid,
  } = opts;
  const execaImpl = opts.execaImpl;

  // (i) Validate conventional-commits type BEFORE any subprocess spawn.
  if (!(CONVENTIONAL_COMMIT_TYPES as readonly string[]).includes(type)) {
    throw new ConventionalCommitTypeUnknownError({
      attempted_type: type,
      allowed_types: CONVENTIONAL_COMMIT_TYPES,
    });
  }

  // (i) Compose branch slug (raises BranchSlugUnrenderableError if un-renderable).
  const branch = buildBranchSlug({ ref, title });

  // (ii) Create branch.
  await gitCreateBranch({
    targetRepoRoot,
    branchName: branch,
    ...(execaImpl ? { execaImpl } : {}),
  });

  // (iii) Read manifest to derive spec path.
  const manifest = await readManifest(manifestPath);
  // source_path is either repo-relative or absolute; resolve against targetRepoRoot.
  const specPath = path.isAbsolute(manifest.source_path)
    ? manifest.source_path
    : path.join(targetRepoRoot, manifest.source_path);

  // (iii) Extract ACs from the spec file.
  const acs = await extractAcsFromSpec(specPath);

  // (iv) Compose commit subject and wrap body.
  const subject = composeCommitSubject({ type, ref, title });
  const wrappedBody = wrapCommitBody(body);

  // (v) Commit.
  const commitResult = await gitCommit({
    targetRepoRoot,
    paths: ["."],
    message: subject,
    role: ROLE,
    messageShape: "conventional",
    body: wrappedBody || undefined,
    ...(execaImpl ? { execaImpl } : {}),
  });

  // (vi) Push.
  await gitPush({
    targetRepoRoot,
    branchName: branch,
    role: ROLE,
    ...(execaImpl ? { execaImpl } : {}),
  });

  // (vii) Compose PR body.
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

  // (viii) gh pr create.
  const pluginRoot = getPluginRoot();
  const permissions = await loadRolePermissions({ role: ROLE, pluginRoot });

  const ghResult = await gh({
    role: ROLE,
    permissions,
    subcommand: "pr-create",
    args: ["--title", subject, "--body", prBody],
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

  // (ix) Extract prNumber from the PR URL.
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  if (!prNumberMatch) {
    throw new GhPrCreateFailedError({
      stderr: ghResult.stderr,
      diagnostic: "PR URL stdout contained no /pull/<n> segment",
    });
  }
  const prNumber = parseInt(prNumberMatch[1]!, 10);

  // (x) Atomically write dev-outcome.json to the session directory.
  // This must happen BEFORE return so the machine-authoritative PR number
  // is available to processDevTranscript without relying on LLM-authored text.
  const devOutcomePath = path.resolve(
    targetRepoRoot,
    ".crew",
    "state",
    "sessions",
    sessionUlid,
    "dev-outcome.json",
  );
  await atomicWriteFile(
    devOutcomePath,
    JSON.stringify({ prUrl, prNumber, branch, commitSha: commitResult.commitSha }, null, 2),
  );

  // (xi) Return success.
  return {
    ok: true,
    branch,
    commitSha: commitResult.commitSha,
    prUrl,
  };
}
