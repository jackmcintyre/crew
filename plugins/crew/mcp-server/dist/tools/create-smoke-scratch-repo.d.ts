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
export interface CreateSmokeScratchRepoOptions {
    /** Parent directory under which the scratch root is created. Defaults to `os.tmpdir()`. */
    parentDir?: string;
    /** Free-form label embedded in the scratch directory name. Required. */
    label: string;
    /**
     * Test seam — override the plugin root for unit tests that point at a fixture
     * tree. Production callers omit.
     */
    pluginRoot?: string;
}
export interface CreateSmokeScratchRepoResult {
    /** Absolute path of the newly created scratch repository. */
    scratchRoot: string;
    /** Idempotent cleanup closure — removes the scratch tree recursively. */
    cleanup: () => Promise<void>;
}
export declare function createSmokeScratchRepo(opts: CreateSmokeScratchRepoOptions): Promise<CreateSmokeScratchRepoResult>;
