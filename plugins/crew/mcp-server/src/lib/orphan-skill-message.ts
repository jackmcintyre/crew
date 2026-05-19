/**
 * Builds the verbatim failure-message string used by the install-contract
 * orphan-skill guard (Story 1.7a AC3 / AC4b).
 *
 * The wording is part of the AC contract — do not edit without updating the
 * spec at `_bmad-output/implementation-artifacts/1-7a-hotfix-make-the-install-path-actually-work-end-to-end.md`.
 */
export function buildOrphanSkillMessage(orphans: readonly string[]): string {
  const bullets = orphans.map((o) => `  - ${o}`).join("\n");
  return (
    `Orphaned skill file(s) detected under plugins/crew/skills/:\n` +
    `${bullets}\n` +
    `Register each file in plugins/crew/.claude-plugin/plugin.json's "skills" array,\n` +
    `or add it to plugins/crew/.claude-plugin/skills-opt-out.txt (one path per line).`
  );
}
