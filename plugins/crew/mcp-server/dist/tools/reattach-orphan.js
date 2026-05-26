/**
 * `reattachOrphan` MCP tool — Story 5.11 Task 2.
 *
 * Atomically rewrites an orphaned in-progress manifest's `claimed_by` field
 * from the stale session ULID to the current session ULID. This is the
 * transcript-present path of the orphan-recovery branch in `/crew:start`.
 *
 * After `reattachOrphan` returns, `completeStory`'s `WrongClaimantError` check
 * is satisfied (the manifest's `claimed_by` now matches the current session).
 *
 * Throws `NotAnOrphanError` if the manifest's `claimed_by` already equals
 * `currentSessionUlid` — a race condition between the scan and the rewrite.
 *
 * Throws `ManifestNotFoundError` if the ref is absent from `in-progress/`.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `reattachOrphan`.
 * Story 5.11 Task 2.1–2.4.
 */
import * as path from "node:path";
import { ManifestNotFoundError, NotAnOrphanError } from "../errors.js";
import { readManifest, writeManifest } from "../lib/manifest-io.js";
/**
 * Reattach an orphaned in-progress manifest to the current session.
 *
 * Rewrites `claimed_by` from the stale ULID to `currentSessionUlid` atomically
 * via `writeManifest` (which uses `atomicWriteFile` internally).
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.ref - Manifest ref (e.g. `"native:01HZ..."` or `"bmad:1.1"`).
 * @param opts.currentSessionUlid - ULID of the calling session. Will become the new `claimed_by`.
 *
 * @returns `{ chatLog }` — a one-entry array with the reattach log line.
 *
 * @throws {NotAnOrphanError} When `claimed_by === currentSessionUlid` (race condition).
 * @throws {ManifestNotFoundError} When the ref is absent from `in-progress/`.
 * @throws {MalformedExecutionManifestError} When the manifest fails schema validation.
 */
export async function reattachOrphan(opts) {
    const { targetRepoRoot, ref, currentSessionUlid } = opts;
    const absPath = path.join(targetRepoRoot, ".crew", "state", "in-progress", `${ref}.yaml`);
    // Step 1: Load the manifest. Propagate ManifestNotFoundError on ENOENT
    // (readManifest itself throws ENOENT — wrap it).
    let manifest;
    try {
        manifest = await readManifest(absPath);
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
    // Step 2: Verify it is actually an orphan.
    if (manifest.claimed_by === currentSessionUlid) {
        throw new NotAnOrphanError({ ref, currentSessionUlid });
    }
    const staleUlid = manifest.claimed_by ?? "<absent>";
    // Step 3: Rewrite claimed_by to the current session ULID.
    const updatedManifest = {
        ...manifest,
        claimed_by: currentSessionUlid,
    };
    await writeManifest(absPath, updatedManifest);
    // Step 4: Return the verbatim chat log entry.
    const chatLog = [
        `reattaching ${ref} — claimed_by rewritten from ${staleUlid} to ${currentSessionUlid}`,
    ];
    return { chatLog };
}
