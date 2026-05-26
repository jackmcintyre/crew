/**
 * `runAutoMergeGate` MCP tool — Story 4.10b.
 *
 * Given a session ULID and PR number on the `done-ready-for-merge` branch:
 *
 *  1. Validates `thresholdOverride` if present.
 *  2. Resolves `threshold_used` from workspace-config `plugin.agreement_threshold` (default 0.8).
 *  3. Reads the `done/<ref>.yaml` manifest to extract `risk_tier`.
 *  4. Calls `computeAgreement({ targetRepoRoot, lastNVerdicts: lastNVerdictsOverride })`.
 *  5. Calls `decideAutoMerge({ risk_tier, agreement_metric, threshold })`.
 *  6. Composes the chat-log line.
 *  7. On `dryRun: true` → returns the decision without any gh shell-out.
 *  8. On `decision === "auto-merge"` → calls `gh pr merge <prNumber> --squash --delete-branch`.
 *  9. On `decision === "pause-needs-human"` → resolves owner/repo via `gh pr view`,
 *     then `gh api POST /repos/<owner>/<repo>/issues/<prNumber>/labels` with `needs-human`.
 * 10. Returns `AutoMergeGateResult`.
 *
 * Six-branch decision table: see `lib/auto-merge-gate.ts` (FR40 / FR41 / FR42).
 * Locked gh shape: `gh pr merge <prNumber> --squash --delete-branch` (v1 hardcoded).
 *
 * Manual-merge authority is preserved by structural omission in SKILL.md: the gate
 * is ONLY called under the `done-ready-for-merge` branch. On NEEDS CHANGES / BLOCKED
 * branches the tool is never called, so `gh pr merge` from the operator's own shell
 * proceeds unmolested.
 *
 * Story 4.10b · FR40 · FR41 · FR42
 */
import { z } from "zod";
import { execa as defaultExeca } from "execa";
import type { AgreementMetricResult, ComputeAgreementOptions } from "./compute-agreement.js";
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import type { PluginSettings } from "../schemas/workspace-config.js";
import type { AutoMergeGateReason } from "../lib/auto-merge-gate.js";
/**
 * Result schema for `runAutoMergeGate`. `.strict()` at every level to reject
 * unknown fields (AC5q).
 *
 * Exported for downstream consumers (tests, future Epic 6 retro tools).
 *
 * Story 4.10b (AC5c / AC5q).
 */
export declare const AutoMergeGateResultSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        "auto-merge": "auto-merge";
        "pause-needs-human": "pause-needs-human";
    }>;
    reason: z.ZodEnum<{
        "low-risk-met-threshold": "low-risk-met-threshold";
        "low-risk-sub-threshold": "low-risk-sub-threshold";
        "low-risk-insufficient-data": "low-risk-insufficient-data";
        "medium-risk": "medium-risk";
        "high-risk": "high-risk";
        "no-tier-no-signal": "no-tier-no-signal";
    }>;
    risk_tier: z.ZodNullable<z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>>;
    agreement_metric: z.ZodNullable<z.ZodObject<{
        ratio: z.ZodNumber;
        distribution: z.ZodObject<{
            "READY FOR MERGE": z.ZodNumber;
            "NEEDS CHANGES": z.ZodNumber;
            BLOCKED: z.ZodNumber;
        }, z.core.$strict>;
        window_size: z.ZodNumber;
        sample_size: z.ZodNumber;
        skipped_unresolved: z.ZodNumber;
        skipped_excluded: z.ZodNumber;
        malformed_lines: z.ZodNumber;
    }, z.core.$strict>>;
    threshold_used: z.ZodNumber;
    merged: z.ZodBoolean;
    labelsApplied: z.ZodArray<z.ZodString>;
    dryRun: z.ZodBoolean;
    prNumber: z.ZodNumber;
    chatLog: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type AutoMergeGateResult = z.infer<typeof AutoMergeGateResultSchema>;
export type { AutoMergeGateReason };
export interface RunAutoMergeGateOptions {
    targetRepoRoot: string;
    prNumber: number;
    /** Execution-manifest ref, e.g. `"native:01HZTEST00000000000000000"`. */
    ref: string;
    sessionUlid: string;
    /**
     * Test seam: bypasses the workspace-config read entirely.
     * Must satisfy `0 <= n <= 1`, finite, NaN-free; else `AutoMergeGateThresholdInvalidError`.
     */
    thresholdOverride?: number;
    /**
     * Test seam: forwarded as `lastNVerdicts` into `computeAgreement`.
     * Production callers pass `undefined` (defaults to 50).
     */
    lastNVerdictsOverride?: number;
    /** When `true`, skips the gh shell-out. Decision is still computed. */
    dryRun?: boolean;
    /** Test seam for execa. Production callers do not pass this. */
    execaImpl?: typeof defaultExeca;
    /** Test seam: inject a custom `computeAgreement` implementation. */
    computeAgreementImpl?: (opts: ComputeAgreementOptions) => Promise<AgreementMetricResult | null>;
    /** Test seam: inject a custom manifest reader. */
    readManifestImpl?: (absPath: string) => Promise<ExecutionManifest>;
    /** Test seam: inject a custom workspace-config loader. */
    loadWorkspaceConfigImpl?: (targetRepoRoot: string) => Promise<PluginSettings>;
    /** Plugin root override — test seam for loadRolePermissions and gh-error-map. */
    pluginRootOverride?: string;
    /** Role name for gh permission lookup (default: "generalist-dev"). */
    role?: string;
}
/**
 * Read and parse `<targetRepoRoot>/.crew/config.yaml`, returning the validated
 * `PluginSettings` (with defaults applied). Falls back to schema defaults when
 * `config.yaml` is absent — same semantics as `resolveWorkspace`.
 *
 * @internal — exposed via `loadWorkspaceConfigImpl` test seam.
 */
export declare function loadWorkspaceConfig(targetRepoRoot: string): Promise<PluginSettings>;
/**
 * Run the auto-merge gate for a PR that has reached `done-ready-for-merge`.
 *
 * Implements the six-branch decision from `lib/auto-merge-gate.ts`:
 *  - low + met-threshold → `gh pr merge --squash --delete-branch`
 *  - all other branches → `gh api POST .../labels` with `{"labels":["needs-human"]}`
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.prNumber - PR number to merge or label.
 * @param opts.ref - Execution manifest ref (used to locate `done/<ref>.yaml`).
 * @param opts.sessionUlid - Session ULID of the calling dev session.
 * @param opts.thresholdOverride - Test seam: bypass workspace-config read.
 * @param opts.lastNVerdictsOverride - Test seam: forward into computeAgreement.
 * @param opts.dryRun - Skip gh shell-out; return decision only.
 * @param opts.execaImpl - Test seam for execa subprocess.
 * @param opts.computeAgreementImpl - Test seam for computeAgreement.
 * @param opts.readManifestImpl - Test seam for manifest read.
 * @param opts.loadWorkspaceConfigImpl - Test seam for config read.
 * @param opts.pluginRootOverride - Test seam for plugin root path.
 * @param opts.role - Role name (default: "generalist-dev").
 *
 * Story 4.10b · FR40 · FR41 · FR42
 */
export declare function runAutoMergeGate(opts: RunAutoMergeGateOptions): Promise<AutoMergeGateResult>;
