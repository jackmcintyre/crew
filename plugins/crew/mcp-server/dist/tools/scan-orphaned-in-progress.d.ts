/**
 * `scanOrphanedInProgress` MCP tool — Story 5.11 Task 1.
 *
 * Pure read-only scan of `<targetRepoRoot>/.crew/state/in-progress/` for manifests
 * whose `claimed_by` ULID is defined AND differs from the current session's ULID.
 *
 * Returns orphans in stable alphabetical ref order (sort by filename = ref + .yaml).
 * For each orphan, computes the transcript path and stats it to determine
 * `hasTranscript`, and queries `gh pr list --head <branch>` to determine
 * `hasOpenPR` (Story 5.20 AC1).
 *
 * Manifests whose `claimed_by` is absent (malformed) are silently skipped — they
 * are a different defect class (out of scope for this story, per Behavioural contract).
 *
 * No write side-effects. Propagates `MalformedExecutionManifestError` verbatim.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `scanOrphanedInProgress`.
 * Story 5.11 Task 1.1–1.5. Story 5.20 AC1 adds `hasOpenPR`.
 */
import { execa as defaultExeca } from "execa";
export interface OrphanedManifest {
    /** Story ref, e.g. `"native:01HZ..."` or `"bmad:1.1"`. */
    ref: string;
    /** The stale `claimed_by` ULID from the manifest. */
    staleUlid: string;
    /** Absolute path to the in-progress manifest file. */
    manifestPath: string;
    /** Absolute path to the transcript file (may or may not exist). */
    transcriptPath: string;
    /** Whether the transcript file exists and is readable. */
    hasTranscript: boolean;
    /**
     * Whether at least one open PR exists whose head branch matches the
     * branch name derived from this manifest's ref + title via `buildBranchSlug`.
     * Defaults to `false` on any `gh` error (network, auth, etc.) — safe
     * fallback to the existing `blockOrphanNoTranscript` behaviour. (Story 5.20 AC1)
     */
    hasOpenPR: boolean;
}
export interface ScanOrphanedInProgressResult {
    orphans: OrphanedManifest[];
}
export interface ScanOrphanedInProgressOptions {
    targetRepoRoot: string;
    sessionUlid: string;
    /** Test seam — production callers omit this. */
    execaImpl?: typeof defaultExeca;
}
/**
 * Scan `<targetRepoRoot>/.crew/state/in-progress/` for orphaned manifests.
 *
 * An orphan is a manifest whose `claimed_by` field is defined and does not match
 * the current `sessionUlid`. Results are sorted alphabetically by ref.
 *
 * Each orphan carries `hasOpenPR: boolean` — derived by running
 * `gh pr list --head <branch> --state open --json number` where `<branch>` is
 * `buildBranchSlug({ ref, title })`. On any `gh` error, defaults to `false`.
 *
 * @throws {MalformedExecutionManifestError} When any manifest fails schema validation.
 */
export declare function scanOrphanedInProgress(opts: ScanOrphanedInProgressOptions): Promise<ScanOrphanedInProgressResult>;
