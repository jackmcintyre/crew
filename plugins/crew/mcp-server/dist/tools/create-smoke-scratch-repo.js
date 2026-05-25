/**
 * `createSmokeScratchRepo` MCP tool — Story 4.14 (smoke-harness wrapper skill).
 *
 * Creates a fresh scratch repository under `<parentDir>/crew-smoke-<label>-<ulid>/`,
 * initialises git with an initial empty commit, writes a minimal
 * `.crew/config.yaml` selecting the native adapter, and copies the plugin's
 * shipped standards-doc template to `.crew/standards.md`. Returns the absolute
 * scratch path plus a cleanup closure (the closure is exposed for tests; the
 * skill does NOT call it — the operator inspects failed smokes by hand).
 *
 * Design notes:
 *  - File writes route through `writeManagedFile`. `.crew/config.yaml` and
 *    `.crew/standards.md` are NOT canonical-state paths (only `docs/standards.md`
 *    is), so no mcpToolContext is required. The scratch root is itself outside
 *    any canonical-state hierarchy.
 *  - The git init + empty commit is delegated to `gitInitWithEmptyCommit`
 *    in `lib/git.ts` — the AC6f static guard forbids any other file from
 *    spawning `git`.
 *  - The standards template lives at `<pluginRoot>/docs/standards-example.md`
 *    (per `plugins/crew/skills/status/SKILL.md` failure-modes prose). If the
 *    file is unreadable, the function throws — smoke-harness behaviour should
 *    not silently degrade.
 *  - Native adapter is the smoke default because the planner path is minimal-
 *    friction.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ulid } from "ulid";
import { writeManagedFile } from "../lib/managed-fs.js";
import { gitInitWithEmptyCommit } from "../lib/git.js";
import { getPluginRoot } from "../lib/plugin-root.js";
/**
 * Minimal `.crew/config.yaml` selecting the native adapter. Matches the
 * shape used by `mcp-server/src/adapters/native/fixtures/sample-target-repo/
 * .crew/config.yaml` (which is what the workspace resolver expects).
 */
const MINIMAL_NATIVE_CONFIG = `adapter: native
adapter_config: {}
`;
/**
 * Conservative label sanitiser: kebab-case (lowercase letters, digits, hyphens).
 * Any other character collapses to a single hyphen. Empty labels are rejected
 * by the caller via Zod; this helper assumes a non-empty input.
 */
function sanitiseLabel(label) {
    const collapsed = label
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return collapsed.length > 0 ? collapsed : "smoke";
}
export async function createSmokeScratchRepo(opts) {
    const parentDir = opts.parentDir ?? os.tmpdir();
    const pluginRoot = opts.pluginRoot ?? getPluginRoot();
    const safeLabel = sanitiseLabel(opts.label);
    const scratchRoot = path.join(parentDir, `crew-smoke-${safeLabel}-${ulid()}`);
    await fs.mkdir(scratchRoot, { recursive: true });
    // Git init + initial empty commit so downstream tools (notably the planner)
    // don't see `git rev-parse failed: HEAD`.
    await gitInitWithEmptyCommit({ cwd: scratchRoot });
    // .crew/config.yaml — selects the native adapter.
    await writeManagedFile({
        absPath: path.join(scratchRoot, ".crew", "config.yaml"),
        contents: MINIMAL_NATIVE_CONFIG,
        targetRepoRoot: scratchRoot,
    });
    // .crew/standards.md — copy the shipped standards-doc template verbatim.
    const standardsTemplatePath = path.join(pluginRoot, "docs", "standards-example.md");
    const standardsContents = await fs.readFile(standardsTemplatePath, "utf8");
    await writeManagedFile({
        absPath: path.join(scratchRoot, ".crew", "standards.md"),
        contents: standardsContents,
        targetRepoRoot: scratchRoot,
    });
    const cleanup = async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
    };
    return { scratchRoot, cleanup };
}
