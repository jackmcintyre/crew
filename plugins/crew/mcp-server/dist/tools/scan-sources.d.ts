/**
 * Result returned by `scanSources`. All four ref arrays are disjoint.
 *
 * - `createdRefs`: manifests that did not exist before this scan (AC1 path).
 * - `updatedRefs`: manifests still in `to-do/` whose `source_hash` was
 *   refreshed because the source story changed (AC3 path).
 * - `unchangedRefs`: manifests in `to-do/` with a matching hash — no write
 *   performed (AC2 idempotent path).
 * - `skippedRefs`: refs the adapter listed but the tool deliberately did NOT
 *   touch. `reason: "not-in-to-do"` means the manifest already exists in
 *   another state dir (in-progress, blocked, done) — the dev loop owns it
 *   there. `reason: "discipline-violation"` is reserved for Story 3.5; v1
 *   never produces it (all adapters' `validateAgainstDiscipline` is pass-through).
 */
export interface ScanResult {
    targetRepoRoot: string;
    adapterName: string;
    createdRefs: string[];
    updatedRefs: string[];
    unchangedRefs: string[];
    skippedRefs: Array<{
        ref: string;
        reason: "not-in-to-do" | "discipline-violation";
        detail?: string;
    }>;
}
/**
 * Render a `ScanResult` as a human-readable text summary.
 * The tool returns this string verbatim; the `/crew:scan` skill
 * prints it without paraphrase or omission.
 */
export declare function renderScanResult(result: ScanResult): string;
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
export declare function scanSources(opts: {
    targetRepoRoot: string;
}): Promise<ScanResult>;
