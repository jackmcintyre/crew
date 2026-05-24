/**
 * Shared helper: read, parse, and validate the `dev-outcome.json` file
 * written by `runDevTerminalAction`.
 *
 * Mirrors the pattern of `lib/read-reviewer-result-file.ts` (Story 4.6 revision 2):
 * - Returns `null` on ENOENT (file absent — fallback to transcript scanning).
 * - Throws `DevOutcomeFileMalformedError` on malformed JSON or any validation miss.
 *   A malformed file is a machine-write failure and must NOT silently fall back.
 *
 * Signature deliberately matches `readReviewerResultFile(targetRepoRoot, sessionUlid)`
 * so both helpers are compositionally symmetric.
 *
 * Story 4.8b Task 3 / AC2–AC4.
 */
export interface DevOutcome {
    prUrl: string;
    prNumber: number;
    branch: string;
    commitSha: string;
}
/**
 * Read, parse, and validate the `dev-outcome.json` file written by
 * `runDevTerminalAction`. Returns `null` when the file is absent (ENOENT).
 * Throws `DevOutcomeFileMalformedError` on malformed JSON or unexpected shape.
 *
 * @param targetRepoRoot - Absolute path to the target repository root.
 * @param sessionUlid - ULID of the calling session.
 */
export declare function readDevOutcomeFile(targetRepoRoot: string, sessionUlid: string): Promise<DevOutcome | null>;
