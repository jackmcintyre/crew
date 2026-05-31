/**
 * `readBacklogInventory` MCP tool — Story 3.6 HIGH-1 fix.
 *
 * Builds the backlog inventory server-side so the `/crew:plan` skill does
 * not need to enumerate `.yaml` files itself via the `Read` tool (which
 * requires known paths and cannot glob). The skill declares
 * `allowed_tools: [Task, readBacklogInventory]` and delegates enumeration
 * to this tool.
 *
 * Returns the typed `BacklogInventory` JSON the planner skill prose
 * consumes, including:
 *   - `mode`: `"first-run"` | `"re-open"`
 *   - `backlog_inventory`: array of `{ ref, title, state, withdrawn }`
 *
 * `MalformedExecutionManifestError` (and any other `parseExecutionManifest`
 * typed errors) are surfaced verbatim — this resolves MEDIUM-1 as well.
 *
 * Architecture reference: Story 3.6 reviewer HIGH-1.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { z } from "zod";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";
import { STATE_NAMES } from "../state/manifest-state-machine.js";
import { resolveWorkspace } from "../state/workspace-resolver.js";
export const ReadBacklogInventoryInputSchema = z.object({
    targetRepoRoot: z.string().min(1),
});
/** ULID pattern: 26 characters from [0-9A-Z]. */
const ULID_PATTERN = /^[0-9A-Z]{26}$/;
/**
 * Extract the first H1 title from a native story Markdown file body.
 * Falls back to the filename (without extension) if no H1 is found.
 */
function extractH1Title(content, fallback) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : fallback;
}
/**
 * Build the backlog inventory for the target repo.
 *
 * - Scans all four state directories (`to-do`, `in-progress`, `blocked`, `done`)
 *   for `.yaml` manifest files. Each is parsed via `parseExecutionManifest`
 *   (typed errors surface verbatim — not caught here).
 * - On the native-adapter branch only: also scans `.crew/native-stories/` for
 *   ULID-pattern `.md` files whose `native:<ULID>` ref does not already appear
 *   in the manifest inventory. Those entries get `state: "native-source-only"`,
 *   `withdrawn: false`, and `title` from the file's first H1.
 * - Derives `mode`: `"re-open"` if at least one entry exists, else `"first-run"`.
 *
 * @throws {MalformedExecutionManifestError} if any manifest fails schema validation.
 */
export async function readBacklogInventory(rawInput) {
    const input = ReadBacklogInventoryInputSchema.parse(rawInput);
    const targetRepoRoot = path.resolve(input.targetRepoRoot);
    // Resolve workspace to know the active adapter.
    const workspace = await resolveWorkspace({ targetRepoRoot });
    const isNative = workspace.activeAdapterName === "native";
    const stateRoot = path.join(targetRepoRoot, ".crew", "state");
    const doneDir = path.join(stateRoot, "done");
    const inventory = [];
    const seenRefs = new Set();
    // Scan each state directory.
    for (const stateName of STATE_NAMES) {
        const stateDir = path.join(stateRoot, stateName);
        let entries;
        try {
            entries = await fs.readdir(stateDir);
        }
        catch {
            // Directory does not exist yet — skip.
            continue;
        }
        for (const filename of entries) {
            if (!filename.endsWith(".yaml"))
                continue;
            const absPath = path.join(stateDir, filename);
            const rawText = await fs.readFile(absPath, "utf8");
            const parsed = yamlParse(rawText);
            // `parseExecutionManifest` throws `MalformedExecutionManifestError` on
            // schema failure. Per the skill's `MalformedExecutionManifestError` failure
            // mode, the tool surfaces the error verbatim (not caught here).
            const manifest = parseExecutionManifest(parsed, { absPath });
            // depsReady mirrors listClaimableTodos: every dep present in done/.
            let depsReady = true;
            for (const dep of manifest.depends_on) {
                try {
                    await fs.stat(path.join(doneDir, `${dep}.yaml`));
                }
                catch {
                    depsReady = false;
                    break;
                }
            }
            inventory.push({
                ref: manifest.ref,
                title: manifest.title,
                state: stateName,
                withdrawn: manifest.withdrawn,
                ready: manifest.ready,
                depsReady,
            });
            seenRefs.add(manifest.ref);
        }
    }
    // Native-branch: supplement with source-only stories (no manifest yet).
    if (isNative) {
        const nativeStoriesDir = path.join(targetRepoRoot, ".crew", "native-stories");
        let nativeFiles;
        try {
            nativeFiles = await fs.readdir(nativeStoriesDir);
        }
        catch {
            nativeFiles = [];
        }
        for (const filename of nativeFiles) {
            if (!filename.endsWith(".md"))
                continue;
            const basename = filename.slice(0, -3); // strip .md
            if (!ULID_PATTERN.test(basename))
                continue;
            const ref = `native:${basename}`;
            if (seenRefs.has(ref))
                continue; // already covered by a manifest
            const absPath = path.join(nativeStoriesDir, filename);
            const content = await fs.readFile(absPath, "utf8");
            const title = extractH1Title(content, basename);
            inventory.push({
                ref,
                title,
                state: "native-source-only",
                withdrawn: false,
                ready: false,
                depsReady: true,
            });
        }
    }
    const mode = inventory.length === 0 ? "first-run" : "re-open";
    return { mode, backlog_inventory: inventory };
}
