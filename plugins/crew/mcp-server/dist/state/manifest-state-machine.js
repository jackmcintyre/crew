import { rename, mkdir, stat, readFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { CrossFilesystemMoveError, InProgressHandEditError, InvalidStateNameError, ManifestNotFoundError, } from "../errors.js";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";
/**
 * The canonical state-machine directory names. A manifest at
 * `<targetRepoRoot>/.crew/state/<state>/<ref>.yaml` is
 * "in" the named state by virtue of its parent directory. (NFR8)
 */
export const STATE_NAMES = [
    "to-do",
    "in-progress",
    "blocked",
    "done",
];
const DEFAULT_FS_IMPL = {
    rename: (from, to) => rename(from, to),
    mkdir: (dir, opts) => mkdir(dir, opts),
    stat: (p) => stat(p),
};
function isStateName(value) {
    return STATE_NAMES.includes(value);
}
/**
 * Move a manifest between two canonical state directories via a
 * single `fs.rename(2)` syscall. This is the ONLY file in
 * `mcp-server/src/**` permitted to invoke `rename` against a
 * state-machine path (enforced by a static guard in
 * `tests/canonical-fs-guard.test.ts`).
 *
 * The function is a pure structural primitive — it does NOT read or
 * write manifest contents, does NOT emit telemetry, does NOT acquire
 * locks. POSIX `rename(2)` (and the macOS/Linux equivalents) is itself
 * the atomicity guarantee within a single filesystem. Cross-filesystem
 * moves are explicitly out of v1 scope: an `EXDEV` errno surfaces as
 * a typed `CrossFilesystemMoveError` with no copy+delete fallback.
 *
 * See Story 1.6, `core-architectural-decisions.md` lines 27–40,
 * NFR8 / NFR9 / NFR19.
 */
export async function moveBetweenStates(opts) {
    const { targetRepoRoot, ref, from, to } = opts;
    const fsImpl = opts.fsImpl ?? DEFAULT_FS_IMPL;
    // 1. Validate state names. No filesystem touch.
    if (!isStateName(from) || !isStateName(to)) {
        throw new InvalidStateNameError({
            attemptedFrom: from,
            attemptedTo: to,
            allowedStates: STATE_NAMES,
            reason: "unknown state name",
        });
    }
    // 2. Compute paths.
    const stateRoot = path.join(targetRepoRoot, ".crew", "state");
    const absFromPath = path.join(stateRoot, from, ref + ".yaml");
    const absToPath = path.join(stateRoot, to, ref + ".yaml");
    // 3. Path-escape guard (mirrors managed-fs.ts line 85). The `ref`
    //    parameter is not regex-validated; this is the last line of
    //    defense against `ref` values like `../../etc/passwd`.
    for (const absPath of [absFromPath, absToPath]) {
        const rel = path.relative(stateRoot, absPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new InvalidStateNameError({
                attemptedFrom: from,
                attemptedTo: to,
                allowedStates: STATE_NAMES,
                reason: "path escapes state root",
            });
        }
    }
    // 4. Ensure destination directory exists. `fs.rename` does NOT
    //    create parent directories itself.
    await fsImpl.mkdir(path.dirname(absToPath), { recursive: true });
    // 5. Single rename syscall. NO copy+delete fallback on EXDEV.
    try {
        await fsImpl.rename(absFromPath, absToPath);
    }
    catch (err) {
        const code = err?.code;
        if (code === "EXDEV") {
            throw new CrossFilesystemMoveError({
                absFromPath,
                absToPath,
                ref,
                originalCode: "EXDEV",
            });
        }
        if (code === "ENOENT") {
            throw new ManifestNotFoundError({
                ref,
                expectedAbsPath: absFromPath,
                fromState: from,
            });
        }
        throw err;
    }
    return { from, to, ref, absFromPath, absToPath };
}
/**
 * Deep-equality helper for `OperatorEditableFields`.
 *
 * Uses order-sensitive comparison for arrays (`acceptance_criteria`, `depends_on`).
 * Scalar fields use strict equality. Intentionally hand-rolled — the comparison
 * surface is small (six fields with known shapes) and adding a dependency like
 * `lodash.isequal` would be speculative. (Story 3.7 — no new deps.)
 */
function operatorFieldsEqual(a, b) {
    if (a.title !== b.title)
        return false;
    if (a.narrative !== b.narrative)
        return false;
    if (a.implementation_notes !== b.implementation_notes)
        return false;
    if (a.withdrawn !== b.withdrawn)
        return false;
    // acceptance_criteria — order-sensitive deep equal on { text, kind } objects.
    if (a.acceptance_criteria.length !== b.acceptance_criteria.length)
        return false;
    for (let i = 0; i < a.acceptance_criteria.length; i++) {
        const ac_a = a.acceptance_criteria[i];
        const ac_b = b.acceptance_criteria[i];
        if (ac_a.text !== ac_b.text || ac_a.kind !== ac_b.kind)
            return false;
    }
    // depends_on — order-sensitive string array.
    if (a.depends_on.length !== b.depends_on.length)
        return false;
    for (let i = 0; i < a.depends_on.length; i++) {
        if (a.depends_on[i] !== b.depends_on[i])
            return false;
    }
    return true;
}
/**
 * Detects whether an `in-progress/` manifest has been hand-edited since it
 * was claimed by the dev loop.
 *
 * **Guard contract (Story 3.7, FR14 second half):**
 * - Returns `{ ok: true }` when the on-disk manifest's `source_hash` matches
 *   `opts.sourceHash` AND all operator-editable fields match `opts.sourceFields`.
 * - Throws `InProgressHandEditError` (with the list of changed fields) when any
 *   field has been mutated. The list includes `"source_hash"` if that field drifted.
 * - Propagates `MalformedExecutionManifestError` unchanged when the on-disk
 *   manifest is structurally invalid — a malformed manifest is a worse problem
 *   than a hand-edit and must surface via existing FR13 handling.
 * - Propagates `ManifestNotFoundError` when the manifest does not exist at the
 *   expected path — callers route based on state and should not invoke this guard
 *   for refs that are not in `in-progress/`.
 *
 * **Caller contract:**
 * Epic 4/5 callers MUST invoke this guard on entry for any ref they would operate
 * on in the `in-progress/` layer. The guard is NOT called defensively on every
 * skill invocation — only for refs the tool would otherwise act on. (Story 3.7)
 *
 * **Pure with respect to writes:** never modifies the manifest, never moves it.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.ref - Manifest ref (e.g. `"native:01HZ..."`).
 * @param opts.sourceHash - The `source_hash` value at the time the manifest was
 *   last written by `scan-sources` (i.e. the canonical value).
 * @param opts.sourceFields - The operator-editable field values at scan-time.
 *
 * @throws {InProgressHandEditError} When a hand-edit is detected.
 * @throws {MalformedExecutionManifestError} When the manifest is structurally invalid.
 * @throws {ManifestNotFoundError} When the manifest does not exist in `in-progress/`.
 */
export async function detectInProgressHandEdit(opts) {
    const { targetRepoRoot, ref, sourceHash, sourceFields } = opts;
    const absPath = path.join(targetRepoRoot, ".crew", "state", "in-progress", ref + ".yaml");
    // Read the on-disk manifest. Propagate ENOENT as ManifestNotFoundError.
    let rawText;
    try {
        rawText = await readFile(absPath, "utf8");
    }
    catch (err) {
        const code = err?.code;
        if (code === "ENOENT") {
            throw new ManifestNotFoundError({
                ref,
                expectedAbsPath: absPath,
                fromState: "in-progress",
            });
        }
        throw err;
    }
    // Parse: propagate MalformedExecutionManifestError unchanged.
    const parsed = yamlParse(rawText);
    const manifest = parseExecutionManifest(parsed, { absPath });
    // Detect changed fields.
    const changedFields = [];
    if (manifest.source_hash !== sourceHash) {
        changedFields.push("source_hash");
    }
    const diskFields = {
        title: manifest.title,
        narrative: manifest.narrative,
        acceptance_criteria: manifest.acceptance_criteria,
        implementation_notes: manifest.implementation_notes,
        depends_on: manifest.depends_on,
        withdrawn: manifest.withdrawn,
    };
    if (!operatorFieldsEqual(diskFields, sourceFields)) {
        // Identify which specific fields changed.
        if (diskFields.title !== sourceFields.title)
            changedFields.push("title");
        if (diskFields.narrative !== sourceFields.narrative)
            changedFields.push("narrative");
        if (diskFields.implementation_notes !== sourceFields.implementation_notes)
            changedFields.push("implementation_notes");
        if (diskFields.withdrawn !== sourceFields.withdrawn)
            changedFields.push("withdrawn");
        // acceptance_criteria — check individually.
        const acA = diskFields.acceptance_criteria;
        const acB = sourceFields.acceptance_criteria;
        let acDiffers = acA.length !== acB.length;
        if (!acDiffers) {
            for (let i = 0; i < acA.length; i++) {
                if (acA[i].text !== acB[i].text || acA[i].kind !== acB[i].kind) {
                    acDiffers = true;
                    break;
                }
            }
        }
        if (acDiffers)
            changedFields.push("acceptance_criteria");
        // depends_on — check individually.
        const doA = diskFields.depends_on;
        const doB = sourceFields.depends_on;
        let doDiffers = doA.length !== doB.length;
        if (!doDiffers) {
            for (let i = 0; i < doA.length; i++) {
                if (doA[i] !== doB[i]) {
                    doDiffers = true;
                    break;
                }
            }
        }
        if (doDiffers)
            changedFields.push("depends_on");
    }
    if (changedFields.length > 0) {
        throw new InProgressHandEditError({ ref, changedFields, absPath });
    }
    return { ok: true };
}
/**
 * Single load-bearing predicate for the dev-loop claim path.
 *
 * Returns `true` iff the manifest is eligible to be claimed by the dev loop:
 * the manifest must be in the `to-do` state AND must not have been withdrawn
 * via `/crew:plan discard`. Once `withdrawn: true` is set (Story 3.6), the
 * manifest is permanently out of the claim candidate set until an operator
 * hand-edits it back (Story 3.7's territory).
 *
 * **Pure — no I/O.** Epic 5's claim loop imports this predicate as the single
 * source of truth for "withdrawn means skipped". Co-located here with the
 * other state-machine primitives to ensure it is imported from one place.
 *
 * Story 3.6 — `isClaimable` predicate.
 * Epic 5 pickup: the claim loop calls `isClaimable(manifest)` before claiming.
 */
export function isClaimable(manifest) {
    return manifest.withdrawn === false && manifest.status === "to-do";
}
