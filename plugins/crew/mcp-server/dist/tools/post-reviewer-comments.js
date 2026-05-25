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
import { getPluginVersion } from "../lib/plugin-version.js";
import { readReviewerResultFile } from "../lib/read-reviewer-result-file.js";
import { composeSummaryBody } from "../lib/compose-reviewer-summary.js";
import { findHunkLineForPath } from "../lib/find-hunk-line.js";
import { GhApiResponseShapeError } from "../errors.js";
import { writeReviewerVerdictEvent } from "../lib/reviewer-verdict-writer.js";
import { writeAgentInvokeEvent } from "../lib/agent-invoke-writer.js";
/**
 * Story 4.12 NFR2: reviewer subagent wall-clock hard limit. When the
 * elapsed time exceeds this, `postReviewerComments` substitutes the
 * verdict body with a timeout failure and emits the `reviewer-timeout`
 * return branch.
 */
export const REVIEWER_HARD_LIMIT_MS = 8 * 60 * 1000;
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------
/**
 * Escape special regex characters in a string so it can be used as a literal
 * match in a `new RegExp(...)` constructor.
 */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * Post the reviewer's verdict as a PR review with inline comments and a
 * summary body. Reads `reviewer-result.json` and composes everything
 * deterministically — no LLM step in the composition path.
 *
 * On rerun: GETs existing reviews, searches for a prior verdict footer marker,
 * and PATCH-edits the prior review body in place instead of posting a duplicate.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling reviewer session.
 * @param opts.role - Role name for gh permission lookup (default: "generalist-reviewer").
 * @param opts.execaImpl - Test seam for execa.
 * @param opts.pluginRootOverride - Test seam for plugin root path.
 * @param opts.pluginVersionOverride - Test seam for plugin version string.
 */
export async function postReviewerComments(opts) {
    const role = opts.role ?? "generalist-reviewer";
    const pluginRoot = opts.pluginRootOverride ?? getPluginRoot();
    const execaImpl = opts.execaImpl ?? defaultExeca;
    const pluginVersion = opts.pluginVersionOverride ?? getPluginVersion();
    // Step 1: Read the persisted reviewer-result.json file.
    const resultFile = await readReviewerResultFile(opts.targetRepoRoot, opts.sessionUlid);
    if (resultFile === null) {
        // File absent — skip silently. processReviewerTranscript surfaces the loud blocker.
        return { next: "skipped-no-session-result", postedReviewId: null };
    }
    const permissions = await loadRolePermissions({ role, pluginRoot });
    // ---------------------------------------------------------------------------
    // Story 4.12 AC3: 8-min reviewer hard-limit pre-check.
    // If elapsedMs > REVIEWER_HARD_LIMIT_MS, substitute the verdict body with a
    // failure comment (events: COMMENT, no inline comments). Apply needs-human
    // is the SKILL.md prose's job; the manifest is NOT marked failed.
    // The footer marker uses role-slot "reviewer-timeout" so the PATCH lookup
    // (regex `[^:]+`) still matches on a subsequent rerun.
    // ---------------------------------------------------------------------------
    if (opts.spawnStartedAt !== undefined) {
        const nowFn = opts.now ?? (() => Date.now());
        const elapsedMs = nowFn() - opts.spawnStartedAt;
        if (elapsedMs > REVIEWER_HARD_LIMIT_MS) {
            const chatLog = [];
            // Emit agent.invoke for the reviewer spawn (AC3 (3h)).
            try {
                await writeAgentInvokeEvent({
                    targetRepoRoot: opts.targetRepoRoot,
                    sessionUlid: opts.sessionUlid,
                    agent: "generalist-reviewer",
                    ref: resultFile.ref,
                    runtimeMs: elapsedMs,
                });
            }
            catch (err) {
                chatLog.push(`agent-invoke telemetry write failed: ${err.message}`);
            }
            // Resolve {owner}/{repo} via gh pr view --json headRepository,headRepositoryOwner.
            const prViewResult = await gh({
                role,
                permissions,
                subcommand: "pr-view",
                args: [
                    String(resultFile.prNumber),
                    "--json",
                    "headRepository,headRepositoryOwner",
                ],
                execaImpl,
                pluginRootOverride: pluginRoot,
            });
            let owner;
            let repo;
            try {
                const prViewJson = JSON.parse(prViewResult.stdout);
                owner = prViewJson.headRepositoryOwner?.login ?? "";
                repo = prViewJson.headRepository?.name ?? "";
                if (!owner || !repo) {
                    throw new Error("missing owner or repo in headRepository/headRepositoryOwner shape");
                }
            }
            catch (cause) {
                throw new GhApiResponseShapeError({ subcommand: "pr-view", cause });
            }
            const reviewsApiUrl = `/repos/${owner}/${repo}/pulls/${resultFile.prNumber}/reviews`;
            // Search for a prior verdict review to PATCH (footer regex matches
            // any role-slot, including `reviewer-timeout` on reruns).
            const getReviewsResult = await gh({
                role,
                permissions,
                subcommand: "api",
                args: [reviewsApiUrl, "--method", "GET"],
                execaImpl,
                pluginRootOverride: pluginRoot,
            });
            let priorReviewId = null;
            try {
                const reviewsRaw = JSON.parse(getReviewsResult.stdout);
                if (!Array.isArray(reviewsRaw)) {
                    throw new Error(`expected array, got ${typeof reviewsRaw}`);
                }
                const footerPattern = new RegExp("<!-- crew:verdict:[^:]+:" + escapeRegex(resultFile.ref) + " -->");
                for (const review of reviewsRaw) {
                    if (typeof review.body !== "string")
                        continue;
                    if (footerPattern.test(review.body)) {
                        if (typeof review.id !== "number") {
                            throw new Error(`review.id is not a number: ${JSON.stringify(review.id)}`);
                        }
                        priorReviewId = review.id;
                        break;
                    }
                }
            }
            catch (cause) {
                throw new GhApiResponseShapeError({
                    subcommand: "api",
                    url: reviewsApiUrl,
                    cause,
                });
            }
            const timeoutBody = `**Reviewer timeout** — the reviewer subagent exceeded the 8-minute hard limit (NFR2) ` +
                `and was terminated. This PR has been labelled \`needs-human\` and the story has NOT been ` +
                `marked failed; an operator must inspect the dev branch and decide next steps.\n\n` +
                `\`standards_version: ${resultFile.standardsVersion}\` · \`plugin_version: ${pluginVersion}\`\n\n` +
                `<!-- crew:verdict:reviewer-timeout:${resultFile.ref} -->`;
            const verdictLine = "**Reviewer timeout** — 8-minute hard limit exceeded";
            let postedReviewId;
            if (priorReviewId !== null) {
                const patchUrl = `${reviewsApiUrl}/${priorReviewId}`;
                const patchResult = await gh({
                    role,
                    permissions,
                    subcommand: "api",
                    args: [patchUrl, "--method", "PATCH", "--input", "-"],
                    execaImpl,
                    pluginRootOverride: pluginRoot,
                    input: JSON.stringify({ body: timeoutBody }),
                });
                try {
                    const parsed = JSON.parse(patchResult.stdout);
                    if (typeof parsed.id !== "number") {
                        throw new Error(`response.id is not a number: ${JSON.stringify(parsed.id)}`);
                    }
                    postedReviewId = parsed.id;
                }
                catch (cause) {
                    throw new GhApiResponseShapeError({
                        subcommand: "api",
                        url: patchUrl,
                        cause,
                    });
                }
            }
            else {
                const apiResult = await gh({
                    role,
                    permissions,
                    subcommand: "api",
                    args: [reviewsApiUrl, "--method", "POST", "--input", "-"],
                    execaImpl,
                    pluginRootOverride: pluginRoot,
                    input: JSON.stringify({
                        event: "COMMENT",
                        body: timeoutBody,
                        comments: [],
                    }),
                });
                try {
                    const parsed = JSON.parse(apiResult.stdout);
                    if (typeof parsed.id !== "number") {
                        throw new Error(`response.id is not a number: ${JSON.stringify(parsed.id)}`);
                    }
                    postedReviewId = parsed.id;
                }
                catch (cause) {
                    throw new GhApiResponseShapeError({
                        subcommand: "api",
                        url: reviewsApiUrl,
                        cause,
                    });
                }
            }
            return {
                next: "reviewer-timeout",
                postedReviewId,
                verdictLine,
                elapsedMs,
                chatLog,
            };
        }
    }
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
    // Step 3: Resolve {owner} and {repo} via `gh pr view --json headRepository,headRepositoryOwner`.
    const prViewResult = await gh({
        role,
        permissions,
        subcommand: "pr-view",
        args: [String(resultFile.prNumber), "--json", "headRepository,headRepositoryOwner"],
        execaImpl,
        pluginRootOverride: pluginRoot,
    });
    let owner;
    let repo;
    try {
        const prViewJson = JSON.parse(prViewResult.stdout);
        owner = prViewJson.headRepositoryOwner?.login ?? "";
        repo = prViewJson.headRepository?.name ?? "";
        if (!owner || !repo) {
            throw new Error("missing owner or repo in headRepository/headRepositoryOwner shape");
        }
    }
    catch (cause) {
        throw new GhApiResponseShapeError({ subcommand: "pr-view", cause });
    }
    const reviewsApiUrl = `/repos/${owner}/${repo}/pulls/${resultFile.prNumber}/reviews`;
    // Step 4a: GET existing reviews and search for a prior verdict footer marker.
    const getReviewsResult = await gh({
        role,
        permissions,
        subcommand: "api",
        args: [reviewsApiUrl, "--method", "GET"],
        execaImpl,
        pluginRootOverride: pluginRoot,
    });
    let priorReviewId = null;
    try {
        const reviewsRaw = JSON.parse(getReviewsResult.stdout);
        if (!Array.isArray(reviewsRaw)) {
            throw new Error(`expected array, got ${typeof reviewsRaw}`);
        }
        // Search for the first review whose body is a non-null string and matches the footer marker.
        // Reviews with body === null (Copilot, plain approvals) are skipped — not errors.
        const footerPattern = new RegExp("<!-- crew:verdict:[^:]+:" + escapeRegex(resultFile.ref) + " -->");
        for (const review of reviewsRaw) {
            if (typeof review.body !== "string" || review.body === null) {
                continue; // skip null-bodied reviews
            }
            if (footerPattern.test(review.body)) {
                if (typeof review.id !== "number") {
                    throw new Error(`review.id is not a number: ${JSON.stringify(review.id)}`);
                }
                priorReviewId = review.id;
                break;
            }
        }
    }
    catch (cause) {
        throw new GhApiResponseShapeError({ subcommand: "api", url: reviewsApiUrl, cause });
    }
    // Step 5: Generate inline comments for failing runnable-artifact-check ACs.
    const inlineComments = [];
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
                    body: `**AC${index} FAIL** — ${ac.reason}\n\n` +
                        `The AC declared \`artifact: ${ac.artifactPath}\` but the file does not exist on disk at the dev's branch HEAD. ` +
                        `The dev claimed it was created; \`fs.access\` returned ENOENT.`,
                });
            }
        }
    }
    // Step 6: Compose the summary body with version block and footer marker.
    const summaryBody = composeSummaryBody(resultFile, {
        standardsVersion: resultFile.standardsVersion,
        pluginVersion,
    });
    // Extract the verdict line (find the line matching the verdict sentinel pattern).
    const bodyLines = summaryBody.split("\n");
    const verdictLine = bodyLines.find((l) => l.startsWith("**Verdict:")) ?? "";
    // Step 7: PATCH existing review or POST a new one.
    if (priorReviewId !== null) {
        // PATCH path — edit prior verdict in place (no inline comments on PATCH).
        const patchUrl = `${reviewsApiUrl}/${priorReviewId}`;
        const patchPayloadJson = JSON.stringify({ body: summaryBody });
        const patchResult = await gh({
            role,
            permissions,
            subcommand: "api",
            args: [patchUrl, "--method", "PATCH", "--input", "-"],
            execaImpl,
            pluginRootOverride: pluginRoot,
            input: patchPayloadJson,
        });
        let patchedId;
        try {
            const parsed = JSON.parse(patchResult.stdout);
            if (typeof parsed.id !== "number") {
                throw new Error(`response.id is not a number: ${JSON.stringify(parsed.id)}`);
            }
            patchedId = parsed.id;
        }
        catch (cause) {
            throw new GhApiResponseShapeError({ subcommand: "api", url: patchUrl, cause });
        }
        // Story 4.12 AC2: emit reviewer.verdict on PATCH success.
        const chatLog = [];
        try {
            await writeReviewerVerdictEvent({
                targetRepoRoot: opts.targetRepoRoot,
                sessionUlid: opts.sessionUlid,
                ref: resultFile.ref,
                prNumber: resultFile.prNumber,
                verdict: resultFile.recommendedVerdict,
                standardsVersion: resultFile.standardsVersion,
                pluginVersion,
            });
        }
        catch (err) {
            chatLog.push(`reviewer-verdict telemetry write failed: ${err.message}`);
        }
        return {
            next: "posted",
            postedReviewId: patchedId,
            inlineCommentCount: null, // PATCH does not update inline comments
            verdictLine,
            wasEdit: true,
            priorReviewId,
            chatLog,
        };
    }
    // POST path — first run, no prior verdict found.
    const reviewPayload = {
        event: "COMMENT",
        body: summaryBody,
        comments: inlineComments,
    };
    const reviewPayloadJson = JSON.stringify(reviewPayload);
    const apiResult = await gh({
        role,
        permissions,
        subcommand: "api",
        args: [reviewsApiUrl, "--method", "POST", "--input", "-"],
        execaImpl,
        pluginRootOverride: pluginRoot,
        input: reviewPayloadJson,
    });
    let postedReviewId;
    try {
        const parsed = JSON.parse(apiResult.stdout);
        if (typeof parsed.id !== "number") {
            throw new Error(`response.id is not a number: ${JSON.stringify(parsed.id)}`);
        }
        postedReviewId = parsed.id;
    }
    catch (cause) {
        throw new GhApiResponseShapeError({ subcommand: "api", url: reviewsApiUrl, cause });
    }
    // Story 4.12 AC2: emit reviewer.verdict on POST success.
    const chatLog = [];
    try {
        await writeReviewerVerdictEvent({
            targetRepoRoot: opts.targetRepoRoot,
            sessionUlid: opts.sessionUlid,
            ref: resultFile.ref,
            prNumber: resultFile.prNumber,
            verdict: resultFile.recommendedVerdict,
            standardsVersion: resultFile.standardsVersion,
            pluginVersion,
        });
    }
    catch (err) {
        chatLog.push(`reviewer-verdict telemetry write failed: ${err.message}`);
    }
    return {
        next: "posted",
        postedReviewId,
        inlineCommentCount: inlineComments.length,
        verdictLine,
        wasEdit: false,
        priorReviewId: null,
        chatLog,
    };
}
