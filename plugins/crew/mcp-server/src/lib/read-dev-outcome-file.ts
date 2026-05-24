/**
 * Shared helper: read, parse, and validate the `dev-outcome.json` file
 * written by `runDevTerminalAction`.
 *
 * Mirrors the pattern of `lib/read-reviewer-result-file.ts` (Story 4.6 revision 2):
 * - Returns `null` on ENOENT (file absent — fallback to transcript scanning).
 * - Throws `DevOutcomeFileMalformedError` on malformed JSON or any validation miss.
 *   A malformed file is a machine-write failure and must NOT silently fall back.
 *
 * Signature deliberately matches `readReviewerResultFile(targetRepoRoot, sessionUlid)`
 * so both helpers are compositionally symmetric.
 *
 * Story 4.8b Task 3 / AC2–AC4.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { DevOutcomeFileMalformedError } from "../errors.js";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface DevOutcome {
  prUrl: string;
  prNumber: number;
  branch: string;
  commitSha: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Read, parse, and validate the `dev-outcome.json` file written by
 * `runDevTerminalAction`. Returns `null` when the file is absent (ENOENT).
 * Throws `DevOutcomeFileMalformedError` on malformed JSON or unexpected shape.
 *
 * @param targetRepoRoot - Absolute path to the target repository root.
 * @param sessionUlid - ULID of the calling session.
 */
export async function readDevOutcomeFile(
  targetRepoRoot: string,
  sessionUlid: string,
): Promise<DevOutcome | null> {
  const filePath = path.join(
    targetRepoRoot,
    ".crew",
    "state",
    "sessions",
    sessionUlid,
    "dev-outcome.json",
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
    throw new DevOutcomeFileMalformedError({ path: filePath, cause });
  }

  // Minimal shape validation — manual field checks mirroring read-reviewer-result-file.ts.
  if (typeof parsed !== "object" || parsed === null) {
    throw new DevOutcomeFileMalformedError({
      path: filePath,
      cause: "parsed value is not an object",
    });
  }

  const asRecord = parsed as Record<string, unknown>;

  if (typeof asRecord["prUrl"] !== "string") {
    throw new DevOutcomeFileMalformedError({
      path: filePath,
      cause: "missing or non-string 'prUrl' field",
    });
  }

  if (typeof asRecord["branch"] !== "string") {
    throw new DevOutcomeFileMalformedError({
      path: filePath,
      cause: "missing or non-string 'branch' field",
    });
  }

  if (typeof asRecord["commitSha"] !== "string") {
    throw new DevOutcomeFileMalformedError({
      path: filePath,
      cause: "missing or non-string 'commitSha' field",
    });
  }

  const prNumber = asRecord["prNumber"];
  if (
    typeof prNumber !== "number" ||
    !Number.isInteger(prNumber) ||
    prNumber <= 0
  ) {
    throw new DevOutcomeFileMalformedError({
      path: filePath,
      cause:
        `'prNumber' field is invalid: expected a positive integer, got ${JSON.stringify(prNumber)}`,
    });
  }

  return {
    prUrl: asRecord["prUrl"] as string,
    prNumber,
    branch: asRecord["branch"] as string,
    commitSha: asRecord["commitSha"] as string,
  };
}
