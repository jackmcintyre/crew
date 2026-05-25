/**
 * Pure agreement-ratio helper for the auto-merge gate (Story 4.10 /
 * FR67 / NFR24).
 *
 * Scans `<targetRepoRoot>/.crew/telemetry/<YYYY-MM>.jsonl`, reads every
 * `reviewer.verdict` event, filters to those with a resolved
 * `eventual_merge_action`, takes the trailing `lastNVerdicts` slice, and
 * reports the agreement ratio between the verdict and the eventual
 * action.
 *
 * Writer/reader split mirrors `lib/team-stats.ts` (the v1 template
 * named in its own docstring): same readdir try-block, same per-line
 * parse loop, same malformed-line tolerance, same private `isEnoent`
 * helper. The two files are intentionally parallel.
 *
 * Returns `null` when the window cannot be filled (no telemetry
 * directory, no resolved events, fewer resolved events than the window
 * size). Callers (the auto-merge gate) treat `null` as "fail closed —
 * insufficient data, do not auto-merge".
 *
 * No writes. No network IO. No `execa`. No clock dependency.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  TelemetryEventSchema,
  type ReviewerVerdictEvent,
} from "../schemas/telemetry-events.js";

/** Month-bucket filename pattern matching the Story 1.5 logger contract. */
const MONTH_BUCKET_REGEX = /^\d{4}-\d{2}\.jsonl$/;

/** Default window size when callers omit `lastNVerdicts`. */
const DEFAULT_LAST_N_VERDICTS = 50;

/**
 * Agreement matrix (Story 4.10 AC1d). The reviewer says either
 * "merge this" (`READY FOR MERGE`) or "do-not-merge this"
 * (`NEEDS CHANGES` / `BLOCKED`); the eventual action says either
 * "the PR merged" or "the PR did NOT merge". Agreement is the match.
 */
function isAgreement(
  verdict: "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED",
  eventualAction: "merged" | "closed-without-merge" | "superseded-by-rework",
): boolean {
  const merged = eventualAction === "merged";
  const readyForMerge = verdict === "READY FOR MERGE";
  // Reviewer said merge-it and it merged → agree.
  // Reviewer said do-not-merge and it didn't merge → agree.
  return merged === readyForMerge;
}

export interface AgreementMetric {
  /** agreementCount / windowSize, in [0, 1]. */
  ratio: number;
  /** Count of resolved verdicts that agreed with the eventual action. */
  agreementCount: number;
  /** Equals the resolved `lastNVerdicts` parameter exactly. */
  windowSize: number;
  /** Per-verdict-kind counts within the window. Sums to `windowSize`. */
  distribution: {
    READY_FOR_MERGE: number;
    NEEDS_CHANGES: number;
    BLOCKED: number;
  };
  /** Total JSONL lines that failed JSON.parse or Zod validation. */
  malformedLines: number;
  /** Count of files that contained ≥1 malformed line. */
  malformedFiles: number;
}

/**
 * Compute the reviewer-vs-eventual-action agreement ratio over the
 * trailing `lastNVerdicts` resolved `reviewer.verdict` events on disk.
 *
 * Returns `null` when:
 *  - Telemetry directory missing.
 *  - Telemetry directory present but no `^\d{4}-\d{2}\.jsonl$` files.
 *  - No valid `reviewer.verdict` events on disk.
 *  - All `reviewer.verdict` events are unresolved (`eventual_merge_action: null`).
 *  - Resolved events exist but fewer than `lastNVerdicts`.
 *
 * Iteration order is lexicographic across files (so `2026-04.jsonl` <
 * `2026-05.jsonl`) and append-order within files. The "trailing N"
 * slice is taken after filtering to resolved events — unresolved events
 * are excluded entirely, not just elided from the window.
 *
 * Malformed lines do NOT abort the run; they are counted and surfaced.
 * Genuine filesystem errors (e.g. EACCES on a file mid-read) propagate
 * uncaught — they indicate environmental failure, not data corruption.
 */
export async function computeAgreement(opts: {
  targetRepoRoot: string;
  lastNVerdicts?: number;
}): Promise<AgreementMetric | null> {
  const lastNVerdicts = opts.lastNVerdicts ?? DEFAULT_LAST_N_VERDICTS;
  const telemetryDir = path.join(opts.targetRepoRoot, ".crew", "telemetry");

  let entries: string[];
  try {
    entries = await fs.readdir(telemetryDir);
  } catch (err) {
    if (isEnoent(err)) {
      return null;
    }
    throw err;
  }

  // Sort lexicographically so month-bucket files are processed in
  // chronological order (`2026-04.jsonl` before `2026-05.jsonl`).
  const monthFiles = entries.filter((e) => MONTH_BUCKET_REGEX.test(e)).sort();

  const verdictEvents: ReviewerVerdictEvent[] = [];
  let malformedLines = 0;
  let malformedFiles = 0;

  for (const entry of monthFiles) {
    const filePath = path.join(telemetryDir, entry);
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split("\n");

    let fileHasMalformation = false;

    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines++;
        fileHasMalformation = true;
        continue;
      }

      const result = TelemetryEventSchema.safeParse(parsed);
      if (!result.success) {
        malformedLines++;
        fileHasMalformation = true;
        continue;
      }

      if (result.data.type === "reviewer.verdict") {
        verdictEvents.push(result.data);
      }
    }

    if (fileHasMalformation) {
      malformedFiles++;
    }
  }

  // Filter to resolved events (eventual_merge_action !== null), then
  // take the trailing `lastNVerdicts` slice.
  const resolved = verdictEvents.filter(
    (e) => e.data.eventual_merge_action !== null,
  );
  if (resolved.length < lastNVerdicts) {
    return null;
  }
  const window = resolved.slice(-lastNVerdicts);

  let agreementCount = 0;
  const distribution = {
    READY_FOR_MERGE: 0,
    NEEDS_CHANGES: 0,
    BLOCKED: 0,
  };

  for (const event of window) {
    const verdict = event.data.verdict;
    const eventualAction = event.data.eventual_merge_action;
    // `eventualAction` is non-null here because of the resolved filter.
    if (eventualAction !== null && isAgreement(verdict, eventualAction)) {
      agreementCount++;
    }

    if (verdict === "READY FOR MERGE") {
      distribution.READY_FOR_MERGE++;
    } else if (verdict === "NEEDS CHANGES") {
      distribution.NEEDS_CHANGES++;
    } else {
      distribution.BLOCKED++;
    }
  }

  return {
    ratio: agreementCount / lastNVerdicts,
    agreementCount,
    windowSize: lastNVerdicts,
    distribution,
    malformedLines,
    malformedFiles,
  };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
