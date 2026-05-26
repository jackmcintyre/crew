/**
 * `runReviewerSession` composite MCP tool — Story 4.6.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md
 *
 * Performs the three mandatory reads (source story via active adapter, PR diff
 * via `gh pr diff`, standards doc via `lookupStandards`) in fixed sequential
 * order BEFORE returning any data to the persona prose. Then executes every AC
 * extracted from the source spec against the applicability classifier and returns
 * structured `acResults` keyed by AC index.
 *
 * **Revision 2 (deterministic-verdict-transport):** Before returning, this tool
 * derives `recommendedVerdict` deterministically from `acResults` per the
 * closed algorithm in spec §3f, then persists the result to
 * `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`
 * via `atomicWriteFile`. The verdict transport is the file, not the reviewer's
 * chat output. `processReviewerTranscript` reads the file and switches on
 * `recommendedVerdict` — the reviewer's chat is informational only.
 *
 * Same pattern as Story 4.3c's `completeStory` call inside
 * `processReviewerTranscript`: load-bearing decisions live in the tool layer.
 *
 * The tool MUST NOT:
 *   - Spawn subagents (that is the SKILL.md prose layer's responsibility).
 *   - Mutate any manifest (only the sessions/reviewer-result.json file is written).
 *   - Swallow typed errors — all read/execution errors propagate uncaught.
 *
 * Telemetry wiring: `agent.invoke` is recorded by the dev session's SKILL.md caller
 * via `recordAgentInvoke` (Story 4.12); `reviewer.verdict` is emitted by
 * `postReviewerComments` on POST success (Story 4.12 Task 3).
 */
import { execa as defaultExeca } from "execa";
import type { SourceStory } from "../adapters/adapter.js";
import type { Criterion, StandardsDoc } from "../schemas/standards-doc.js";
export type AcResult = {
    index: number;
    tag: string | null;
    applicability: "runnable-artifact-check";
    artifactPath: string;
    status: "pass" | "fail";
    reason: string;
} | {
    index: number;
    tag: string | null;
    applicability: "runnable-vitest";
    testNameFilter: string;
    status: "pass" | "fail";
    reason: string;
    stdout: string;
    stderr: string;
    exitCode: number;
} | {
    index: number;
    tag: string | null;
    applicability: "manual-check-required";
    reason: string;
};
/** The three recognized verdict literals — deterministically derived by the tool. */
export type RecommendedVerdict = "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED";
export interface ReviewerSessionResult {
    /** ULID of the calling session — carried on the result for the persisted file. */
    sessionUlid: string;
    /** Story ref (e.g. "native:01HZ...") — carried on the result for the persisted file. */
    ref: string;
    /** PR number passed to runReviewerSession — carried for the persisted file. */
    prNumber: number;
    sourceStory: SourceStory;
    /** Convenience copy of sourceStory.ref for the persisted file. */
    sourceStoryRef: string;
    prDiff: string;
    standards: StandardsDoc;
    standardsByCriterionId: Record<string, Criterion>;
    acResults: Record<number, AcResult>;
    /**
     * Deterministically derived from `acResults` per spec §3f:
     *  1. any-fail → "NEEDS CHANGES"
     *  2. empty OR any-manual-check-required → "BLOCKED"
     *  3. else → "READY FOR MERGE"
     *
     * The LLM does not decide this value — the tool does.
     * This field is persisted to `reviewer-result.json` and read by
     * `processReviewerTranscript` as the authoritative verdict transport.
     */
    recommendedVerdict: RecommendedVerdict;
}
/**
 * The persisted-file projection shape written to
 * `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`.
 *
 * Heavy in-memory fields (`sourceStory`, `prDiff`) are NOT persisted —
 * only the verdict-relevant data needed by `processReviewerTranscript`.
 */
export interface ReviewerResultFileShape {
    sessionUlid: string;
    ref: string;
    recommendedVerdict: RecommendedVerdict;
    acResults: Record<number, AcResult>;
    standardsByCriterionId: Record<string, Criterion>;
    sourceStoryRef: string;
    prNumber: number;
    /** Semver version of the standards doc used to produce this verdict (Story 4.7). */
    standardsVersion: string;
}
export interface RunReviewerSessionOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    ref: string;
    prNumber: number;
    role?: string;
    /** Test seam — production callers do not pass this. */
    execaImpl?: typeof defaultExeca;
    /** Plugin root override — test seam for loadRolePermissions. */
    pluginRootOverride?: string;
}
export declare function runReviewerSession(opts: RunReviewerSessionOptions): Promise<ReviewerSessionResult>;
