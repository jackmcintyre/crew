import { promises as fs, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { z } from "zod";
import {
  AmbiguousBmadRefError,
  BmadLlmExtractionError,
  MalformedBmadStoryError,
  UnknownBmadRefError,
} from "../../errors.js";
import type { DisciplineViolation, PlanningAdapter, SourceStory } from "../adapter.js";
import { validateStoryAgainstDiscipline } from "../../validators/planning-discipline.js";
import { extractBmadStoryViaLlm } from "./extract-bmad-story-llm.js";
import { parseBmadStory } from "./parse-bmad-story.js";
import {
  mapBmadStatusToExecution,
  reconcileStatus,
  type BmadStatus,
  type ExecutionState,
  type ReconciliationOutcome,
} from "./map-bmad-status.js";

/**
 * BMad planning adapter — v1 reference implementation (Story 3.3).
 *
 * The adapter normalises BMad-shaped story files under
 * `adapter_config.stories_root` into the canonical `SourceStory` shape
 * defined by Story 3.1's `PlanningAdapter` interface.
 *
 * `detect()` is stateless: it answers against an explicit `targetRepo`
 * argument and the default `stories_root`. The other interface methods
 * require a bound `(targetRepo, storiesRoot)` context, which the
 * runtime sets via {@link configureBmadAdapter}, invoked from `resolveWorkspace`
 * once the workspace config has been resolved (Story 3.3b). Tests bypass
 * `resolveWorkspace` and call `configureBmadAdapter` directly.
 *
 * @see plugins/crew/docs/spikes/bmad-format.md
 */

const DEFAULT_STORIES_ROOT = "_bmad-output/planning-artifacts/stories";

type BmadContext = {
  targetRepo: string;
  storiesRoot: string;
};

// Per-process mutable context. The registry/getActiveAdapter wiring
// (Story 3.1) is responsible for setting this before list/read/resolve
// are called. Tests call configureBmadAdapter explicitly.
let currentContext: BmadContext | undefined;

// Lazy ref→absolute-path index, rebuilt when context changes.
let refIndex: Map<string, string> | undefined;
let refIndexFor: BmadContext | undefined;

/**
 * Configure the bound `(targetRepo, storiesRoot)` context the adapter's
 * list/read/resolve methods operate against. Called by the runtime
 * (Story 3.1's `getActiveAdapter()`) and by tests.
 */
export function configureBmadAdapter(ctx: BmadContext): void {
  currentContext = { targetRepo: path.resolve(ctx.targetRepo), storiesRoot: ctx.storiesRoot };
  refIndex = undefined;
  refIndexFor = undefined;
}

/** Reset the bound context — primarily for test cleanup. */
export function resetBmadAdapter(): void {
  currentContext = undefined;
  refIndex = undefined;
  refIndexFor = undefined;
}

function requireContext(): BmadContext {
  if (!currentContext) {
    throw new Error(
      "BmadAdapter has no bound context. Call configureBmadAdapter({ targetRepo, storiesRoot }) " +
        "before invoking list/read/resolve. (Story 3.3)",
    );
  }
  return currentContext;
}

function absStoriesRoot(ctx: BmadContext): string {
  return path.isAbsolute(ctx.storiesRoot)
    ? ctx.storiesRoot
    : path.join(ctx.targetRepo, ctx.storiesRoot);
}

// Story 3.8: widened to accept letter-suffixed story IDs (e.g. 4-8b-...).
// The optional [a-z] captures the single-letter suffix shape observed in this
// repo (4-8b, 5-4b). Wider patterns risk colliding with the slug class.
const BMAD_FILENAME_RE = /^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/;

/**
 * Story 3.9 Task 4: cheap pre-read filter that skips done/optional
 * stories at the directory walk. Reads only the first ~4 KB of the
 * file looking for a `Status:` line; returns true if the value is
 * `done` or `optional`. Stops scanning after the first `## ` heading
 * (Status must appear in the preamble per the parser contract).
 *
 * Defensive: any IO error returns false so the regular parser path
 * runs and either succeeds or throws a useful error.
 */
async function shouldSkipDoneAtWalk(absFile: string): Promise<boolean> {
  let head: string;
  try {
    const handle = await fs.open(absFile, "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      head = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
  const lines = head.split("\n");
  for (const raw of lines) {
    if (/^##\s/.test(raw)) return false;
    const m = /^Status:\s*(\S.*?)\s*$/.exec(raw);
    if (m) {
      const value = m[1]!.toLowerCase();
      return value === "done" || value === "optional";
    }
  }
  return false;
}

/**
 * Story 3.9 Task 4 (belt-and-braces): if a sprint-status.yaml file
 * exists at the documented BMad path, return the set of refs marked
 * `done` in `development_status:`. Used to short-circuit parsing for
 * already-shipped stories whose source file may have drifted.
 */
async function readSprintStatusDoneRefs(targetRepo: string): Promise<Set<string>> {
  const candidate = path.join(
    targetRepo,
    "_bmad-output",
    "implementation-artifacts",
    "sprint-status.yaml",
  );
  try {
    const raw = await fs.readFile(candidate, "utf8");
    const parsed = yamlParse(raw) as { development_status?: Record<string, string> };
    const out = new Set<string>();
    for (const [key, value] of Object.entries(parsed?.development_status ?? {})) {
      if (typeof value === "string" && value === "done") {
        // Story keys may be either `1-1-...slug` or `epic-1` — only the
        // slug-shaped ones map to story files. Pull the epic + story
        // number out of the key for matching the filename pattern later.
        const m = /^(\d+)-(\d+[a-z]?)-/.exec(key);
        if (m) {
          out.add(`${m[1]}-${m[2]}`);
        }
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

function fileKeyForSprintStatus(absFile: string): string | null {
  const base = path.basename(absFile);
  const m = /^(\d+)-(\d+[a-z]?)-/.exec(base);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function readStoriesDir(absRoot: string): Promise<string[]> {
  // Returns absolute paths of BMad-shaped story files. Walks one level
  // of subdirectory deep (Task 3.2 — defensive against future
  // epic-grouped subdirs). Files not matching the BMad filename
  // pattern are silently skipped.
  let entries;
  try {
    entries = await fs.readdir(absRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && BMAD_FILENAME_RE.test(e.name)) {
      out.push(path.join(absRoot, e.name));
      continue;
    }
    if (e.isDirectory()) {
      let sub;
      try {
        sub = await fs.readdir(path.join(absRoot, e.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of sub) {
        if (s.isFile() && BMAD_FILENAME_RE.test(s.name)) {
          out.push(path.join(absRoot, e.name, s.name));
        }
      }
    }
  }
  return out;
}

function readStoriesDirSync(absRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && BMAD_FILENAME_RE.test(e.name)) {
      out.push(path.join(absRoot, e.name));
      continue;
    }
    if (e.isDirectory()) {
      let sub;
      try {
        sub = readdirSync(path.join(absRoot, e.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of sub) {
        if (s.isFile() && BMAD_FILENAME_RE.test(s.name)) {
          out.push(path.join(absRoot, e.name, s.name));
        }
      }
    }
  }
  return out;
}

// Story 3.8: story field is now a string (e.g. "8b") to preserve letter suffixes.
function parseRef(ref: string): { epic: number; story: string } | null {
  const m = /^bmad:(\d+)\.(\d+[a-z]?)$/.exec(ref);
  if (!m) return null;
  return { epic: parseInt(m[1]!, 10), story: m[2]! };
}

// Story 3.8: story field is now a string to preserve letter suffixes.
function epicStoryFromFilename(file: string): { epic: number; story: string } | null {
  const m = /^(\d+)-(\d+)([a-z]?)-/.exec(path.basename(file));
  if (!m) return null;
  return { epic: parseInt(m[1]!, 10), story: m[2]! + m[3]! };
}

function buildRefIndex(files: readonly string[], storiesRootAbs: string): Map<string, string> {
  const byRef = new Map<string, string[]>();
  for (const f of files) {
    const es = epicStoryFromFilename(f);
    if (!es) continue;
    const ref = `bmad:${es.epic}.${es.story}`;
    const existing = byRef.get(ref);
    if (existing) existing.push(f);
    else byRef.set(ref, [f]);
  }
  const result = new Map<string, string>();
  for (const [ref, paths] of byRef) {
    if (paths.length === 1) {
      result.set(ref, paths[0]!);
    } else {
      throw new AmbiguousBmadRefError({ ref, matches: paths.map((p) => path.relative(storiesRootAbs, p)) });
    }
  }
  return result;
}

function ensureRefIndex(ctx: BmadContext): Map<string, string> {
  if (refIndex && refIndexFor === ctx) return refIndex;
  const absRoot = absStoriesRoot(ctx);
  const files = readStoriesDirSync(absRoot);
  refIndex = buildRefIndex(files, absRoot);
  refIndexFor = ctx;
  return refIndex;
}

export const BmadAdapter: PlanningAdapter = {
  name: "bmad",

  async detect(targetRepo: string): Promise<boolean> {
    // Story 3.8 AC5: two-step contract.
    //   1. If currentContext is bound to this targetRepo, use the configured
    //      storiesRoot. This lets validateActiveAdapter (called after
    //      configureBmadAdapter runs inside resolveWorkspace) see the
    //      operator-configured root, suppressing the misleading (mismatched)
    //      label.
    //   2. Otherwise fall back to DEFAULT_STORIES_ROOT for first-run auto-detect.
    const resolvedTarget = path.resolve(targetRepo);
    let absRoot: string;
    if (currentContext && path.resolve(currentContext.targetRepo) === resolvedTarget) {
      absRoot = absStoriesRoot(currentContext);
    } else {
      absRoot = path.join(targetRepo, DEFAULT_STORIES_ROOT);
    }
    try {
      const s = statSync(absRoot);
      if (!s.isDirectory()) return false;
    } catch {
      return false;
    }
    let entries: string[];
    try {
      entries = await fs.readdir(absRoot);
    } catch {
      return false;
    }
    for (const name of entries) {
      if (BMAD_FILENAME_RE.test(name)) return true;
    }
    return false;
  },

  async listSourceStories(): Promise<SourceStory[]> {
    const result = await listSourceStoriesResilient();
    return result.stories;
  },

  async readSourceStory(ref: string): Promise<SourceStory> {
    const ctx = requireContext();
    const parsedRef = parseRef(ref);
    if (!parsedRef) {
      throw new UnknownBmadRefError({ ref, storiesRoot: absStoriesRoot(ctx) });
    }
    const index = ensureRefIndex(ctx);
    // parsedRef.story is already a string (e.g. "8b") — Story 3.8.
    const file = index.get(`bmad:${parsedRef.epic}.${parsedRef.story}`);
    if (!file) {
      throw new UnknownBmadRefError({ ref, storiesRoot: absStoriesRoot(ctx) });
    }
    const contents = await fs.readFile(file, "utf8");
    return parseBmadStory(file, contents);
  },

  resolveSourcePath(ref: string): string {
    const ctx = requireContext();
    const parsedRef = parseRef(ref);
    if (!parsedRef) {
      throw new UnknownBmadRefError({ ref, storiesRoot: absStoriesRoot(ctx) });
    }
    const index = ensureRefIndex(ctx);
    // parsedRef.story is already a string (e.g. "8b") — Story 3.8.
    const file = index.get(`bmad:${parsedRef.epic}.${parsedRef.story}`);
    if (!file) {
      throw new UnknownBmadRefError({ ref, storiesRoot: absStoriesRoot(ctx) });
    }
    return file;
  },

  defaultConfig(): Record<string, unknown> {
    return { stories_root: DEFAULT_STORIES_ROOT };
  },

  adapterConfigSchema: z.object({ stories_root: z.string() }),

  /**
   * Validate a BMad `SourceStory` against planning-discipline rules.
   * Delegates to the pure `validateStoryAgainstDiscipline` function (Story 3.5).
   *
   * Per-story only — ship-gate (backlog-level) is not enforced at scan-time
   * in v1 per the story spec (Task 3.2). BMad-authored backlogs rely on the
   * planner for ship-gate discipline; the scan-time path catches
   * missing-integration-AC (the dominant bugfix-1 failure mode).
   *
   * @see _bmad-output/implementation-artifacts/3-5-planning-discipline-validation-at-authoring-and-scan-time.md § Task 3
   */
  validateAgainstDiscipline(story: SourceStory): SourceStory | DisciplineViolation {
    return validateStoryAgainstDiscipline(story);
  },
};

/**
 * Story 3.9 Task 1+2+4: per-file resilient list. Returns successful
 * parses alongside metadata for files that:
 *   - skipped at directory walk because Status is done/optional
 *     (Task 4 — bundled with this story);
 *   - fell back to LLM extraction after the regex parser threw
 *     (Task 2 — the load-bearing change);
 *   - failed both regex and LLM extraction and need routing to
 *     `blocked/<ref>.yaml` with `blocked_by: "unparseable"` (Task 1).
 *
 * `scan-sources` consumes this richer result; the canonical
 * `listSourceStories()` exported on the adapter interface keeps its
 * narrow contract (returns only successful stories) and is implemented
 * in terms of this helper.
 *
 * @see _bmad-output/implementation-artifacts/3-9-bmad-adapter-llm-fallback-extraction.md
 */
export type UnparseableEntry = {
  /** Absolute path to the source file. */
  path: string;
  /** Best-effort ref guess derived from the filename, or null. */
  refGuess: string | null;
  /** The original regex-parse error message. */
  regexError: string;
  /** The LLM extraction error message, when the fallback also failed. */
  llmError?: string;
};

export type ResilientListResult = {
  stories: SourceStory[];
  /** Refs of stories produced by the LLM-fallback path (audit trail). */
  extractedByLlm: string[];
  /** Files that failed both parsing paths (route to `blocked/`). */
  unparseable: UnparseableEntry[];
  /**
   * Number of skipped files at the directory walk (status done/optional).
   * Audit-only — these files are not blocked or failed; they simply do
   * not produce a manifest.
   */
  skippedDone: number;
};

export async function listSourceStoriesResilient(
  options?: { extractOptionsOverride?: { client?: unknown; primaryModel?: string; retryModel?: string } },
): Promise<ResilientListResult> {
  const ctx = requireContext();
  const absRoot = absStoriesRoot(ctx);
  const files = await readStoriesDir(absRoot);

  // Build (and validate uniqueness of) the ref index off the same
  // file set. Files that ultimately fail both parsing paths still
  // count toward ref-collision detection — they have a known filename.
  refIndex = buildRefIndex(files, absRoot);
  refIndexFor = ctx;

  // Story 3.9 Task 4: pre-load sprint-status done refs once per call.
  const doneFromSprintStatus = await readSprintStatusDoneRefs(ctx.targetRepo);

  const parsed: SourceStory[] = [];
  const extractedByLlm: string[] = [];
  const unparseable: UnparseableEntry[] = [];
  let skippedDone = 0;

  for (const file of files) {
    // Story 3.9 Task 4 — cheap status pre-read.
    if (await shouldSkipDoneAtWalk(file)) {
      skippedDone += 1;
      continue;
    }
    // Belt-and-braces: skip if sprint-status.yaml lists this ref as done.
    const sprintKey = fileKeyForSprintStatus(file);
    if (sprintKey && doneFromSprintStatus.has(sprintKey)) {
      skippedDone += 1;
      continue;
    }

    const contents = await fs.readFile(file, "utf8");

    // Story 3.9 Task 1 — per-file isolation seam.
    try {
      const story = parseBmadStory(file, contents);
      const status = story.raw_frontmatter["status"] as BmadStatus;
      if (status === "optional") continue; // Defensive: parser-side filter (Story 3.8 contract).
      parsed.push(story);
    } catch (regexErr) {
      if (!(regexErr instanceof MalformedBmadStoryError)) throw regexErr;
      // Try the LLM fallback (Story 3.9 Task 2).
      try {
        const extractOpts = {
          targetRepoRoot: ctx.targetRepo,
          ...(options?.extractOptionsOverride as
            | { client?: never; primaryModel?: string; retryModel?: string }
            | undefined),
        };
        const story = await extractBmadStoryViaLlm(file, contents, extractOpts as never);
        parsed.push(story);
        extractedByLlm.push(story.ref);
      } catch (llmErr) {
        const llmMessage =
          llmErr instanceof BmadLlmExtractionError
            ? llmErr.reason + (llmErr.underlying ? ` (${llmErr.underlying})` : "")
            : llmErr instanceof Error
              ? llmErr.message
              : String(llmErr);
        unparseable.push({
          path: file,
          refGuess: refGuessFromFilename(file),
          regexError: regexErr.reason,
          llmError: llmMessage,
        });
      }
    }
  }

  // Story 3.8: sort by (epic, storyNumericPart, storySuffix) so that e.g.
  // "4.8" sorts before "4.8b" (numeric part equal, no-suffix < suffix).
  parsed.sort((a, b) => {
    const ea = (a.raw_frontmatter["id"] as string | undefined) ?? refToId(a.ref);
    const eb = (b.raw_frontmatter["id"] as string | undefined) ?? refToId(b.ref);
    const [aeStr, asStr] = ea.split(".") as [string, string];
    const [beStr, bsStr] = eb.split(".") as [string, string];
    const ae = parseInt(aeStr, 10);
    const be = parseInt(beStr, 10);
    if (ae !== be) return ae - be;
    const [, asNum, asSuf] = /^(\d+)([a-z]?)$/.exec(asStr) ?? ["", "0", ""];
    const [, bsNum, bsSuf] = /^(\d+)([a-z]?)$/.exec(bsStr) ?? ["", "0", ""];
    const numDiff = parseInt(asNum!, 10) - parseInt(bsNum!, 10);
    if (numDiff !== 0) return numDiff;
    return (asSuf ?? "").localeCompare(bsSuf ?? "");
  });

  return { stories: parsed, extractedByLlm, unparseable, skippedDone };
}

function refToId(ref: string): string {
  const m = /^bmad:(\d+)\.(\d+[a-z]?)$/.exec(ref);
  if (!m) return "0.0";
  return `${m[1]}.${m[2]}`;
}

function refGuessFromFilename(file: string): string | null {
  const es = epicStoryFromFilename(file);
  if (!es) return null;
  return `bmad:${es.epic}.${es.story}`;
}

// Re-exports — the test suite and downstream consumers import these via
// the adapter's index module for a single entry point per adapter
// (Task 9.2).
export {
  parseBmadStory,
  mapBmadStatusToExecution,
  reconcileStatus,
  MalformedBmadStoryError,
  UnknownBmadRefError,
  AmbiguousBmadRefError,
};
export type { BmadStatus, ExecutionState, ReconciliationOutcome };
