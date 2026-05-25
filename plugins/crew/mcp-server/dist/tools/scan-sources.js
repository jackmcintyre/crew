import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { listSourceStoriesResilient } from "../adapters/bmad/index.js";
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
    // Omit discipline-violation refs from the skipped line when they are already
    // named in the blocked line — they're the same refs and printing both causes
    // confusion about whether they're separate problems.
    const blockedRefSet = new Set(result.blockedRefs ?? []);
    const skippedForDisplay = result.skippedRefs.filter((s) => !(s.reason === "discipline-violation" && blockedRefSet.has(s.ref)));
    if (skippedForDisplay.length > 0) {
        lines.push(`skipped:   ${skippedForDisplay.length} ref(s) — ` +
            skippedForDisplay
                .map((s) => `${s.ref} (${s.reason}${s.detail ? ": " + s.detail : ""})`)
                .join(", "));
    }
    else {
        lines.push(`skipped:   0 ref(s)`);
    }
    // Story 3.5 Task 6.3: blocked refs line (operator-facing surface).
    // A blocked ref here is the operator's cue to fix the source story
    // (add an integration AC, declare missing depends_on, etc.) and re-run /crew:scan.
    if ((result.blockedRefs ?? []).length > 0) {
        lines.push(`blocked:   ${result.blockedRefs.length} ref(s) — ` +
            result.blockedRefs.join(", ") +
            ` (planning-discipline violation — fix the source story and re-run /crew:scan)`);
    }
    else {
        lines.push(`blocked:   0 ref(s)`);
    }
    // Story 3.9: surface fallback extraction and unparseable refs.
    if ((result.extractedByLlmRefs ?? []).length > 0) {
        lines.push(`extracted-by-llm: ${result.extractedByLlmRefs.length} ref(s) — ` +
            result.extractedByLlmRefs.join(", ") +
            ` (regex parser failed; LLM fallback recovered the story)`);
    }
    if ((result.unparseableRefs ?? []).length > 0) {
        lines.push(`unparseable: ${result.unparseableRefs.length} ref(s) — ` +
            result.unparseableRefs.join(", ") +
            ` (both regex parser AND LLM fallback failed — fix the source story and re-run /crew:scan)`);
    }
    // Story 3.8 AC3: structured warnings (e.g. unknown Status values).
    if ((result.warnings ?? []).length > 0) {
        lines.push(``);
        lines.push(`warnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
            lines.push(`  [warn] ${w.message}`);
        }
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
    // Step 2: List source stories from the active adapter. Story 3.9
    // introduces a richer BMad path that surfaces LLM-fallback metadata
    // and per-file parse failures; other adapters keep the original
    // narrow contract.
    let sourceStories;
    let resilient = null;
    if (activeAdapterName === "bmad") {
        resilient = await listSourceStoriesResilient();
        sourceStories = resilient.stories;
        if (resilient.extractedByLlm.length > 10) {
            console.warn(`[scanSources] LLM fallback fired ${resilient.extractedByLlm.length} times in one scan. ` +
                `Each fallback costs one Claude call; consider tidying the source stories so the regex parser handles them.`);
        }
    }
    else {
        sourceStories = await activeAdapter.listSourceStories();
    }
    const result = {
        targetRepoRoot,
        adapterName: activeAdapterName,
        createdRefs: [],
        updatedRefs: [],
        unchangedRefs: [],
        skippedRefs: [],
        blockedRefs: [],
        warnings: [],
        extractedByLlmRefs: resilient?.extractedByLlm ?? [],
        unparseableRefs: [],
    };
    // Story 3.9 — bookkeeping warning for high fallback volume.
    if (resilient && resilient.extractedByLlm.length > 10) {
        result.warnings.push({
            path: targetRepoRoot,
            message: `LLM fallback fired ${resilient.extractedByLlm.length} times in this scan. ` +
                `Each fallback costs one Claude call (Haiku 4.5, Sonnet 4.6 on retry). ` +
                `Consider tidying the source stories so the regex parser handles them.`,
        });
    }
    const stateRoot = path.join(targetRepoRoot, ".crew", "state");
    // Startup guard: resolve any refs that appear in both to-do/ and blocked/
    // simultaneously. This can occur if a previous blocked→to-do promotion wrote
    // the to-do manifest successfully but the subsequent unlink of the blocked
    // manifest failed (non-atomic write sequence). When both exist, to-do/ wins —
    // delete the stale blocked/ manifest and log a warning so the operator is
    // aware of the recovery. This guard prevents the inconsistency from persisting
    // across subsequent scans.
    {
        const toDoDir = path.join(stateRoot, "to-do");
        const blockedDir = path.join(stateRoot, "blocked");
        let toDoFiles = [];
        let blockedFiles = [];
        try {
            toDoFiles = await fs.readdir(toDoDir);
        }
        catch {
            // Directory may not exist yet on a fresh repo — not an error.
        }
        try {
            blockedFiles = await fs.readdir(blockedDir);
        }
        catch {
            // Directory may not exist yet on a fresh repo — not an error.
        }
        const toDoRefs = new Set(toDoFiles.filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)));
        for (const blockedFile of blockedFiles) {
            if (!blockedFile.endsWith(".yaml"))
                continue;
            const ref = blockedFile.slice(0, -5);
            if (toDoRefs.has(ref)) {
                console.warn(`[scanSources] Ref ${ref} exists in both to-do/ and blocked/ — recovering by removing stale blocked/ manifest (to-do/ wins).`);
                await fs.unlink(path.join(blockedDir, blockedFile));
            }
        }
    }
    // Story 3.9: route unparseable BMad files (both regex parser AND LLM
    // fallback failed) to blocked/<ref>.yaml with blocked_by: "unparseable".
    // The scan continues — these refs do NOT halt the run.
    if (resilient) {
        for (const entry of resilient.unparseable) {
            const ref = entry.refGuess ?? `bmad:unparseable-${path.basename(entry.path)}`;
            // Compose a minimal blocked manifest. We do not have a parsed
            // SourceStory, so we synthesise the required schema fields directly.
            const sourceHash = await (async () => {
                try {
                    const buf = await fs.readFile(entry.path);
                    const { createHash } = await import("node:crypto");
                    return createHash("sha256").update(buf).digest("hex");
                }
                catch {
                    // 64-char zero hash satisfies the schema's hex-format requirement
                    // when the file is unreadable. Drift detection compares this
                    // against a freshly-computed hash on re-scan; a zero hash will
                    // always look "changed" which is the right behaviour.
                    return "0".repeat(64);
                }
            })();
            const blockedManifestRaw = stripUndefined({
                ref,
                status: "blocked",
                adapter: activeAdapterName,
                source_path: repoRelativePath(entry.path, targetRepoRoot),
                source_hash: sourceHash,
                depends_on: [],
                // Schema requires at least one AC. We synthesise a placeholder so
                // the manifest validates; the real ACs cannot be recovered from
                // an unparseable file by definition.
                acceptance_criteria: [
                    {
                        text: "(synthesised) Source file is unparseable — operator must edit the spec and re-run /crew:scan.",
                        kind: "unit",
                    },
                ],
                title: `Unparseable BMad story at ${path.basename(entry.path)}`,
                narrative: "The deterministic regex parser AND the LLM fallback both failed to extract a story shape from this file. " +
                    "Edit the source spec and re-run /crew:scan to recover.",
                withdrawn: false,
                blocked_by: "unparseable",
                // Surface the underlying parser/LLM errors as discipline_violations so
                // the operator-facing manifest carries the detail without widening the
                // schema. `code` is the human-readable bucket; `detail` carries the
                // verbatim error message.
                discipline_violations: [
                    {
                        code: "unparseable-regex",
                        field: "source_path",
                        detail: entry.regexError,
                    },
                    ...(entry.llmError
                        ? [
                            {
                                code: "unparseable-llm",
                                field: "source_path",
                                detail: entry.llmError,
                            },
                        ]
                        : []),
                ],
            });
            try {
                const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
                const absBlockedPath = path.join(stateRoot, "blocked", `${ref}.yaml`);
                const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
                await writeManagedFile({
                    absPath: absBlockedPath,
                    contents: yamlText,
                    targetRepoRoot,
                    mcpToolContext: { toolName: "scanSources", role: "operator" },
                });
                result.blockedRefs.push(ref);
                result.unparseableRefs.push(ref);
                result.warnings.push({
                    path: entry.path,
                    message: `BMad story at \`${entry.path}\` is unparseable: regex parser failed (${entry.regexError})` +
                        (entry.llmError ? ` and the LLM fallback also failed (${entry.llmError})` : "") +
                        `. The story has been blocked with reason \`unparseable\` so the scan can continue. ` +
                        `Edit the spec and re-run /crew:scan.`,
                });
                console.warn(`[scanSources] unparseable BMad story at ${entry.path} — routed to blocked/`);
            }
            catch (composeErr) {
                // Defensive: if schema composition itself fails for the synthetic
                // manifest, log a warning and skip — never crash the scan.
                console.warn(`[scanSources] failed to compose blocked manifest for unparseable story at ${entry.path}: ${composeErr instanceof Error ? composeErr.message : String(composeErr)}`);
                result.warnings.push({
                    path: entry.path,
                    message: `BMad story at \`${entry.path}\` is unparseable AND a blocked manifest could not be written. Manual cleanup needed.`,
                });
            }
        }
    }
    // Step 3 + 4 + 5: For each story, check presence map, validate discipline,
    // then branch on create/blocked-create/update/unchanged/skip.
    //
    // IMPORTANT: The presence check happens FIRST (before discipline). This
    // preserves the "scan does not touch claimed work" invariant for ALL state
    // dirs including `blocked/`. A story already in blocked/ (from a prior scan)
    // is treated as claimed and skipped with reason "not-in-to-do", exactly like
    // stories in in-progress/ or done/. Only if no manifest exists anywhere does
    // the discipline check run and potentially write to blocked/.
    for (const story of sourceStories) {
        // Step 3: Check which state dir this ref's manifest lives in, if any.
        let currentState = null;
        for (const stateName of STATE_NAMES) {
            const absPath = path.join(stateRoot, stateName, `${story.ref}.yaml`);
            const s = await statOrNull(absPath);
            if (s !== null) {
                currentState = stateName;
                break;
            }
        }
        // Step 4: Handle manifests that exist outside to-do/.
        //
        // - in-progress/ or done/: the dev loop owns it — skip unconditionally.
        // - blocked/: re-run the discipline validator. If the source story has been
        //   fixed (validator now passes), promote to to-do/ and delete the blocked
        //   manifest. If it still fails, rewrite the blocked manifest to record the
        //   latest source_hash and updated violations. This is the remediation flow
        //   described in README-install.md § Planning-discipline enforcement.
        if (currentState === "in-progress" || currentState === "done") {
            result.skippedRefs.push({
                ref: story.ref,
                reason: "not-in-to-do",
            });
            continue;
        }
        if (currentState === "blocked") {
            // Read the existing blocked manifest to check whether the source has changed.
            const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
            const rawBlocked = await fs.readFile(absBlockedPath, "utf8");
            const parsedBlocked = yamlParse(rawBlocked);
            const existingBlockedHash = parsedBlocked["source_hash"];
            if (existingBlockedHash === story.source_hash) {
                // Source unchanged — no need to re-evaluate. Skip quietly.
                result.skippedRefs.push({ ref: story.ref, reason: "not-in-to-do" });
                continue;
            }
            // Source hash changed (operator edited the story) — re-run discipline.
            const disciplineResult = activeAdapter.validateAgainstDiscipline(story);
            if (!("kind" in disciplineResult) || disciplineResult.kind !== "discipline-violation") {
                // Story now passes discipline — but check for unknown Status before promoting.
                // A story edited to fix discipline could simultaneously have introduced (or
                // retained) an unknown Status value; in that case we must block it with
                // status-vocabulary-unknown rather than silently promoting to to-do/.
                const statusUnknownOnPromotion = story.raw_frontmatter["status_unknown"];
                if (statusUnknownOnPromotion !== undefined) {
                    const blockedManifestRaw = stripUndefined({
                        ref: story.ref,
                        status: "blocked",
                        adapter: activeAdapterName,
                        source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                        source_hash: story.source_hash,
                        depends_on: story.depends_on,
                        acceptance_criteria: story.acceptance_criteria,
                        title: story.title,
                        narrative: story.narrative,
                        implementation_notes: story.implementation_notes,
                        withdrawn: false,
                        blocked_by: "status-vocabulary-unknown",
                    });
                    const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
                    const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
                    await writeManagedFile({
                        absPath: absBlockedPath,
                        contents: yamlText,
                        targetRepoRoot,
                        mcpToolContext: { toolName: "scanSources", role: "operator" },
                    });
                    result.blockedRefs.push(story.ref);
                    result.skippedRefs.push({
                        ref: story.ref,
                        reason: "discipline-violation",
                        detail: `status-vocabulary-unknown: "${statusUnknownOnPromotion.raw}"`,
                    });
                    const warnMessage = `Story \`${story.ref}\` at \`${story.raw_path}\` has a Status value (\`${statusUnknownOnPromotion.raw}\`) ` +
                        `that is not one of the known BMad statuses (backlog, ready-for-dev, in-progress, done, optional, contexted). ` +
                        `The story has been blocked with reason \`status-vocabulary-unknown\` so the scan can continue. ` +
                        `Edit the spec's Status line or remove it (Status defaults to \`backlog\`) and re-run /crew:scan.`;
                    result.warnings.push({ path: story.raw_path, message: warnMessage });
                    console.warn(`[scanSources] ${warnMessage}`);
                    continue;
                }
                // Story passes discipline and has a known Status — promote from blocked/ to to-do/.
                // NOTE: This sequence is non-atomic: the to-do/ manifest is written
                // first, then the blocked/ manifest is deleted. If the unlink fails
                // (e.g. a mid-flight crash or permission error), both manifests will
                // exist simultaneously. The startup guard above detects and recovers
                // this state on the next scan (to-do/ wins, blocked/ is deleted).
                const absToDoPathNew = path.join(stateRoot, "to-do", `${story.ref}.yaml`);
                const manifest = composeManifest(story, activeAdapterName, targetRepoRoot);
                const yamlText = yamlStringify(manifest, { lineWidth: 0 });
                await writeManagedFile({
                    absPath: absToDoPathNew,
                    contents: yamlText,
                    targetRepoRoot,
                    mcpToolContext: { toolName: "scanSources", role: "operator" },
                });
                await fs.unlink(absBlockedPath);
                result.createdRefs.push(story.ref);
            }
            else {
                // Still failing — rewrite the blocked manifest with updated hash and violations.
                const blockedManifestRaw = stripUndefined({
                    ref: story.ref,
                    status: "blocked",
                    adapter: activeAdapterName,
                    source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                    source_hash: story.source_hash,
                    depends_on: story.depends_on,
                    acceptance_criteria: story.acceptance_criteria,
                    title: story.title,
                    narrative: story.narrative,
                    implementation_notes: story.implementation_notes,
                    withdrawn: false,
                    blocked_by: "planning-discipline",
                    discipline_violations: disciplineResult.violations.map((v) => ({
                        code: v.code,
                        field: v.field,
                        detail: v.detail,
                    })),
                });
                const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
                const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
                await writeManagedFile({
                    absPath: absBlockedPath,
                    contents: yamlText,
                    targetRepoRoot,
                    mcpToolContext: { toolName: "scanSources", role: "operator" },
                });
                const firstViolation = disciplineResult.violations[0];
                result.skippedRefs.push({
                    ref: story.ref,
                    reason: "discipline-violation",
                    detail: firstViolation?.detail,
                });
                result.blockedRefs.push(story.ref);
            }
            continue;
        }
        // Step 4b: Story 3.8 AC3 — status-vocabulary-unknown gate (first scan only).
        // If the parser flagged an unknown Status value and no manifest exists yet
        // (currentState === null), route the story to blocked/ immediately (before
        // discipline). Re-scan paths (blocked→to-do promotion and to-do hash-changed
        // update) each perform their own status_unknown check earlier in the loop so
        // they are already handled via `continue` before reaching this point.
        // The scan continues — no throw.
        const statusUnknown = story.raw_frontmatter["status_unknown"];
        if (statusUnknown !== undefined && currentState === null) {
            const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
            const blockedManifestRaw = stripUndefined({
                ref: story.ref,
                status: "blocked",
                adapter: activeAdapterName,
                source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                source_hash: story.source_hash,
                depends_on: story.depends_on,
                acceptance_criteria: story.acceptance_criteria,
                title: story.title,
                narrative: story.narrative,
                implementation_notes: story.implementation_notes,
                withdrawn: false,
                blocked_by: "status-vocabulary-unknown",
            });
            const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
            const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
            await writeManagedFile({
                absPath: absBlockedPath,
                contents: yamlText,
                targetRepoRoot,
                mcpToolContext: { toolName: "scanSources", role: "operator" },
            });
            result.blockedRefs.push(story.ref);
            result.skippedRefs.push({
                ref: story.ref,
                reason: "discipline-violation",
                detail: `status-vocabulary-unknown: "${statusUnknown.raw}"`,
            });
            const warnMessage = `Story \`${story.ref}\` at \`${story.raw_path}\` has a Status value (\`${statusUnknown.raw}\`) ` +
                `that is not one of the known BMad statuses (backlog, ready-for-dev, in-progress, done, optional, contexted). ` +
                `The story has been blocked with reason \`status-vocabulary-unknown\` so the scan can continue. ` +
                `Edit the spec's Status line or remove it (Status defaults to \`backlog\`) and re-run /crew:scan.`;
            result.warnings.push({ path: story.raw_path, message: warnMessage });
            console.warn(`[scanSources] ${warnMessage}`);
            continue;
        }
        // Step 5: validateAgainstDiscipline (Story 3.5 — real enforcement).
        // Only runs when no manifest exists anywhere (currentState === null) or
        // when the manifest is already in to-do/ (currentState === "to-do").
        // For the to-do case, discipline is a no-op (the story already passed
        // discipline at first scan). For the null case, this is the gate.
        if (currentState === null) {
            const disciplineResult = activeAdapter.validateAgainstDiscipline(story);
            if ("kind" in disciplineResult && disciplineResult.kind === "discipline-violation") {
                const firstViolation = disciplineResult.violations[0];
                result.skippedRefs.push({
                    ref: story.ref,
                    reason: "discipline-violation",
                    detail: firstViolation?.detail,
                });
                // Write a blocked manifest into blocked/ (Task 6.1).
                const blockedManifestRaw = stripUndefined({
                    ref: story.ref,
                    status: "blocked",
                    adapter: activeAdapterName,
                    source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                    source_hash: story.source_hash,
                    depends_on: story.depends_on,
                    acceptance_criteria: story.acceptance_criteria,
                    title: story.title,
                    narrative: story.narrative,
                    implementation_notes: story.implementation_notes,
                    withdrawn: false,
                    blocked_by: "planning-discipline",
                    discipline_violations: disciplineResult.violations.map((v) => ({
                        code: v.code,
                        field: v.field,
                        detail: v.detail,
                    })),
                });
                const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
                const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
                const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
                await writeManagedFile({
                    absPath: absBlockedPath,
                    contents: yamlText,
                    targetRepoRoot,
                    mcpToolContext: { toolName: "scanSources", role: "operator" },
                });
                result.blockedRefs.push(story.ref);
                continue;
            }
        }
        // Step 6: Branch on to-do presence.
        const absToDoPath = path.join(stateRoot, "to-do", `${story.ref}.yaml`);
        if (currentState === null) {
            // CREATE path (AC1): no manifest exists anywhere and discipline passed.
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
                // Hash changed — check for unknown Status before updating.
                // If the operator edited the story and introduced an unknown Status value,
                // move the manifest to blocked/ rather than silently writing a to-do/ update.
                const statusUnknownOnUpdate = story.raw_frontmatter["status_unknown"];
                if (statusUnknownOnUpdate !== undefined) {
                    const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
                    const blockedManifestRaw = stripUndefined({
                        ref: story.ref,
                        status: "blocked",
                        adapter: activeAdapterName,
                        source_path: repoRelativePath(story.raw_path, targetRepoRoot),
                        source_hash: story.source_hash,
                        depends_on: story.depends_on,
                        acceptance_criteria: story.acceptance_criteria,
                        title: story.title,
                        narrative: story.narrative,
                        implementation_notes: story.implementation_notes,
                        withdrawn: false,
                        blocked_by: "status-vocabulary-unknown",
                    });
                    const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
                    const blockedYaml = yamlStringify(blockedManifest, { lineWidth: 0 });
                    await writeManagedFile({
                        absPath: absBlockedPath,
                        contents: blockedYaml,
                        targetRepoRoot,
                        mcpToolContext: { toolName: "scanSources", role: "operator" },
                    });
                    // Remove the stale to-do/ manifest so the startup guard doesn't have to.
                    await fs.unlink(absToDoPath);
                    result.blockedRefs.push(story.ref);
                    result.skippedRefs.push({
                        ref: story.ref,
                        reason: "discipline-violation",
                        detail: `status-vocabulary-unknown: "${statusUnknownOnUpdate.raw}"`,
                    });
                    const warnMessage = `Story \`${story.ref}\` at \`${story.raw_path}\` has a Status value (\`${statusUnknownOnUpdate.raw}\`) ` +
                        `that is not one of the known BMad statuses (backlog, ready-for-dev, in-progress, done, optional, contexted). ` +
                        `The story has been blocked with reason \`status-vocabulary-unknown\` so the scan can continue. ` +
                        `Edit the spec's Status line or remove it (Status defaults to \`backlog\`) and re-run /crew:scan.`;
                    result.warnings.push({ path: story.raw_path, message: warnMessage });
                    console.warn(`[scanSources] ${warnMessage}`);
                    continue;
                }
                // Hash changed and Status is known → rewrite with new hash and source_path;
                // preserve all other fields. Operator hand-edits to narrative,
                // acceptance_criteria, withdrawn etc. are preserved per Story 3.7's hand-edit
                // allowance.
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
        // Note: the else branch for currentState not null and not "to-do" is handled
        // in Step 4 above (before discipline check) — those refs are already skipped.
    }
    return result;
}
