/**
 * Shared helper: read, parse, and validate the `reviewer-result.json` file
 * written by `runReviewerSession`.
 *
 * Extracted from `tools/process-reviewer-transcript.ts` (Story 4.6 revision 2)
 * into this shared module so both `processReviewerTranscript` and the new
 * `postReviewerComments` tool (Story 4.6b) can call the same parser without
 * duplicating the null-on-ENOENT / throw-on-malformed behaviour.
 *
 * Story 4.6b Task 1.1
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ReviewerResultFileMalformedError } from "../errors.js";
/**
 * Read, parse, and validate the `reviewer-result.json` file written by
 * `runReviewerSession`. Returns `null` when the file is absent (ENOENT).
 * Throws `ReviewerResultFileMalformedError` on malformed JSON or unexpected shape.
 *
 * @param targetRepoRoot - Absolute path to the target repository root.
 * @param sessionUlid - ULID of the calling session.
 */
export async function readReviewerResultFile(targetRepoRoot, sessionUlid) {
    const filePath = path.join(targetRepoRoot, ".crew", "state", "sessions", sessionUlid, "reviewer-result.json");
    let raw;
    try {
        raw = await fs.readFile(filePath, "utf8");
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT") {
            return null;
        }
        throw err;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (cause) {
        throw new ReviewerResultFileMalformedError({ path: filePath, cause });
    }
    // Minimal shape validation — just enough to confirm the fields we rely on.
    if (typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.recommendedVerdict !== "string" ||
        !["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED"].includes(parsed.recommendedVerdict)) {
        throw new ReviewerResultFileMalformedError({
            path: filePath,
            cause: "missing or invalid 'recommendedVerdict' field — expected one of: READY FOR MERGE, NEEDS CHANGES, BLOCKED",
        });
    }
    return parsed;
}
