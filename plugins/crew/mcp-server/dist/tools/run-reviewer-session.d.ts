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
 * This tool is the structural anchor that closes the "reviewer rubber-stamp"
 * failure mode documented in Story 4.3c: the reviewer persona's verdict
 * composition is structurally required to consume the returned
 * `ReviewerSessionResult`, so it cannot skip a read or an AC check.
 *
 * The tool MUST NOT:
 *   - Spawn subagents (that is the SKILL.md prose layer's responsibility).
 *   - Mutate any manifest, state file, or canonical-state path.
 *   - Swallow typed errors — all read/execution errors propagate uncaught.
 *
 * TODO(4.12): wire `agent.invoke` and `reviewer.verdict` telemetry events here.
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
export interface ReviewerSessionResult {
    sourceStory: SourceStory;
    prDiff: string;
    standards: StandardsDoc;
    standardsByCriterionId: Record<string, Criterion>;
    acResults: Record<number, AcResult>;
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
/**
 * Composite reviewer-session tool.
 *
 * Performs the three reads in fixed sequential order (source story →
 * PR diff → standards doc), builds `standardsByCriterionId`, runs every
 * AC via the applicability classifier, and returns `ReviewerSessionResult`.
 *
 * All errors from reads propagate uncaught — the tool does not retry or
 * swallow. The SKILL.md prose surfaces the error and exits the inner cycle.
 */
export declare function runReviewerSession(opts: RunReviewerSessionOptions): Promise<ReviewerSessionResult>;
