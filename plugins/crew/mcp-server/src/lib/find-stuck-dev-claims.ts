/**
 * `findStuckDevClaims` — Story 4.12 (NFR3 / AC4).
 *
 * Pure-read helper. Enumerates in-progress manifests and returns the set
 * whose `claimed_at` exceeds the configured budget (default 30 min). The
 * caller (Story 5.4's poll) surfaces these as stuck stories.
 *
 * Pre-this-story manifests without `claimed_at` are silently skipped:
 * they cannot be aged. Malformed manifests re-throw verbatim.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";

export const DEV_BUDGET_MS_DEFAULT = 30 * 60 * 1000;

export interface StuckDevClaim {
  ref: string;
  manifestPath: string;
  claimedAt: string;
  sessionUlid: string;
  elapsedMs: number;
  budgetMs: number;
}

export interface FindStuckDevClaimsOpts {
  targetRepoRoot: string;
  budgetMs?: number;
  now?: () => Date;
}

export async function findStuckDevClaims(
  opts: FindStuckDevClaimsOpts,
): Promise<StuckDevClaim[]> {
  const budgetMs = opts.budgetMs ?? DEV_BUDGET_MS_DEFAULT;
  const now = opts.now ?? (() => new Date());
  const inProgressDir = path.join(
    opts.targetRepoRoot,
    ".crew",
    "state",
    "in-progress",
  );

  let entries: string[];
  try {
    entries = await fs.readdir(inProgressDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const yamlEntries = entries.filter((e) => e.endsWith(".yaml")).sort();
  const nowMs = now().getTime();
  const stuck: StuckDevClaim[] = [];

  for (const entry of yamlEntries) {
    const manifestPath = path.join(inProgressDir, entry);
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = yamlParse(raw) as unknown;
    const manifest = parseExecutionManifest(parsed, { absPath: manifestPath });

    if (!manifest.claimed_at || !manifest.claimed_by) {
      continue;
    }
    const claimedMs = new Date(manifest.claimed_at).getTime();
    if (Number.isNaN(claimedMs)) continue;
    const elapsedMs = nowMs - claimedMs;
    if (elapsedMs > budgetMs) {
      stuck.push({
        ref: manifest.ref,
        manifestPath,
        claimedAt: manifest.claimed_at,
        sessionUlid: manifest.claimed_by,
        elapsedMs,
        budgetMs,
      });
    }
  }

  return stuck.sort((a, b) => a.ref.localeCompare(b.ref));
}
