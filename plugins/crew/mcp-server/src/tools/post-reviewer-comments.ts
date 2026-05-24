/**
 * `postReviewerComments` MCP tool — Story 4.6b.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-6b-reviewer-posts-inline-comments-and-summary-verdict.md
 *
 * Reads the persisted `reviewer-result.json` written by `runReviewerSession`,
 * composes a deterministic PR review summary body plus zero-or-more inline
 * comments, and posts them as a single PR review via `gh api` with event: COMMENT.
 *
 * The reviewer LLM's chat output is NOT consulted — the entire composition path
 * is: `reviewer-result.json` → pure composer functions → `gh api` POST.
 *
 * Invoked from SKILL.md prose AFTER the reviewer Task returns and BEFORE
 * `processReviewerTranscript` runs. It is a sibling of `processReviewerTranscript`,
 * not a wrapper.
 *
 * On ENOENT for `reviewer-result.json`: returns
 *   `{ next: "skipped-no-session-result", postedReviewId: null }` silently
 *   (the loud blocker is `processReviewerTranscript`'s job downstream).
 *
 * On malformed JSON / invalid shape: propagates `ReviewerResultFileMalformedError`.
 * On `GhRecoverableError`, `GhApiResponseShapeError`, `GhSubcommandDeniedError`:
 * propagates verbatim (no retry, no swallow).
 *
 * TODO(4.12): wire `reviewer.comments_posted` telemetry event here.
 *
 * Story 4.6b Task 4.
 */

import { execa as defaultExeca } from "execa";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { gh } from "../lib/gh.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { readReviewerResultFile } from "../lib/read-reviewer-result-file.js";
import { composeSummaryBody } from "../lib/compose-reviewer-summary.js";
import { findHunkLineForPath } from "../lib/find-hunk-line.js";
import { GhApiResponseShapeError } from "../errors.js";
import type { execa } from "execa";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostReviewerCommentsResult =
  | {
      /** File was absent — no verdict to post. processReviewerTranscript handles it. */
      next: "skipped-no-session-result";
      postedReviewId: null;
    }
  | {
      /** Review successfully posted to GitHub. */
      next: "posted";
      postedReviewId: number;
      inlineCommentCount: number;
      verdictLine: string;
    };

export interface PostReviewerCommentsOptions {
  targetRepoRoot: string;
  sessionUlid: string;
  role?: string;
  /** Test seam — production callers do not pass this. */
  execaImpl?: typeof defaultExeca;
  /** Plugin root override — test seam for loadRolePermissions. */
  pluginRootOverride?: string;
}

interface InlineComment {
  path: string;
  line: number;
  body: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Post the reviewer's verdict as a PR review with inline comments and a
 * summary body. Reads `reviewer-result.json` and composes everything
 * deterministically — no LLM step in the composition path.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling reviewer session.
 * @param opts.role - Role name for gh permission lookup (default: "generalist-reviewer").
 * @param opts.execaImpl - Test seam for execa.
 * @param opts.pluginRootOverride - Test seam for plugin root path.
 */
export async function postReviewerComments(
  opts: PostReviewerCommentsOptions,
): Promise<PostReviewerCommentsResult> {
  const role = opts.role ?? "generalist-reviewer";
  const pluginRoot = opts.pluginRootOverride ?? getPluginRoot();
  const execaImpl = opts.execaImpl ?? defaultExeca;

  // Step 1: Read the persisted reviewer-result.json file.
  const resultFile = await readReviewerResultFile(opts.targetRepoRoot, opts.sessionUlid);

  if (resultFile === null) {
    // File absent — skip silently. processReviewerTranscript surfaces the loud blocker.
    return { next: "skipped-no-session-result", postedReviewId: null };
  }

  const permissions = await loadRolePermissions({ role, pluginRoot });

  // Step 2: Fetch the PR diff (re-read — not persisted per Story 4.6 §3g).
  const diffResult = await gh({
    role,
    permissions,
    subcommand: "pr-diff",
    args: [String(resultFile.prNumber)],
    execaImpl,
    pluginRootOverride: pluginRoot,
  });
  const diff = diffResult.stdout;

  // Step 3: Resolve {owner} and {repo} via `gh pr view --json baseRepository`.
  const prViewResult = await gh({
    role,
    permissions,
    subcommand: "pr-view",
    args: [String(resultFile.prNumber), "--json", "baseRepository"],
    execaImpl,
    pluginRootOverride: pluginRoot,
  });

  let owner: string;
  let repo: string;
  try {
    const prViewJson = JSON.parse(prViewResult.stdout) as {
      baseRepository?: { name?: string; owner?: { login?: string } };
    };
    owner = prViewJson.baseRepository?.owner?.login ?? "";
    repo = prViewJson.baseRepository?.name ?? "";
    if (!owner || !repo) {
      throw new Error("missing owner or repo in baseRepository shape");
    }
  } catch (cause) {
    throw new GhApiResponseShapeError({ subcommand: "pr-view", cause });
  }

  // Step 4: Generate inline comments for failing runnable-artifact-check ACs.
  const inlineComments: InlineComment[] = [];

  const acEntries = Object.entries(resultFile.acResults)
    .map(([key, ac]) => ({ index: Number(key), ac }))
    .sort((a, b) => a.index - b.index);

  for (const { index, ac } of acEntries) {
    if (ac.applicability === "runnable-artifact-check" && ac.status === "fail") {
      const hunkLine = findHunkLineForPath(diff, ac.artifactPath);
      if (hunkLine !== null) {
        inlineComments.push({
          path: ac.artifactPath,
          line: hunkLine,
          body:
            `**AC${index} FAIL** — ${ac.reason}\n\n` +
            `The AC declared \`artifact: ${ac.artifactPath}\` but the file does not exist on disk at the dev's branch HEAD. ` +
            `The dev claimed it was created; \`fs.access\` returned ENOENT.`,
        });
      }
    }
  }

  // Step 5: Compose the summary body.
  const summaryBody = composeSummaryBody(resultFile);

  // Extract the verdict line (the last non-empty line of the body).
  const bodyLines = summaryBody.split("\n");
  const verdictLine =
    [...bodyLines].reverse().find((l) => l.trim().length > 0) ?? "";

  // Step 6: Build the gh api request body.
  const reviewPayload = {
    event: "COMMENT",
    body: summaryBody,
    comments: inlineComments,
  };

  const reviewPayloadJson = JSON.stringify(reviewPayload);
  const apiUrl = `/repos/${owner}/${repo}/pulls/${resultFile.prNumber}/reviews`;

  // Step 7: POST the review via `gh api`.
  const apiResult = await gh({
    role,
    permissions,
    subcommand: "api",
    args: [apiUrl, "--method", "POST", "--input", "-"],
    execaImpl,
    pluginRootOverride: pluginRoot,
    input: reviewPayloadJson,
  });

  // Step 8: Parse the response and extract `id`.
  let postedReviewId: number;
  try {
    const parsed = JSON.parse(apiResult.stdout) as { id?: unknown };
    if (typeof parsed.id !== "number") {
      throw new Error(`response.id is not a number: ${JSON.stringify(parsed.id)}`);
    }
    postedReviewId = parsed.id;
  } catch (cause) {
    throw new GhApiResponseShapeError({ subcommand: "api", url: apiUrl, cause });
  }

  // Step 9: Return result.
  return {
    next: "posted",
    postedReviewId,
    inlineCommentCount: inlineComments.length,
    verdictLine,
  };
}
