/**
 * Story 4.14 AC3 — structural-anchor test for the `/crew:smoke-setup` SKILL.md.
 *
 * Mirrors `start-skill-content.test.ts`: parses the on-disk skill file's YAML
 * front-matter, then asserts the five step labels AND each step's checkpoint
 * MCP-tool name are present in the body. The intent (per Epic-4 retro
 * carry-forward on locked-phrase grammar drift) is that prose changes which
 * silently remove a step or rename a checkpoint tool trip this test rather
 * than discover the regression in a future smoke run.
 */
export {};
