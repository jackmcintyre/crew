/**
 * Allowlist-pin regression test for `loadRolePermissions` — Story 5.34 AC3.
 *
 * Reads the PRODUCTION `generalist-dev.yaml` via the real `loadRolePermissions`
 * loader (no fixtures, no mocks of the permission file) and asserts that
 * `gh_allow` is a superset of every subcommand `runAutoMergeGate` can invoke:
 *   - pr-merge  (auto-merge branch)
 *   - repo-view (pause-needs-human branch: gh repo view --json owner,name)
 *   - api       (pause-needs-human branch: gh api POST .../labels)
 *
 * This closes the mock-masking gap surfaced in the bmad:6.3 close-out failure
 * (2026-05-29, PR #180): the gate's existing vitest suite hand-built in-test
 * fixtures that happened to include repo-view + api, so the real generalist-dev
 * allowlist gap was invisible until the gate ran in production.
 *
 * `pluginRoot` is resolved via `import.meta.url` walked up from
 * `src/state/__tests__/` to `plugins/crew/` (four directories up) — same
 * pattern used by `getPluginRoot()` in `lib/plugin-root.ts`.
 *
 * Pure deterministic — no LLM invocation, no network, no temp fixtures.
 */
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRolePermissions } from "../load-role-permissions.js";
// ---------------------------------------------------------------------------
// Resolve the real plugin root from this file's location.
//
// File layout:
//   plugins/crew/                                       <-- PLUGIN_ROOT
//     mcp-server/src/state/__tests__/                  <-- HERE (this file)
//
// Path: dirname(__file__) / .. / .. / .. / ..  →  plugins/crew/
// ---------------------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_PLUGIN_ROOT = path.resolve(HERE, "..", "..", "..", "..");
// ---------------------------------------------------------------------------
// AC3: generalist-dev gh_allow must be a superset of the gate's subcommands
// ---------------------------------------------------------------------------
describe("Story 5.34 — AC3: generalist-dev.yaml allowlist pin (production file)", () => {
    it("gh_allow contains pr-merge, repo-view, and api (no fixture — production yaml)", async () => {
        const permissions = await loadRolePermissions({
            role: "generalist-dev",
            pluginRoot: REAL_PLUGIN_ROOT,
        });
        const required = ["pr-merge", "repo-view", "api"];
        for (const subcommand of required) {
            expect(permissions.gh_allow, `generalist-dev.yaml gh_allow must include "${subcommand}" (required by runAutoMergeGate)`).toContain(subcommand);
        }
    });
    it("gh_allow preserves the pre-existing pr-create, pr-view, pr-comment entries", async () => {
        const permissions = await loadRolePermissions({
            role: "generalist-dev",
            pluginRoot: REAL_PLUGIN_ROOT,
        });
        const preExisting = ["pr-create", "pr-view", "pr-comment", "pr-merge"];
        for (const subcommand of preExisting) {
            expect(permissions.gh_allow, `generalist-dev.yaml gh_allow must still contain pre-existing "${subcommand}"`).toContain(subcommand);
        }
    });
});
