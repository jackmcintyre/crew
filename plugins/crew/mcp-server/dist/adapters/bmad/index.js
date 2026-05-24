import { promises as fs, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AmbiguousBmadRefError, MalformedBmadStoryError, UnknownBmadRefError, } from "../../errors.js";
import { validateStoryAgainstDiscipline } from "../../validators/planning-discipline.js";
import { parseBmadStory } from "./parse-bmad-story.js";
import { mapBmadStatusToExecution, reconcileStatus, } from "./map-bmad-status.js";
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
// Per-process mutable context. The registry/getActiveAdapter wiring
// (Story 3.1) is responsible for setting this before list/read/resolve
// are called. Tests call configureBmadAdapter explicitly.
let currentContext;
// Lazy ref→absolute-path index, rebuilt when context changes.
let refIndex;
let refIndexFor;
/**
 * Configure the bound `(targetRepo, storiesRoot)` context the adapter's
 * list/read/resolve methods operate against. Called by the runtime
 * (Story 3.1's `getActiveAdapter()`) and by tests.
 */
export function configureBmadAdapter(ctx) {
    currentContext = { targetRepo: path.resolve(ctx.targetRepo), storiesRoot: ctx.storiesRoot };
    refIndex = undefined;
    refIndexFor = undefined;
}
/** Reset the bound context — primarily for test cleanup. */
export function resetBmadAdapter() {
    currentContext = undefined;
    refIndex = undefined;
    refIndexFor = undefined;
}
function requireContext() {
    if (!currentContext) {
        throw new Error("BmadAdapter has no bound context. Call configureBmadAdapter({ targetRepo, storiesRoot }) " +
            "before invoking list/read/resolve. (Story 3.3)");
    }
    return currentContext;
}
function absStoriesRoot(ctx) {
    return path.isAbsolute(ctx.storiesRoot)
        ? ctx.storiesRoot
        : path.join(ctx.targetRepo, ctx.storiesRoot);
}
// Story 3.8: widened to accept letter-suffixed story IDs (e.g. 4-8b-...).
// The optional [a-z] captures the single-letter suffix shape observed in this
// repo (4-8b, 5-4b). Wider patterns risk colliding with the slug class.
const BMAD_FILENAME_RE = /^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/;
async function readStoriesDir(absRoot) {
    // Returns absolute paths of BMad-shaped story files. Walks one level
    // of subdirectory deep (Task 3.2 — defensive against future
    // epic-grouped subdirs). Files not matching the BMad filename
    // pattern are silently skipped.
    let entries;
    try {
        entries = await fs.readdir(absRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        if (e.isFile() && BMAD_FILENAME_RE.test(e.name)) {
            out.push(path.join(absRoot, e.name));
            continue;
        }
        if (e.isDirectory()) {
            let sub;
            try {
                sub = await fs.readdir(path.join(absRoot, e.name), { withFileTypes: true });
            }
            catch {
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
function readStoriesDirSync(absRoot) {
    let entries;
    try {
        entries = readdirSync(absRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        if (e.isFile() && BMAD_FILENAME_RE.test(e.name)) {
            out.push(path.join(absRoot, e.name));
            continue;
        }
        if (e.isDirectory()) {
            let sub;
            try {
                sub = readdirSync(path.join(absRoot, e.name), { withFileTypes: true });
            }
            catch {
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
function parseRef(ref) {
    const m = /^bmad:(\d+)\.(\d+[a-z]?)$/.exec(ref);
    if (!m)
        return null;
    return { epic: parseInt(m[1], 10), story: m[2] };
}
// Story 3.8: story field is now a string to preserve letter suffixes.
function epicStoryFromFilename(file) {
    const m = /^(\d+)-(\d+)([a-z]?)-/.exec(path.basename(file));
    if (!m)
        return null;
    return { epic: parseInt(m[1], 10), story: m[2] + m[3] };
}
function buildRefIndex(files, storiesRootAbs) {
    const byRef = new Map();
    for (const f of files) {
        const es = epicStoryFromFilename(f);
        if (!es)
            continue;
        const ref = `bmad:${es.epic}.${es.story}`;
        const existing = byRef.get(ref);
        if (existing)
            existing.push(f);
        else
            byRef.set(ref, [f]);
    }
    const result = new Map();
    for (const [ref, paths] of byRef) {
        if (paths.length === 1) {
            result.set(ref, paths[0]);
        }
        else {
            throw new AmbiguousBmadRefError({ ref, matches: paths.map((p) => path.relative(storiesRootAbs, p)) });
        }
    }
    return result;
}
function ensureRefIndex(ctx) {
    if (refIndex && refIndexFor === ctx)
        return refIndex;
    const absRoot = absStoriesRoot(ctx);
    const files = readStoriesDirSync(absRoot);
    refIndex = buildRefIndex(files, absRoot);
    refIndexFor = ctx;
    return refIndex;
}
export const BmadAdapter = {
    name: "bmad",
    async detect(targetRepo) {
        // Story 3.8 AC5: two-step contract.
        //   1. If currentContext is bound to this targetRepo, use the configured
        //      storiesRoot. This lets validateActiveAdapter (called after
        //      configureBmadAdapter runs inside resolveWorkspace) see the
        //      operator-configured root, suppressing the misleading (mismatched)
        //      label.
        //   2. Otherwise fall back to DEFAULT_STORIES_ROOT for first-run auto-detect.
        const resolvedTarget = path.resolve(targetRepo);
        let absRoot;
        if (currentContext && path.resolve(currentContext.targetRepo) === resolvedTarget) {
            absRoot = absStoriesRoot(currentContext);
        }
        else {
            absRoot = path.join(targetRepo, DEFAULT_STORIES_ROOT);
        }
        try {
            const s = statSync(absRoot);
            if (!s.isDirectory())
                return false;
        }
        catch {
            return false;
        }
        let entries;
        try {
            entries = await fs.readdir(absRoot);
        }
        catch {
            return false;
        }
        for (const name of entries) {
            if (BMAD_FILENAME_RE.test(name))
                return true;
        }
        return false;
    },
    async listSourceStories() {
        const ctx = requireContext();
        const absRoot = absStoriesRoot(ctx);
        const files = await readStoriesDir(absRoot);
        // Build (and validate uniqueness of) the ref index off the same
        // file set. This keeps the cold-cache and warm-cache callers in
        // sync.
        refIndex = buildRefIndex(files, absRoot);
        refIndexFor = ctx;
        // Parse, drop optionals, sort numerically.
        const parsed = [];
        for (const file of files) {
            const contents = await fs.readFile(file, "utf8");
            const story = parseBmadStory(file, contents);
            const status = story.raw_frontmatter["status"];
            if (status === "optional")
                continue;
            parsed.push(story);
        }
        // Story 3.8: sort by (epic, storyNumericPart, storySuffix) so that e.g.
        // "4.8" sorts before "4.8b" (numeric part equal, no-suffix < suffix).
        parsed.sort((a, b) => {
            const ea = a.raw_frontmatter["id"];
            const eb = b.raw_frontmatter["id"];
            // id shape: "<epic>.<story>" where story may be "8" or "8b".
            const [aeStr, asStr] = ea.split(".");
            const [beStr, bsStr] = eb.split(".");
            const ae = parseInt(aeStr, 10);
            const be = parseInt(beStr, 10);
            if (ae !== be)
                return ae - be;
            // Extract numeric prefix and letter suffix from story part.
            const [, asNum, asSuf] = /^(\d+)([a-z]?)$/.exec(asStr) ?? ["", "0", ""];
            const [, bsNum, bsSuf] = /^(\d+)([a-z]?)$/.exec(bsStr) ?? ["", "0", ""];
            const numDiff = parseInt(asNum, 10) - parseInt(bsNum, 10);
            if (numDiff !== 0)
                return numDiff;
            // Same numeric part — no suffix comes before letter suffix.
            return (asSuf ?? "").localeCompare(bsSuf ?? "");
        });
        return parsed;
    },
    async readSourceStory(ref) {
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
    resolveSourcePath(ref) {
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
    defaultConfig() {
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
    validateAgainstDiscipline(story) {
        return validateStoryAgainstDiscipline(story);
    },
};
// Re-exports — the test suite and downstream consumers import these via
// the adapter's index module for a single entry point per adapter
// (Task 9.2).
export { parseBmadStory, mapBmadStatusToExecution, reconcileStatus, MalformedBmadStoryError, UnknownBmadRefError, AmbiguousBmadRefError, };
