/**
 * Resolve the absolute path of the plugin root (`plugins/crew/`).
 *
 * Layout (both at test-time and at runtime):
 *   plugins/crew/                          <-- PLUGIN_ROOT
 *     mcp-server/src/lib/plugin-root.ts    <-- this file (vitest)
 *     mcp-server/dist/lib/plugin-root.js   <-- this file (compiled)
 *
 * Both layouts are three directories up from this file. Mirrors the
 * resolution style in `plugin-version.ts`. Pure — no IO, no env reads,
 * no process.cwd().
 *
 * Used by the MCP tool handlers in `register.ts` to obtain the plugin
 * root for `readCatalogue` and `instantiatePersona`. Keeps the plugin
 * path off the operator-facing tool surface.
 */
export declare function getPluginRoot(): string;
