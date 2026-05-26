import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { writeManagedFile } from "../lib/managed-fs.js";
import { gitInitWithEmptyCommit } from "../lib/git.js";
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const CreateSmokeScratchRepoOptionsSchema = z.object({
    /** Short kebab-case label embedded in the scratch directory name. */
    label: z.string().regex(/^[a-z0-9-]+$/, "label must be kebab-case (lowercase letters, digits, hyphens)").min(1),
    /** Parent directory under which the scratch dir is created. Defaults to os.tmpdir(). */
    parentDir: z.string().min(1).optional(),
});
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Create a disposable smoke-harness scratch repo seeded with:
 *  - git init (deterministic `main` branch) + an empty commit
 *  - minimal `.crew/config.yaml` (native adapter, empty standards)
 *  - `.crew/standards.md` copied from the shipped `docs/standards-example.md`
 *
 * Returns `{ scratchRoot, cleanup }` where `cleanup` is an idempotent
 * `fs.rm(scratchRoot, { recursive: true, force: true })` closure.
 *
 * Used by the `/crew:smoke` skill as the first checkpoint step (Story 1.13).
 */
export async function createSmokeScratchRepo(opts) {
    const parsed = CreateSmokeScratchRepoOptionsSchema.parse(opts);
    const { label, parentDir } = parsed;
    // Resolve the shipped standards template from this file's location.
    // Layout: plugins/crew/mcp-server/src/tools/create-smoke-scratch-repo.ts
    //   → up 4 dirs to plugins/crew/
    //   → docs/standards-example.md
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const standardsTemplatePath = path.resolve(HERE, "..", // src/
    "..", // mcp-server/
    "..", // plugins/crew/
    "docs", "standards-example.md");
    const scratchRoot = await fs.mkdtemp(path.join(parentDir ?? os.tmpdir(), `crew-smoke-${label}-`));
    // Step 1: git init + empty commit (canonical-fs-guard requires all git
    // spawns to live in lib/git.ts).
    await gitInitWithEmptyCommit({ cwd: scratchRoot });
    // Step 2: write minimal native-adapter .crew/config.yaml.
    // Non-canonical path (not under .crew/state/**, team/**, etc.) — no
    // mcpToolContext needed.
    await writeManagedFile({
        absPath: path.join(scratchRoot, ".crew", "config.yaml"),
        contents: "adapter: native\nstandards: {}\n",
        targetRepoRoot: scratchRoot,
    });
    // Step 3: copy standards template to .crew/standards.md.
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
