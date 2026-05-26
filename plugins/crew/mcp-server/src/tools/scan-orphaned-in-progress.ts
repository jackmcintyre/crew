/**
 * `scanOrphanedInProgress` MCP tool — Story 5.11 Task 1.
 *
 * Pure read-only scan of `<targetRepoRoot>/.crew/state/in-progress/` for manifests
 * whose `claimed_by` ULID is defined AND differs from the current session's ULID.
 *
 * Returns orphans in stable alphabetical ref order (sort by filename = ref + .yaml).
 * For each orphan, computes the transcript path and stats it to determine
 * `hasTranscript`.
 *
 * Manifests whose `claimed_by` is absent (malformed) are silently skipped — they
 * are a different defect class (out of scope for this story, per Behavioural contract).
 *
 * No write side-effects. Propagates `MalformedExecutionManifestError` verbatim.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `scanOrphanedInProgress`.
 * Story 5.11 Task 1.1–1.5.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";

export interface OrphanedManifest {
  /** Story ref, e.g. `"native:01HZ..."` or `"bmad:1.1"`. */
  ref: string;
  /** The stale `claimed_by` ULID from the manifest. */
  staleUlid: string;
  /** Absolute path to the in-progress manifest file. */
  manifestPath: string;
  /** Absolute path to the transcript file (may or may not exist). */
  transcriptPath: string;
  /** Whether the transcript file exists and is readable. */
  hasTranscript: boolean;
}

export interface ScanOrphanedInProgressResult {
  orphans: OrphanedManifest[];
}

export interface ScanOrphanedInProgressOptions {
  targetRepoRoot: string;
  sessionUlid: string;
}

/**
 * Scan `<targetRepoRoot>/.crew/state/in-progress/` for orphaned manifests.
 *
 * An orphan is a manifest whose `claimed_by` field is defined and does not match
 * the current `sessionUlid`. Results are sorted alphabetically by ref.
 *
 * @throws {MalformedExecutionManifestError} When any manifest fails schema validation.
 */
export async function scanOrphanedInProgress(
  opts: ScanOrphanedInProgressOptions,
): Promise<ScanOrphanedInProgressResult> {
  const { targetRepoRoot, sessionUlid } = opts;
  const inProgressDir = path.join(targetRepoRoot, ".crew", "state", "in-progress");
  const sessionsDir = path.join(targetRepoRoot, ".crew", "state", "sessions");

  // Read in-progress/ directory.
  let entries: string[];
  try {
    entries = await fs.readdir(inProgressDir);
  } catch (err) {
    if (isEnoent(err)) {
      return { orphans: [] };
    }
    throw err;
  }

  // Filter to .yaml files and sort alphabetically.
  const yamlEntries = entries.filter((f) => f.endsWith(".yaml")).sort();

  const orphans: OrphanedManifest[] = [];

  for (const entry of yamlEntries) {
    const absPath = path.join(inProgressDir, entry);
    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        // File vanished between readdir and readFile — skip silently.
        continue;
      }
      throw err;
    }

    const parsed = yamlParse(raw) as unknown;
    // parseExecutionManifest throws MalformedExecutionManifestError on invalid shape.
    const manifest = parseExecutionManifest(parsed, { absPath });

    // Skip manifests with absent claimed_by (malformed — different defect class).
    if (!manifest.claimed_by) {
      continue;
    }

    // Skip manifests claimed by the current session.
    if (manifest.claimed_by === sessionUlid) {
      continue;
    }

    // This manifest is an orphan.
    const staleUlid = manifest.claimed_by;
    const transcriptPath = path.join(
      sessionsDir,
      staleUlid,
      "dev-transcript.txt",
    );

    let hasTranscript = false;
    try {
      await fs.stat(transcriptPath);
      hasTranscript = true;
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
      // File absent — hasTranscript stays false.
    }

    orphans.push({
      ref: manifest.ref,
      staleUlid,
      manifestPath: absPath,
      transcriptPath,
      hasTranscript,
    });
  }

  return { orphans };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
