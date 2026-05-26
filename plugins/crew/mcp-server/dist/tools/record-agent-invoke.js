/**
 * `recordAgentInvoke` MCP tool — Story 4.12.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-12-per-invocation-telemetry-and-runtime-soft-hard-limits.md
 *
 * Single entrypoint for the dev session to record a completed agent-subagent
 * invocation. Emits an `agent.invoke` telemetry event and enforces two runtime
 * caps:
 *
 *   1. **8-min reviewer hard cap (NFR2):** when `agent === "generalist-reviewer"`
 *      and `runtimeMs > REVIEWER_HARD_CAP_MS`, substitutes the verdict comment
 *      via `postReviewerComments` (which owns the `reviewer.verdict` emission
 *      seam), applies `needs-human` via `applyReviewerLabels`, and returns
 *      `{ kind: "reviewer-timed-out" }`. The story is NOT marked failed.
 *
 *   2. **30-min dev budget (NFR3):** when `agent === "generalist-dev"` and
 *      `storyId !== undefined`, reads the current month's JSONL to compute
 *      cumulative dev runtime for this story. On first crossing of
 *      `DEV_BUDGET_MS`, emits a `dev.budget_exceeded` event and returns
 *      `{ kind: "dev-budget-exceeded" }`.
 *
 * The SKILL.md prose caller (dev session) is responsible for capturing
 * `startedAt` before the Task-tool spawn and `completedAt` after it returns.
 * The MCP layer cannot observe the spawn directly.
 *
 * `recordAgentInvoke` does NOT emit `reviewer.verdict` directly — that event
 * is owned exclusively by `postReviewerComments`'s POST-success path. The
 * 8-min substitution path calls `postReviewerComments` with overrides, and
 * `postReviewerComments` emits the event with `verdict: "reviewer-failure"` and
 * `timed_out: true`.
 *
 * Story 4.12 (FR65, NFR2, NFR3).
 */
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { logTelemetryEvent } from "../lib/logger.js";
import { getPluginVersion } from "../lib/plugin-version.js";
import { REVIEWER_HARD_CAP_MS, DEV_BUDGET_MS } from "../lib/runtime-limits.js";
import { RuntimeBoundsInvalidError } from "../errors.js";
import { postReviewerComments, } from "./post-reviewer-comments.js";
import { applyReviewerLabels, } from "./apply-reviewer-labels.js";
import { TelemetryEventSchema } from "../schemas/telemetry-events.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Derive the current month's JSONL file path under `<targetRepoRoot>/.crew/telemetry/`.
 */
function currentMonthJsonlPath(targetRepoRoot, now) {
    const ts = now.toISOString();
    const month = ts.slice(0, 7); // YYYY-MM
    return path.join(targetRepoRoot, ".crew", "telemetry", `${month}.jsonl`);
}
/**
 * Read the raw JSONL file at `filePath`. Returns `""` on ENOENT.
 */
async function defaultReadCurrentMonthJsonl(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return "";
        }
        throw err;
    }
}
/**
 * Compose the substituted failure comment body for the 8-min reviewer hard cap.
 * The body MUST include the locked verdict-marker footer so `postReviewerComments`'s
 * idempotent grep-and-edit path works for subsequent successful reviewer runs.
 *
 * Spec reference: AC3 unpacked (3b).
 */
function composeSubstitutedBody(opts) {
    const runtimeSecs = Math.round(opts.runtimeMs / 1000);
    const storyRef = opts.storyId ?? "(unknown)";
    const footerMarker = `<!-- crew:verdict:${opts.pluginVersion}:${storyRef} -->`;
    return (`## Reviewer exceeded 8-minute hard cap\n\n` +
        `Reviewer wall-clock ran for ${runtimeSecs} seconds (cap: 480 seconds). ` +
        `Story was not marked failed; \`needs-human\` label applied so a human can triage.\n\n` +
        `Story ref: \`${storyRef}\` · PR: #${opts.prNumber}\n\n` +
        footerMarker);
}
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * Record a completed agent-subagent invocation and enforce runtime caps.
 *
 * @param opts.sessionUlid - ULID of the calling session.
 * @param opts.agent - Kebab-cased role name (e.g. `generalist-dev`).
 * @param opts.storyId - Optional story ref (adapter:id). Required for dev budget tracking.
 * @param opts.startedAt - ISO-8601 UTC timestamp captured before Task-tool spawn.
 * @param opts.completedAt - ISO-8601 UTC timestamp captured after Task-tool returns.
 * @param opts.tokensIn - Optional input token count (if available from host).
 * @param opts.tokensOut - Optional output token count (if available from host).
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 *
 * Story 4.12 (FR65, NFR2, NFR3).
 */
export async function recordAgentInvoke(opts) {
    const now = opts.nowImpl ?? (() => new Date());
    const logEvent = opts.logTelemetryEventImpl ?? logTelemetryEvent;
    const readJsonl = opts.readCurrentMonthJsonlImpl ?? defaultReadCurrentMonthJsonl;
    // -------------------------------------------------------------------------
    // Step 1: Validate runtime bounds.
    // -------------------------------------------------------------------------
    const startMs = Date.parse(opts.startedAt);
    const completedMs = Date.parse(opts.completedAt);
    if (isNaN(startMs)) {
        throw new RuntimeBoundsInvalidError({
            sessionUlid: opts.sessionUlid,
            agent: opts.agent,
            startedAt: opts.startedAt,
            completedAt: opts.completedAt,
            reason: "startedAt is not a valid ISO-8601 timestamp",
        });
    }
    if (isNaN(completedMs)) {
        throw new RuntimeBoundsInvalidError({
            sessionUlid: opts.sessionUlid,
            agent: opts.agent,
            startedAt: opts.startedAt,
            completedAt: opts.completedAt,
            reason: "completedAt is not a valid ISO-8601 timestamp",
        });
    }
    const runtimeMs = completedMs - startMs;
    if (runtimeMs < 0) {
        throw new RuntimeBoundsInvalidError({
            sessionUlid: opts.sessionUlid,
            agent: opts.agent,
            startedAt: opts.startedAt,
            completedAt: opts.completedAt,
            reason: `completedAt is before startedAt (runtime_ms=${runtimeMs})`,
        });
    }
    // -------------------------------------------------------------------------
    // Step 2: Build and emit `agent.invoke` event.
    // -------------------------------------------------------------------------
    const agentInvokeEvent = {
        type: "agent.invoke",
        session_id: opts.sessionUlid,
        agent: opts.agent,
        ...(opts.storyId !== undefined ? { story_id: opts.storyId } : {}),
        data: {
            runtime_ms: runtimeMs,
            ...(opts.tokensIn !== undefined ? { tokens_in: opts.tokensIn } : {}),
            ...(opts.tokensOut !== undefined ? { tokens_out: opts.tokensOut } : {}),
        },
    };
    await logEvent({ targetRepoRoot: opts.targetRepoRoot, event: agentInvokeEvent });
    // -------------------------------------------------------------------------
    // Step 3: Reviewer hard-cap branch.
    // -------------------------------------------------------------------------
    if (opts.agent === "generalist-reviewer" && runtimeMs > REVIEWER_HARD_CAP_MS) {
        const pluginVersion = getPluginVersion();
        // We don't have the prNumber here — read it from reviewer-result.json via
        // postReviewerComments (which reads the file internally). We pass a placeholder
        // for the substituted body composition. The prNumber in the footer is less
        // critical than the storyId for idempotency. We'll compose a body that
        // references the storyId and let postReviewerComments handle idempotent grep.
        //
        // For the substituted body we need prNumber — we'll read it from reviewer-result.json
        // if available, else use 0 as a placeholder. postReviewerComments reads the file
        // itself and the body is only cosmetic at this point.
        let prNumber = 0;
        try {
            const { readReviewerResultFile } = await import("../lib/read-reviewer-result-file.js");
            const resultFile = await readReviewerResultFile(opts.targetRepoRoot, opts.sessionUlid);
            if (resultFile !== null) {
                prNumber = resultFile.prNumber;
            }
        }
        catch {
            // Best-effort — if we can't read the file, compose with placeholder
        }
        const substitutedBody = composeSubstitutedBody({
            runtimeMs,
            pluginVersion,
            storyId: opts.storyId,
            prNumber,
        });
        let substitutedCommentUrl = "";
        let labelsApplied = [];
        // Call postReviewerComments with overrides — it owns the `reviewer.verdict` emission.
        try {
            const postImpl = opts.postReviewerCommentsImpl ?? postReviewerComments;
            const postResult = await postImpl({
                targetRepoRoot: opts.targetRepoRoot,
                sessionUlid: opts.sessionUlid,
                verdictBodyOverride: substitutedBody,
                reviewerVerdictOverride: "reviewer-failure",
            });
            // Extract a URL if the result carries one (the tool returns postedReviewId, not URL;
            // best-effort empty string unless the test stub injects a url field).
            substitutedCommentUrl = postResult.url ?? "";
        }
        catch {
            // Best-effort: postReviewerComments failure — log silently, continue.
            // The `agent.invoke` event (already written) is the durable record.
            substitutedCommentUrl = "";
        }
        try {
            const applyImpl = opts.applyReviewerLabelsImpl ?? applyReviewerLabels;
            const applyResult = await applyImpl({
                targetRepoRoot: opts.targetRepoRoot,
                sessionUlid: opts.sessionUlid,
                verdictOverride: "reviewer-failure",
            });
            labelsApplied =
                applyResult.next === "applied" && Array.isArray(applyResult.labelsApplied)
                    ? applyResult.labelsApplied
                    : [];
        }
        catch {
            // Best-effort: applyReviewerLabels failure — log silently, continue.
            labelsApplied = [];
        }
        return { kind: "reviewer-timed-out", substitutedCommentUrl, labelsApplied };
    }
    // -------------------------------------------------------------------------
    // Step 4: Dev budget branch.
    // -------------------------------------------------------------------------
    if (opts.agent === "generalist-dev" && opts.storyId !== undefined) {
        const nowDate = now();
        const jsonlPath = currentMonthJsonlPath(opts.targetRepoRoot, nowDate);
        const rawJsonl = await readJsonl(jsonlPath);
        // Parse each line of the JSONL, filter `agent.invoke` events for this story,
        // and sum `data.runtime_ms`. The newly-written event is included (already appended).
        let cumulativeRuntimeMs = 0;
        let hasExistingBudgetExceededEvent = false;
        if (rawJsonl) {
            for (const line of rawJsonl.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                let parsed;
                try {
                    parsed = JSON.parse(trimmed);
                }
                catch {
                    continue;
                }
                const parseResult = TelemetryEventSchema.safeParse(parsed);
                if (!parseResult.success)
                    continue;
                const event = parseResult.data;
                if (event.type === "agent.invoke" &&
                    event.agent === "generalist-dev" &&
                    event.story_id === opts.storyId) {
                    cumulativeRuntimeMs += event.data.runtime_ms;
                }
                if (event.type === "dev.budget_exceeded" &&
                    event.story_id === opts.storyId) {
                    hasExistingBudgetExceededEvent = true;
                }
            }
        }
        // Emit `dev.budget_exceeded` on first crossing of DEV_BUDGET_MS.
        if (cumulativeRuntimeMs >= DEV_BUDGET_MS && !hasExistingBudgetExceededEvent) {
            await logEvent({
                targetRepoRoot: opts.targetRepoRoot,
                event: {
                    type: "dev.budget_exceeded",
                    session_id: opts.sessionUlid,
                    agent: "generalist-dev",
                    story_id: opts.storyId,
                    data: {
                        cumulative_runtime_ms: cumulativeRuntimeMs,
                        budget_ms: DEV_BUDGET_MS,
                        triggering_invocation_runtime_ms: runtimeMs,
                    },
                },
            });
            return {
                kind: "dev-budget-exceeded",
                cumulativeRuntimeMs,
                budgetMs: DEV_BUDGET_MS,
            };
        }
    }
    // -------------------------------------------------------------------------
    // Step 5: Common path — no cap triggered.
    // -------------------------------------------------------------------------
    return { kind: "ok" };
}
