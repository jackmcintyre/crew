/**
 * `reviewer.verdict` telemetry writer — Story 4.12 (FR66).
 *
 * Centralised constructor + logTelemetryEvent caller for the
 * `reviewer.verdict` event shape (Story 4.10 schema).
 *
 * `eventual_merge_action` is always `null` at verdict-post time —
 * the deferred backfill loop will resolve it once the PR closes.
 */
import { logTelemetryEvent } from "./logger.js";
export async function writeReviewerVerdictEvent(opts) {
    await logTelemetryEvent({
        targetRepoRoot: opts.targetRepoRoot,
        event: {
            type: "reviewer.verdict",
            session_id: opts.sessionUlid,
            agent: "generalist-reviewer",
            story_id: opts.ref,
            data: {
                pr_number: opts.prNumber,
                verdict: opts.verdict,
                standards_version: opts.standardsVersion,
                plugin_version: opts.pluginVersion,
                eventual_merge_action: null,
            },
        },
        ...(opts.now ? { now: opts.now } : {}),
    });
}
