/**
 * Shared helper: read, parse, and validate the `reviewer-result.json` file
 * written by `runReviewerSession`.
 *
 * Extracted from `tools/process-reviewer-transcript.ts` (Story 4.6 revision 2)
 * into this shared module so both `processReviewerTranscript` and the new
 * `postReviewerComments` tool (Story 4.6b) can call the same parser without
 * duplicating the null-on-ENOENT / throw-on-malformed behaviour.
 *
 * Story 4.6b Task 1.1; extended Story 4.7 Task 1.2 to carry standardsVersion.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ReviewerResultFileMalformedError } from "../errors.js";
import { RiskTierBlockSchema } from "../tools/classify-risk-tier.js";
import type { ReviewerResultFileShape } from "../tools/run-reviewer-session.js";
import type { RiskTierBlock } from "../tools/classify-risk-tier.js";

export type { ReviewerResultFileShape };

/**
 * Read, parse, and validate the `reviewer-result.json` file written by
 * `runReviewerSession`. Returns `null` when the file is absent (ENOENT).
 * Throws `ReviewerResultFileMalformedError` on malformed JSON or unexpected shape.
 *
 * The `standardsVersion` field is optional with a default of `""` for backward
 * compatibility with files produced by pre-4.7 plugin builds.
 *
 * @param targetRepoRoot - Absolute path to the target repository root.
 * @param sessionUlid - ULID of the calling session.
 */
export async function readReviewerResultFile(
  targetRepoRoot: string,
  sessionUlid: string,
): Promise<ReviewerResultFileShape | null> {
  const filePath = path.join(
    targetRepoRoot,
    ".crew",
    "state",
    "sessions",
    sessionUlid,
    "reviewer-result.json",
  );

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ReviewerResultFileMalformedError({ path: filePath, cause });
  }

  // Minimal shape validation — just enough to confirm the fields we rely on.
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).recommendedVerdict !== "string" ||
    !["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED"].includes(
      (parsed as Record<string, unknown>).recommendedVerdict as string,
    )
  ) {
    throw new ReviewerResultFileMalformedError({
      path: filePath,
      cause:
        "missing or invalid 'recommendedVerdict' field — expected one of: READY FOR MERGE, NEEDS CHANGES, BLOCKED",
    });
  }

  const asRecord = parsed as Record<string, unknown>;

  // Backfill standardsVersion for pre-4.7 projection files that lack the field.
  if (typeof asRecord["standardsVersion"] !== "string") {
    asRecord["standardsVersion"] = "";
  }

  // Optional riskTier block (Story 4.9b Task 6). Absent block → backward compatible.
  // Present block → validate via RiskTierBlockSchema; malformed block → hard error.
  if (asRecord["riskTier"] !== undefined) {
    const riskTierResult = RiskTierBlockSchema.safeParse(asRecord["riskTier"]);
    if (!riskTierResult.success) {
      const firstIssue = riskTierResult.error.issues[0];
      const detail = firstIssue
        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
        : "(no details)";
      throw new ReviewerResultFileMalformedError({
        path: filePath,
        cause: `riskTier block failed schema validation: ${detail}`,
      });
    }
    asRecord["riskTier"] = riskTierResult.data as RiskTierBlock;
  }

  return asRecord as unknown as ReviewerResultFileShape;
}
