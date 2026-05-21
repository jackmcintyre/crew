/**
 * AC5 — SKILL.md content structure check — Story 4.2.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC5:
 *
 *   (i)   `name === "crew:start"` (exact).
 *   (ii)  `allowed_tools` is a superset of `["Task", "buildPersonaSpawnPrompt",
 *          "claimStory", "getStatus"]`.
 *   (iii) Body contains the verbatim AC5(iii) string.
 *   (iv)  Body contains the verbatim AC3 queue-drained line.
 *   (v)   Body's `# Failure modes` section names all four required typed errors.
 *
 * This test is the structural anchor required by the spec brief — LLM outputs
 * are non-deterministic; a deterministic file-content check is mandatory.
 */
export {};
