/**
 * `agent.invoke` telemetry writer — Story 4.12 (FR65).
 *
 * Thin wrapper over `logTelemetryEvent` that constructs an `agent.invoke`
 * event from spawn-time + identity inputs and writes it. Centralised so
 * the three callers (`processDevTranscript`, `processReviewerTranscript`,
 * the reviewer-timeout branch in `postReviewerComments`) emit identically-
 * shaped events.
 *
 * Token-count fields (`tokens_in`, `tokens_out`) are intentionally omitted
 * — Claude Code's `Task` tool does not surface per-spawn token counts to
 * the parent prose layer in v1. The schema accommodates them so a future
 * story can populate them additively.
 */
export interface WriteAgentInvokeEventOpts {
    targetRepoRoot: string;
    sessionUlid: string;
    agent: "generalist-dev" | "generalist-reviewer";
    ref: string;
    runtimeMs: number;
    /** Test seam — production callers omit. */
    now?: () => Date;
}
export declare function writeAgentInvokeEvent(opts: WriteAgentInvokeEventOpts): Promise<void>;
