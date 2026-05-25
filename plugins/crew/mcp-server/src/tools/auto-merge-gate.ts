/**
 * `runAutoMergeGate` MCP tool — Story 4.10b.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-10b-auto-merge-gate-medium-high-pause-and-user-override.md
 *
 * Decides, for a just-completed reviewer run on a `READY FOR MERGE`
 * verdict, whether to auto-merge the PR (`gh pr merge --squash --delete-branch`)
 * or pause it with the `needs-human` label.
 *
 * Composes:
 *   - `readReviewerResultFile`        (Story 4.6)
 *   - `resolveWorkspace`              (Story 1.2 — for `plugin.agreement_threshold`)
 *   - `computeAgreement` (lib)        (Story 4.10 — agreement metric)
 *   - `loadRolePermissions` + `gh`    (Story 4.8 — gh wrapper pattern)
 *
 * Lineage:
 *   - 4.9b: `riskTier` field on `ReviewerResultFileShape`.
 *   - 4.10: `computeAgreement` agreement-ratio helper.
 *   - 4.8:  pause-path label-apply pattern (`gh pr view --json headRepository,
 *           headRepositoryOwner` → `gh api POST /repos/{owner}/{repo}/issues/{n}/labels`).
 *
 * Decision algorithm (AC1 unpacked 1b):
 *   1. reviewer-result.json absent           → skipped-no-session-result
 *   2. verdict !== READY FOR MERGE           → skipped-not-ready-for-merge
 *   3. AC6: any finding severity in {medium,high} AND no overrideToken
 *                                            → paused-residual-medium-or-higher
 *   4. riskTier === undefined                → paused-missing-risk-tier
 *   5. riskTier === "medium"                 → paused-medium
 *   6. riskTier === "high"                   → paused-high
 *   7. riskTier === "low":
 *      a. metric === null                    → paused-insufficient-data
 *      b. metric.ratio < threshold           → paused-sub-threshold
 *      c. else                               → merged (gh pr merge --squash --delete-branch)
 *
 * FR40, FR41, FR42.
 */

import { execa as defaultExeca } from "execa";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { gh } from "../lib/gh.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { readReviewerResultFile } from "../lib/read-reviewer-result-file.js";
import { resolveWorkspace } from "../state/workspace-resolver.js";
import { computeAgreement } from "../lib/compute-agreement.js";
import { GhApiResponseShapeError } from "../errors.js";
import type { RolePermissions } from "../schemas/role-permissions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoMergeGateResult =
  | { next: "skipped-no-session-result" }
  | { next: "skipped-not-ready-for-merge"; verdict: string }
  | { next: "merged"; prNumber: number; agreementRatio: number; threshold: number }
  | { next: "paused-medium"; prNumber: number }
  | { next: "paused-high"; prNumber: number }
  | { next: "paused-missing-risk-tier"; prNumber: number }
  | {
      next: "paused-residual-medium-or-higher";
      prNumber: number;
      residuals: { medium: number; high: number };
    }
  | {
      next: "paused-sub-threshold";
      prNumber: number;
      agreementRatio: number;
      threshold: number;
    }
  | { next: "paused-insufficient-data"; prNumber: number };

export interface RunAutoMergeGateOptions {
  targetRepoRoot: string;
  sessionUlid: string;
  role?: string;
  /** Test seam — production callers do not pass this. */
  execaImpl?: typeof defaultExeca;
  /** Plugin root override — test seam for loadRolePermissions. */
  pluginRootOverride?: string;
}

// Shape we read from reviewer-result.json beyond the locked ReviewerResultFileShape.
// `riskTier` is contributed by Story 4.9b; `overrideToken` and `findings` by retro carry-forward.
interface ExtendedResultFile {
  recommendedVerdict: string;
  prNumber: number;
  riskTier?: "low" | "medium" | "high";
  overrideToken?: string;
  findings?: ReadonlyArray<{ severity?: string }>;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runAutoMergeGate(
  opts: RunAutoMergeGateOptions,
): Promise<AutoMergeGateResult> {
  const role = opts.role ?? "orchestrator";
  const pluginRoot = opts.pluginRootOverride ?? getPluginRoot();
  const execaImpl = opts.execaImpl ?? defaultExeca;

  // Step 1: Read reviewer-result.json.
  const resultFile = (await readReviewerResultFile(
    opts.targetRepoRoot,
    opts.sessionUlid,
  )) as ExtendedResultFile | null;

  if (resultFile === null) {
    return { next: "skipped-no-session-result" };
  }

  // Step 2: Defensive — only act on READY FOR MERGE.
  if (resultFile.recommendedVerdict !== "READY FOR MERGE") {
    return {
      next: "skipped-not-ready-for-merge",
      verdict: resultFile.recommendedVerdict,
    };
  }

  const prNumber = resultFile.prNumber;
  const permissions = await loadRolePermissions({ role, pluginRoot });

  // Step 3 (AC6): residual medium/high findings without override pause.
  const overrideTokenPresent =
    typeof resultFile.overrideToken === "string" &&
    resultFile.overrideToken.length > 0;
  if (!overrideTokenPresent && Array.isArray(resultFile.findings)) {
    let medium = 0;
    let high = 0;
    for (const f of resultFile.findings) {
      if (f && f.severity === "medium") medium++;
      else if (f && f.severity === "high") high++;
    }
    if (medium + high > 0) {
      await applyNeedsHumanLabel({
        prNumber,
        role,
        permissions,
        execaImpl,
        pluginRoot,
      });
      return {
        next: "paused-residual-medium-or-higher",
        prNumber,
        residuals: { medium, high },
      };
    }
  }

  // Step 4: riskTier table.
  if (resultFile.riskTier === undefined) {
    await applyNeedsHumanLabel({
      prNumber,
      role,
      permissions,
      execaImpl,
      pluginRoot,
    });
    return { next: "paused-missing-risk-tier", prNumber };
  }

  if (resultFile.riskTier === "medium") {
    await applyNeedsHumanLabel({
      prNumber,
      role,
      permissions,
      execaImpl,
      pluginRoot,
    });
    return { next: "paused-medium", prNumber };
  }

  if (resultFile.riskTier === "high") {
    await applyNeedsHumanLabel({
      prNumber,
      role,
      permissions,
      execaImpl,
      pluginRoot,
    });
    return { next: "paused-high", prNumber };
  }

  // riskTier === "low" — resolve threshold and consult agreement metric.
  const workspace = await resolveWorkspace({ targetRepoRoot: opts.targetRepoRoot });
  const threshold = workspace.pluginSettings.agreement_threshold;

  const metric = await computeAgreement({ targetRepoRoot: opts.targetRepoRoot });

  if (metric === null) {
    await applyNeedsHumanLabel({
      prNumber,
      role,
      permissions,
      execaImpl,
      pluginRoot,
    });
    return { next: "paused-insufficient-data", prNumber };
  }

  if (metric.ratio < threshold) {
    await applyNeedsHumanLabel({
      prNumber,
      role,
      permissions,
      execaImpl,
      pluginRoot,
    });
    return {
      next: "paused-sub-threshold",
      prNumber,
      agreementRatio: metric.ratio,
      threshold,
    };
  }

  // Auto-merge.
  await gh({
    role,
    permissions,
    subcommand: "pr-merge",
    args: [String(prNumber), "--squash", "--delete-branch"],
    execaImpl,
    pluginRootOverride: pluginRoot,
  });

  return {
    next: "merged",
    prNumber,
    agreementRatio: metric.ratio,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApplyLabelOpts {
  prNumber: number;
  role: string;
  permissions: RolePermissions;
  execaImpl: typeof defaultExeca;
  pluginRoot: string;
}

/**
 * Apply the `needs-human` label to the given PR via
 * `gh api POST /repos/{owner}/{repo}/issues/{n}/labels`.
 *
 * Mirrors the resolution pattern in `applyReviewerLabels`: resolves
 * owner/repo from `gh pr view --json headRepository,headRepositoryOwner`.
 */
async function applyNeedsHumanLabel(opts: ApplyLabelOpts): Promise<void> {
  const { prNumber, role, permissions, execaImpl, pluginRoot } = opts;

  const prViewResult = await gh({
    role,
    permissions,
    subcommand: "pr-view",
    args: [String(prNumber), "--json", "headRepository,headRepositoryOwner"],
    execaImpl,
    pluginRootOverride: pluginRoot,
  });

  let owner: string;
  let repo: string;
  try {
    const prViewJson = JSON.parse(prViewResult.stdout) as {
      headRepository?: { name?: string };
      headRepositoryOwner?: { login?: string };
    };
    owner = prViewJson.headRepositoryOwner?.login ?? "";
    repo = prViewJson.headRepository?.name ?? "";
    if (!owner || !repo) {
      throw new Error("missing owner or repo in headRepository/headRepositoryOwner shape");
    }
  } catch (cause) {
    throw new GhApiResponseShapeError({ subcommand: "pr-view", cause });
  }

  const labelsUrl = `/repos/${owner}/${repo}/issues/${prNumber}/labels`;

  const labelResult = await gh({
    role,
    permissions,
    subcommand: "api",
    args: [labelsUrl, "--method", "POST", "--input", "-"],
    input: JSON.stringify({ labels: ["needs-human"] }),
    execaImpl,
    pluginRootOverride: pluginRoot,
  });

  try {
    const parsed: unknown = JSON.parse(labelResult.stdout);
    if (!Array.isArray(parsed)) {
      throw new Error(`expected array, got ${typeof parsed}`);
    }
  } catch (cause) {
    throw new GhApiResponseShapeError({ subcommand: "api", url: labelsUrl, cause });
  }
}
