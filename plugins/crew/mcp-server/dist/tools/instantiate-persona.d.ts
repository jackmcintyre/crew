export interface InstantiatePersonaOptions {
    pluginRoot: string;
    targetRepoRoot: string;
    role: string;
    /**
     * Test seam. Production callers omit; the default `() => new Date()`
     * is the v1 runtime clock.
     */
    clock?: () => Date;
    /**
     * Test seam. Production callers omit; the default `getPluginVersion()`
     * reads from the plugin manifest.
     */
    pluginVersion?: string;
}
export interface InstantiatePersonaResult {
    path: string;
}
/**
 * Materialise a persona file at `<targetRepoRoot>/team/<role>/PERSONA.md`
 * by copying the catalogue's frontmatter + four canonical sections
 * verbatim and stamping `hired_at` (ISO-8601 UTC) and
 * `catalogue_version` (plugin semver). The `## Knowledge` section is
 * written empty at hire time (FR89); Epic 3's `appendPersonaKnowledge`
 * is the only authorised path to mutate it.
 *
 * Contract:
 *  - Throws `CatalogueRoleNotFoundError` if the role is unknown.
 *  - Throws `PersonaAlreadyExistsError` if a persona file already exists
 *    at the target path. **Does NOT silently overwrite** — re-hire-on-
 *    existing-team is `/hire`'s mandate (FR90), not this tool's.
 *  - Routes the write through `writeManagedFile` with an MCP tool
 *    context — `team/**` is in `CANONICAL_PATH_GLOBS`, so without the
 *    context the write would refuse.
 *
 * No telemetry emit in v1 — persona creation is not a runtime agent
 * event. The architecture's `persona.append` event type is Epic 3's.
 * (Story 2.3 FR89, FR98)
 */
export declare function instantiatePersona(opts: InstantiatePersonaOptions): Promise<InstantiatePersonaResult>;
