import { promises as fs } from "node:fs";
import * as path from "node:path";
import { readRecentCommitTitles } from "../lib/git.js";
import {
  detectDependencyManifests,
  detectLanguagesFromLayout,
  truncateReadmeExcerpt,
} from "../lib/repo-signal-detectors.js";
import {
  RepoSignalsSchema,
  type RepoSignals,
} from "../schemas/repo-signals.js";

export interface ReadRepoSignalsOptions {
  targetRepoRoot: string;
}

/**
 * Return a typed `RepoSignals` payload describing the target repo at a
 * high level (Story 2.4, FR85). The hiring manager subagent consumes
 * this as initial context to drive a project-shaped team proposal.
 *
 * Best-effort downgrades: missing README (ENOENT) → `readmeExcerpt = ""`;
 * `git log` non-zero exit (no git, no commits, not a repo) →
 * `recentCommitTitles = []`. Other IO errors propagate — they indicate a
 * misconfigured repo, not "no signal."
 *
 * No telemetry — `readRepoSignals` is a synchronous read-only diagnostic
 * (NFR21).
 */
export async function readRepoSignals(
  opts: ReadRepoSignalsOptions,
): Promise<RepoSignals> {
  const dirents = await fs.readdir(opts.targetRepoRoot, {
    withFileTypes: true,
  });
  // Filter out dotfiles except `.crew` (operator-observable plugin marker).
  const topLevelLayout = dirents
    .map((d) => d.name)
    .filter((name) => !name.startsWith(".") || name === ".crew")
    .sort();

  const languages = detectLanguagesFromLayout(topLevelLayout);
  const dependencyManifests = detectDependencyManifests(topLevelLayout);

  const readmePath = path.join(opts.targetRepoRoot, "README.md");
  let readmeExcerpt = "";
  try {
    const raw = await fs.readFile(readmePath, "utf8");
    readmeExcerpt = truncateReadmeExcerpt(raw);
  } catch (err) {
    if (!isEnoent(err)) {
      throw err;
    }
    // ENOENT → leave readmeExcerpt as "".
  }

  const recentCommitTitles = await readRecentCommitTitles({
    cwd: opts.targetRepoRoot,
    limit: 5,
  });

  const payload: RepoSignals = {
    targetRepoRoot: opts.targetRepoRoot,
    languages,
    topLevelLayout,
    readmeExcerpt,
    recentCommitTitles,
    dependencyManifests,
  };

  return RepoSignalsSchema.parse(payload);
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
