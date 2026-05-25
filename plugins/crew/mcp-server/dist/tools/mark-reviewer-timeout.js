/**
 * `markReviewerTimeout` MCP tool — Story 4.12 (NFR2 / AC3).
 *
 * Stamps `blocked_by: "reviewer-timeout"` on the in-progress manifest
 * after `postReviewerComments` returned `next: "reviewer-timeout"`. The
 * SKILL.md prose calls this best-effort; if the manifest is missing,
 * the tool returns `{ next: "manifest-missing" }` without throwing.
 *
 * The GitHub-side `needs-human` label is the primary signal; this stamp
 * is a diagnostic for the next operator pass.
 */
import { promises as fs } from "node:fs";
import { readManifest, writeManifest } from "../lib/manifest-io.js";
export async function markReviewerTimeout(opts) {
    const chatLog = [];
    try {
        await fs.stat(opts.manifestPath);
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT") {
            chatLog.push(`mark-reviewer-timeout: manifest at ${opts.manifestPath} not found; skipping stamp`);
            return { next: "manifest-missing", chatLog };
        }
        throw err;
    }
    const manifest = await readManifest(opts.manifestPath);
    await writeManifest(opts.manifestPath, {
        ...manifest,
        blocked_by: "reviewer-timeout",
    });
    chatLog.push(`mark-reviewer-timeout: stamped blocked_by=reviewer-timeout on ${opts.ref}`);
    return { next: "stamped", chatLog };
}
