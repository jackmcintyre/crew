import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { MalformedExecutionManifestError } from "../errors.js";
import { writeManagedFile } from "../lib/managed-fs.js";
import { ExecutionManifestSchema, parseExecutionManifest, } from "../schemas/execution-manifest.js";
import { STATE_NAMES } from "../state/manifest-state-machine.js";
import { resolveWorkspace } from "../state/workspace-resolver.js";
/**
 * Render a `ScanResult` as a human-readable text summary.
 * The tool returns this string verbatim; the `/crew:scan` skill
 * prints it without paraphrase or omission.
 */
export function renderScanResult(result) {
    const lines = [
        `scan-sources completed for ${result.targetRepoRoot}`,
        `adapter: ${result.adapterName}`,
        ``,
        `created:   ${result.createdRefs.length} ref(s)${result.createdRefs.length > 0 ? " — " + result.createdRefs.join(", ") : ""}`,
        `updated:   ${result.updatedRefs.length} ref(s)${result.updatedRefs.length > 0 ? " — " + result.updatedRefs.join(", ") : ""}`,
        `unchanged: ${result.unchangedRefs.length} ref(s)${result.unchangedRefs.length > 0 ? " — " + result.unchangedRefs.join(", ") : ""}`,
    ];
    if (result.skippedRefs.length > 0) {
        lines.push(`skipped:   ${result.skippedRefs.length} ref(s) — ` +
            result.skippedRefs
                .map((s) => `${s.ref} (${s.reason}${s.detail ? ": " + s.detail : ""})`)
                .join(", "));
    }
    else {
        lines.push(`skipped:   0 ref(s)`);
    }
    return lines.join("\n");
}
/**
 * Check whether a path exists on disk; returns null if not found.
 */
async function statOrNull(absPath) {
    try {
        return await fs.stat(absPath);
    }
    catch {
        return null;
    }
}
/**
 * Compute the repo-relative path from `rawPath` if it falls strictly inside
 * `targetRepoRoot`; otherwise return the absolute path as-is.
 * Avoids leaking absolute paths into committed manifests.
 */
function repoRelativePath(rawPath, targetRepoRoot) {
    const rel = path.relative(targetRepoRoot, rawPath);
    // If `rel` starts with ".." or is absolute, the path escapes the repo root.
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return rawPath;
    }
    return rel;
}
/**
 * Strip keys with `undefined` values from a plain object before YAML
 * stringification. Prevents `implementation_notes: ~` appearing in on-disk
 * YAML when the field is absent in the source story.
 */
function stripUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
/**
 * Compose a new `ExecutionManifest` object from a `SourceStory`.
 * Validates through the schema defensively — catches coding mistakes in
 * the composer before writing to disk.
 */
function composeManifest(story, adapterName, targetRepoRoot) {
    const raw = stripUndefined({
        ref: story.ref,
        status: "to-do",
        adapter: adapterName,
        source_path: repoRelativePath(story.raw_path, targetRepoRoot),
        source_hash: story.source_hash,
        depends_on: story.depends_on,
        acceptance_criteria: story.acceptance_criteria,
        title: story.title,
        narrative: story.narrative,
        implementation_notes: story.implementation_notes,
        withdrawn: false,
    });
    // Defensive parse — throws if the composer produced an invalid shape.
    return ExecutionManifestSchema.parse(raw);
}
/**
 * Project the active adapter's source stories into per-story execution
 * manifests under `<targetRepoRoot>/.crew/state/to-do/<ref>.yaml`.
 *
 * **Idempotency (AC2 / NFR10):** On a re-scan with no source changes, this
 * function writes nothing. "Not rewritten" is load-bearing: the dev loop's
 * polling semantics detect work by mtime changes. Re-writing byte-identical
 * content would produce spurious mtime updates and corrupt the polling.
 *
 * **Hash-refresh (AC3):** If a source story's hash changed AND its manifest
 * is still in `to-do/`, the manifest is rewritten with the new hash and
 * updated `source_path`. All other fields (including any operator hand-edits
 * to `narrative`, `acceptance_criteria`, or `withdrawn`) are preserved.
 *
 * **Claim isolation (AC3 negative):** Manifests in `in-progress/`, `blocked/`,
 * or `done/` are NEVER touched. They are owned by the dev loop / orchestrator.
 * `scan-sources` only ever writes into `to-do/`.
 *
 * **Concurrency:** v1 assumes at most one `scan-sources` invocation per
 * target repo at a time. The MCP server is single-process; concurrent
 * invocations are out of scope. Do NOT add a lock here — see Story 4.x's
 * claim flow for the locking design.
 *
 * **`validateAgainstDiscipline` seam:** The call at step 3 is a documented
 * seam for Story 3.5. In v1, every adapter's implementation is pass-through
 * (returns the input story unchanged). Story 3.5 will make some adapters
 * return a `DisciplineViolation` — at that point the `skippedRefs` path
 * with `reason: "discipline-violation"` will light up without any change to
 * this file.
 */
export async function scanSources(opts) {
    // Step 1: Resolve the workspace. Throws on misconfiguration.
    const workspace = await resolveWorkspace({ targetRepoRoot: opts.targetRepoRoot });
    const { activeAdapter, activeAdapterName, adapterConfig, targetRepoRoot } = workspace;
    // Step 2: List source stories from the active adapter.
    const sourceStories = await activeAdapter.listSourceStories();
    const result = {
        targetRepoRoot,
        adapterName: activeAdapterName,
        createdRefs: [],
        updatedRefs: [],
        unchangedRefs: [],
        skippedRefs: [],
    };
    const stateRoot = path.join(targetRepoRoot, ".crew", "state");
    // Step 3 + 4 + 5: For each story, validate discipline, check presence map,
    // then branch on create/update/unchanged/skip.
    for (const story of sourceStories) {
        // Step 3: validateAgainstDiscipline (Story 3.5 seam — v1 is pass-through).
        const disciplineResult = activeAdapter.validateAgainstDiscipline(story);
        if ("kind" in disciplineResult && disciplineResult.kind === "discipline-violation") {
            const firstViolation = disciplineResult.violations[0];
            result.skippedRefs.push({
                ref: story.ref,
                reason: "discipline-violation",
                detail: firstViolation?.detail,
            });
            continue;
        }
        // Step 4: Check which state dir this ref's manifest lives in, if any.
        let currentState = null;
        for (const stateName of STATE_NAMES) {
            const absPath = path.join(stateRoot, stateName, `${story.ref}.yaml`);
            const s = await statOrNull(absPath);
            if (s !== null) {
                currentState = stateName;
                break;
            }
        }
        // Step 5: Branch on presence.
        const absToDoPath = path.join(stateRoot, "to-do", `${story.ref}.yaml`);
        if (currentState === null) {
            // CREATE path (AC1): no manifest exists anywhere.
            const manifest = composeManifest(story, activeAdapterName, targetRepoRoot);
            const yamlText = yamlStringify(manifest, { lineWidth: 0 });
            await writeManagedFile({
                absPath: absToDoPath,
                contents: yamlText,
                targetRepoRoot,
                mcpToolContext: { toolName: "scanSources", role: "operator" },
            });
            result.createdRefs.push(story.ref);
        }
        else if (currentState === "to-do") {
            // UPDATE or UNCHANGED path (AC2/AC3): manifest is in to-do/.
            const rawText = await fs.readFile(absToDoPath, "utf8");
            let existingManifest;
            try {
                const parsed = yamlParse(rawText);
                existingManifest = parseExecutionManifest(parsed, { absPath: absToDoPath });
            }
            catch (err) {
                // Propagate MalformedExecutionManifestError (AC5) — let the tool handler return isError.
                if (err instanceof MalformedExecutionManifestError) {
                    throw err;
                }
                throw err;
            }
            if (existingManifest.source_hash !== story.source_hash) {
                // Hash changed → rewrite with new hash and source_path; preserve all other fields.
                // Operator hand-edits to narrative, acceptance_criteria, withdrawn etc. are preserved
                // per Story 3.7's hand-edit allowance.
                const updatedManifest = {
                    ...existingManifest,
                    source_hash: story.source_hash,
                    source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                };
                const yamlText = yamlStringify(stripUndefined(updatedManifest), {
                    lineWidth: 0,
                });
                await writeManagedFile({
                    absPath: absToDoPath,
                    contents: yamlText,
                    targetRepoRoot,
                    mcpToolContext: { toolName: "scanSources", role: "operator" },
                });
                result.updatedRefs.push(story.ref);
            }
            else {
                // Hash matches → no-op (AC2 idempotency).
                result.unchangedRefs.push(story.ref);
            }
        }
        else {
            // SKIP path (AC3 negative): manifest is in in-progress, blocked, or done.
            // The dev loop owns these; scan-sources must not touch them.
            result.skippedRefs.push({
                ref: story.ref,
                reason: "not-in-to-do",
            });
        }
    }
    return result;
}
