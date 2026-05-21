/**
 * `claimStory` MCP tool — Story 4.1.
 *
 * Atomically claims a story for dev work (FR17):
 *   1. Guards against in-progress hand-edits via `detectInProgressHandEdit` (FR14a).
 *   2. Loads the `to-do/` manifest.
 *   3. Checks that all `depends_on` refs are present in `done/` (FR18).
 *   4. Moves the manifest from `to-do/` to `in-progress/` via `moveBetweenStates`
 *      (atomic rename — the single coordination surface).
 *   5. Rewrites the manifest with `status: "in-progress"` and `claimed_by: sessionUlid`.
 *
 * **Sequencing rationale:** The move-then-rewrite sequence is chosen over
 * rewrite-then-move because `moveBetweenStates` is the canonical atomicity
 * primitive — using it first means another concurrent claim sees the `to-do/`
 * ENOENT immediately (rename is atomic), and the rewrite is an in-place update
 * on the winner's manifest. The narrow window between rename and rewrite is
 * observable as "an `in-progress/<ref>.yaml` whose `status` is still `to-do`
 * and `claimed_by` is absent" — this is acceptable because (a) no other tool
 * inspects `status` on the in-progress layer (the directory is ground truth),
 * and (b) the hand-edit guard's baseline check sees the rewritten manifest,
 * not the transient one.
 *
 * **`isClaimable` is NOT invoked here.** Story 4.2's `/start` skill is the
 * layer that picks the next ready story (using `isClaimable` to filter the
 * candidate queue). `claimStory` is a primitive: given a ref, claim it if deps
 * are ready and the manifest is not hand-edited. If `/start` hands `claimStory`
 * a withdrawn ref, the parse step surfaces `withdrawn: true` and the queue-
 * selection logic is the layer that prevents that.
 *
 * **No `--force` bypass.** The hand-edit refusal is unconditional (Story 3.7).
 *
 * FR17 — atomic claim, FR18 — dependency check, FR14a — hand-edit guard.
 * See also: `moveBetweenStates` (manifest-state-machine.ts),
 *           `detectInProgressHandEdit` (manifest-state-machine.ts),
 *           `deriveSourceBaseline` (state/derive-source-baseline.ts).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ManifestNotFoundError } from "../errors.js";
import { writeManagedFile } from "../lib/managed-fs.js";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";
import { moveBetweenStates, detectInProgressHandEdit, } from "../state/manifest-state-machine.js";
import { deriveSourceBaseline } from "../state/derive-source-baseline.js";
import { DependenciesNotReadyError } from "../errors.js";
/**
 * Strip keys with `undefined` values before YAML stringification.
 * Mirrors the pattern used in `scan-sources.ts` and `mark-withdrawn.ts`.
 */
function stripUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
/**
 * Atomically claim a story for dev work.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.ref - Manifest ref (e.g. `"native:01HZ..."` or `"bmad:1.1"`).
 * @param opts.sessionUlid - ULID of the calling dev session. Stamped as
 *   `claimed_by` in the moved manifest.
 * @param opts.role - Optional role label for `writeManagedFile`'s canonical-fs
 *   guard. Defaults to `"orchestrator"`.
 * @returns `{ ref, absPath }` — the ref and absolute path of the newly-moved
 *   `in-progress/` manifest.
 *
 * @throws {InProgressHandEditError} When the ref is already in `in-progress/`
 *   and has been hand-edited since claim.
 * @throws {ManifestNotFoundError} When the ref does not exist in `to-do/`.
 * @throws {MalformedExecutionManifestError} When the manifest fails schema
 *   validation.
 * @throws {DependenciesNotReadyError} When one or more `depends_on` refs are
 *   not yet in `done/`.
 * @throws {CrossFilesystemMoveError} When the state directories are on
 *   different filesystems (EXDEV).
 */
export async function claimStory(opts) {
    const { targetRepoRoot, ref, sessionUlid, role = "orchestrator" } = opts;
    const stateRoot = path.join(targetRepoRoot, ".crew", "state");
    const absToDoPath = path.join(stateRoot, "to-do", `${ref}.yaml`);
    const absInProgressPath = path.join(stateRoot, "in-progress", `${ref}.yaml`);
    // Step 1: Hand-edit guard (AC5 / FR14a).
    // If the ref is already in in-progress/ (re-entry), call the hand-edit guard
    // and let any thrown InProgressHandEditError propagate.
    try {
        await fs.stat(absInProgressPath);
        // File exists — ref is already in in-progress/. Derive baseline and guard.
        const baseline = await deriveSourceBaseline({ targetRepoRoot, ref });
        await detectInProgressHandEdit({
            targetRepoRoot,
            ref,
            sourceHash: baseline.sourceHash,
            sourceFields: baseline.sourceFields,
        });
    }
    catch (err) {
        const code = err?.code;
        if (code === "ENOENT") {
            // File does not exist in in-progress/ — proceed with normal claim from to-do/.
        }
        else {
            // Propagate InProgressHandEditError, ManifestNotFoundError from
            // detectInProgressHandEdit, or any other error from deriveSourceBaseline.
            throw err;
        }
    }
    // Step 2: Load the to-do/ manifest.
    let rawText;
    try {
        rawText = await fs.readFile(absToDoPath, "utf8");
    }
    catch (err) {
        const code = err?.code;
        if (code === "ENOENT") {
            throw new ManifestNotFoundError({
                ref,
                expectedAbsPath: absToDoPath,
                fromState: "to-do",
            });
        }
        throw err;
    }
    const parsed = yamlParse(rawText);
    const manifest = parseExecutionManifest(parsed, { absPath: absToDoPath });
    // Step 3: Dependency check (AC2 / FR18).
    const missingDeps = [];
    for (const dep of manifest.depends_on) {
        const depPath = path.join(stateRoot, "done", `${dep}.yaml`);
        try {
            await fs.stat(depPath);
        }
        catch (err) {
            const code = err?.code;
            if (code === "ENOENT") {
                missingDeps.push(dep);
            }
            else {
                throw err;
            }
        }
    }
    if (missingDeps.length > 0) {
        throw new DependenciesNotReadyError({ ref, missingDeps });
    }
    // Step 4: Atomic transition (AC1 / FR17).
    // moveBetweenStates is the single-syscall rename primitive (Story 1.6).
    // After this returns, the manifest lives at absInProgressPath.
    await moveBetweenStates({
        targetRepoRoot,
        ref,
        from: "to-do",
        to: "in-progress",
    });
    // Step 5: Field rewrite.
    // Stamp claimed_by and update status. Re-parse defensively to ensure the
    // widened schema accepts the result. Serialise and write via writeManagedFile
    // (the FR81/NFR16 canonical-write guard).
    const updatedManifest = {
        ...manifest,
        status: "in-progress",
        claimed_by: sessionUlid,
    };
    const reparsed = parseExecutionManifest(updatedManifest, {
        absPath: absInProgressPath,
    });
    const yamlText = yamlStringify(stripUndefined(reparsed), { lineWidth: 0 });
    await writeManagedFile({
        absPath: absInProgressPath,
        contents: yamlText,
        targetRepoRoot,
        mcpToolContext: { toolName: "claimStory", role },
    });
    return { ref, absPath: absInProgressPath };
}
