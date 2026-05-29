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
 *  9. On `decision === "pause-needs-human"` → resolves owner/repo via `gh repo view`,
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

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { parse as yamlParse } from "yaml";
import { execa as defaultExeca } from "execa";

import { decideAutoMerge } from "../lib/auto-merge-gate.js";
import {
  computeAgreement,
  AgreementMetricResultSchema,
  DEFAULT_AGREEMENT_WINDOW,
} from "./compute-agreement.js";
import type {
  AgreementMetricResult,
  ComputeAgreementOptions,
} from "./compute-agreement.js";
import { readManifest } from "../lib/manifest-io.js";
import { readReviewerResultFile } from "../lib/read-reviewer-result-file.js";
import type { ReviewerResultFileShape } from "../lib/read-reviewer-result-file.js";
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { gh } from "../lib/gh.js";
import { GhApiResponseShapeError } from "../errors.js";
import { AutoMergeGateThresholdInvalidError } from "../errors.js";
import { PluginSettingsSchema } from "../schemas/workspace-config.js";
import type { PluginSettings } from "../schemas/workspace-config.js";
import type { execa } from "execa";

// ---------------------------------------------------------------------------
// Output schema & type
// ---------------------------------------------------------------------------

import type { AutoMergeGateReason } from "../lib/auto-merge-gate.js";

const AutoMergeGateReasonSchema = z.enum([
  "low-risk-met-threshold",
  "low-risk-sub-threshold",
  "low-risk-insufficient-data",
  "low-risk-provisional-trust",
  "medium-risk",
  "high-risk",
  "no-tier-no-signal",
]);

/**
 * Result schema for `runAutoMergeGate`. `.strict()` at every level to reject
 * unknown fields (AC5q).
 *
 * Exported for downstream consumers (tests, future Epic 6 retro tools).
 *
 * Story 4.10b (AC5c / AC5q).
 */
export const AutoMergeGateResultSchema = z
  .object({
    decision: z.enum(["auto-merge", "pause-needs-human"]),
    reason: AutoMergeGateReasonSchema,
    risk_tier: z.enum(["low", "medium", "high"]).nullable(),
    agreement_metric: AgreementMetricResultSchema.nullable(),
    threshold_used: z.number().min(0).max(1),
    merged: z.boolean(),
    labelsApplied: z.array(z.string()),
    dryRun: z.boolean(),
    prNumber: z.number().int().positive(),
    chatLog: z.array(z.string()),
  })
  .strict();

export type AutoMergeGateResult = z.infer<typeof AutoMergeGateResultSchema>;

// Re-export the reason type for downstream consumers.
export type { AutoMergeGateReason };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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
  /**
   * Test seam: bypass the workspace-config read for the provisional-trust flag
   * (Stage-2). Production callers pass `undefined` (resolved from config).
   */
  provisionalTrustOverride?: boolean;
  /** Test seam: inject a custom reviewer-result reader (Stage-2 tier fallback). */
  readReviewerResultImpl?: (
    targetRepoRoot: string,
    sessionUlid: string,
  ) => Promise<ReviewerResultFileShape | null>;
  /** Plugin root override — test seam for loadRolePermissions and gh-error-map. */
  pluginRootOverride?: string;
  /** Role name for gh permission lookup (default: "generalist-dev"). */
  role?: string;
}

// ---------------------------------------------------------------------------
// Internal: workspace config reader
// ---------------------------------------------------------------------------

/**
 * Read and parse `<targetRepoRoot>/.crew/config.yaml`, returning the validated
 * `PluginSettings` (with defaults applied). Falls back to schema defaults when
 * `config.yaml` is absent — same semantics as `resolveWorkspace`.
 *
 * @internal — exposed via `loadWorkspaceConfigImpl` test seam.
 */
export async function loadWorkspaceConfig(targetRepoRoot: string): Promise<PluginSettings> {
  const configPath = path.join(targetRepoRoot, ".crew", "config.yaml");
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No config.yaml — return schema defaults (agreement_threshold: 0.8).
      return PluginSettingsSchema.parse({});
    }
    throw err;
  }
  const parsed = yamlParse(raw) as unknown;
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    !("plugin" in (parsed as Record<string, unknown>))
  ) {
    return PluginSettingsSchema.parse({});
  }
  const pluginBlock = (parsed as Record<string, unknown>)["plugin"];
  return PluginSettingsSchema.parse(pluginBlock ?? {});
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

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
export async function runAutoMergeGate(
  opts: RunAutoMergeGateOptions,
): Promise<AutoMergeGateResult> {
  const role = opts.role ?? "generalist-dev";
  const pluginRoot = opts.pluginRootOverride ?? getPluginRoot();
  const execaImpl = opts.execaImpl ?? defaultExeca;
  const computeAgreementFn = opts.computeAgreementImpl ?? computeAgreement;
  const readManifestFn = opts.readManifestImpl ?? readManifest;
  const loadWorkspaceConfigFn = opts.loadWorkspaceConfigImpl ?? loadWorkspaceConfig;
  const readReviewerResultFn = opts.readReviewerResultImpl ?? readReviewerResultFile;
  const dryRun = opts.dryRun ?? false;

  // ------------------------------------------------------------------
  // Step 1: Validate thresholdOverride (if present)
  // ------------------------------------------------------------------
  if (opts.thresholdOverride !== undefined) {
    const t = opts.thresholdOverride;
    if (!Number.isFinite(t) || isNaN(t)) {
      throw new AutoMergeGateThresholdInvalidError({
        threshold: t,
        reason: "must be a finite number (no NaN, no Infinity)",
      });
    }
    if (t < 0 || t > 1) {
      throw new AutoMergeGateThresholdInvalidError({
        threshold: t,
        reason: "must be in range [0, 1]",
      });
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Resolve threshold_used and provisional_trust from config.
  // Overrides (test seams) win; otherwise read .crew/config.yaml once.
  // The threshold path is unchanged (no config read when overridden); the
  // config is only loaded when a real value is needed.
  // ------------------------------------------------------------------
  let threshold_used: number;
  let pluginSettings: PluginSettings | undefined;
  if (opts.thresholdOverride !== undefined) {
    threshold_used = opts.thresholdOverride;
  } else {
    pluginSettings = await loadWorkspaceConfigFn(opts.targetRepoRoot);
    threshold_used = pluginSettings.agreement_threshold;
  }

  let provisional_trust: boolean;
  if (opts.provisionalTrustOverride !== undefined) {
    provisional_trust = opts.provisionalTrustOverride;
  } else {
    pluginSettings = pluginSettings ?? (await loadWorkspaceConfigFn(opts.targetRepoRoot));
    provisional_trust = pluginSettings.provisional_trust;
  }

  // ------------------------------------------------------------------
  // Step 3: Resolve risk_tier. Prefer the done/<ref>.yaml manifest field;
  // fall back to the tier the reviewer computed from the actual PR diff and
  // recorded in reviewer-result.json (the authoritative source — the manifest
  // is not always stamped). Without this fallback the gate sees `undefined`
  // and always pauses (`no-tier-no-signal`).
  // ------------------------------------------------------------------
  const manifestPath = path.join(
    opts.targetRepoRoot,
    ".crew",
    "state",
    "done",
    `${opts.ref}.yaml`,
  );
  const manifest = await readManifestFn(manifestPath);
  let risk_tier = (manifest as { risk_tier?: "low" | "medium" | "high" }).risk_tier;
  if (risk_tier === undefined) {
    const reviewerResult = await readReviewerResultFn(
      opts.targetRepoRoot,
      opts.sessionUlid,
    );
    // Trust the reviewer-computed tier ONLY when the result is the authoritative,
    // GREEN verdict for THIS ref. This makes the safety binding deterministic
    // rather than relying on the caller invoking the gate only on a green verdict
    // (a prose mandate, not load-bearing). A non-green verdict, a ref mismatch
    // (e.g. a stale result lingering in a reused session dir), or an absent
    // result leaves risk_tier `undefined` → the gate pauses (`no-tier-no-signal`),
    // the fail-safe outcome.
    if (
      reviewerResult !== null &&
      reviewerResult.ref === opts.ref &&
      reviewerResult.recommendedVerdict === "READY FOR MERGE"
    ) {
      risk_tier = reviewerResult.riskTier?.tier;
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Compute agreement metric
  // ------------------------------------------------------------------
  const agreement_metric = await computeAgreementFn({
    targetRepoRoot: opts.targetRepoRoot,
    lastNVerdicts: opts.lastNVerdictsOverride ?? DEFAULT_AGREEMENT_WINDOW,
  });

  // ------------------------------------------------------------------
  // Step 5: Make the gate decision
  // ------------------------------------------------------------------
  const { decision, reason } = decideAutoMerge({
    risk_tier,
    agreement_metric,
    threshold: threshold_used,
    provisional_trust,
  });

  // ------------------------------------------------------------------
  // Step 6: Compose chat-log line
  // ------------------------------------------------------------------
  const ratioStr = agreement_metric !== null ? String(agreement_metric.ratio) : "null";
  let chatLine: string;
  if (decision === "auto-merge") {
    chatLine = `auto-merge fired — PR #${opts.prNumber} merged (risk_tier: ${risk_tier ?? "undefined"}, agreement: ${ratioStr}, threshold: ${threshold_used})`;
  } else {
    chatLine = `auto-merge gate paused — PR #${opts.prNumber} labelled needs-human (reason: ${reason}, risk_tier: ${risk_tier ?? "undefined"}, agreement: ${ratioStr}, threshold: ${threshold_used})`;
  }

  // ------------------------------------------------------------------
  // Step 7: dryRun shortcut
  // ------------------------------------------------------------------
  if (dryRun) {
    return AutoMergeGateResultSchema.parse({
      decision,
      reason,
      risk_tier: risk_tier ?? null,
      agreement_metric,
      threshold_used,
      merged: false,
      labelsApplied: [],
      dryRun: true,
      prNumber: opts.prNumber,
      chatLog: [chatLine],
    });
  }

  // ------------------------------------------------------------------
  // Step 8 / 9: Execute side-effect based on decision
  // ------------------------------------------------------------------
  const permissions = await loadRolePermissions({ role, pluginRoot });

  if (decision === "auto-merge") {
    // Step 8: gh pr merge <prNumber> --squash --delete-branch
    await gh({
      role,
      permissions,
      subcommand: "pr-merge",
      args: [String(opts.prNumber), "--squash", "--delete-branch"],
      execaImpl,
      pluginRootOverride: pluginRoot,
    });

    return AutoMergeGateResultSchema.parse({
      decision,
      reason,
      risk_tier: risk_tier ?? null,
      agreement_metric,
      threshold_used,
      merged: true,
      labelsApplied: [],
      dryRun: false,
      prNumber: opts.prNumber,
      chatLog: [chatLine],
    });
  } else {
    // Step 9: Resolve owner/repo then apply needs-human label

    // 9a: gh repo view --json owner,name
    const repoViewResult = await gh({
      role,
      permissions,
      subcommand: "repo-view",
      args: ["--json", "owner,name"],
      execaImpl,
      pluginRootOverride: pluginRoot,
    });

    let owner: string;
    let repo: string;
    try {
      const repoViewJson = JSON.parse(repoViewResult.stdout) as {
        name?: string;
        owner?: { login?: string };
      };
      owner = repoViewJson.owner?.login ?? "";
      repo = repoViewJson.name ?? "";
      if (!owner || !repo) {
        throw new Error("missing owner or repo in repo-view shape");
      }
    } catch (cause) {
      throw new GhApiResponseShapeError({ subcommand: "repo-view", cause });
    }

    // 9b: gh api POST /repos/<owner>/<repo>/issues/<prNumber>/labels
    const labelsUrl = `/repos/${owner}/${repo}/issues/${opts.prNumber}/labels`;
    const labelResult = await gh({
      role,
      permissions,
      subcommand: "api",
      args: [labelsUrl, "--method", "POST", "--input", "-"],
      input: JSON.stringify({ labels: ["needs-human"] }),
      execaImpl,
      pluginRootOverride: pluginRoot,
    });

    // Parse response — labels endpoint returns the updated label list (array).
    try {
      const parsed: unknown = JSON.parse(labelResult.stdout);
      if (!Array.isArray(parsed)) {
        throw new Error(`expected array, got ${typeof parsed}`);
      }
    } catch (cause) {
      throw new GhApiResponseShapeError({ subcommand: "api", url: labelsUrl, cause });
    }

    return AutoMergeGateResultSchema.parse({
      decision,
      reason,
      risk_tier: risk_tier ?? null,
      agreement_metric,
      threshold_used,
      merged: false,
      labelsApplied: ["needs-human"],
      dryRun: false,
      prNumber: opts.prNumber,
      chatLog: [chatLine],
    });
  }
}
