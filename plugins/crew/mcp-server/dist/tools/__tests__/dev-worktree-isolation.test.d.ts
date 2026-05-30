/**
 * Integration tests for the drain's dev-step worktree isolation — Story 8.16.
 *
 * Exercises `runDevTerminalAction` in its default (worktree) mode against a real
 * tmpdir git repo with a real `origin` (a sibling bare repo, so `git push`
 * genuinely succeeds), stubbing ONLY `gh pr create` (the network terminal
 * action). Asserts:
 *
 *   AC1 — a worktree was created for the story and the dev's changes are
 *         committed inside it, while `git -C <targetRepoRoot> status --porcelain`
 *         is clean of the dev's changes after the step.
 *   AC2 — an unrelated, pre-existing uncommitted change is NOT in the story
 *         commit (the commit stages an explicit dev-only path set, never
 *         `git add .`).
 *   AC3 — the PR is opened against the expected branch (the worktree's git
 *         context resolves the right repo) and no leftover worktree for the
 *         story remains registered after the step returns (success AND failure).
 *
 * vitest: plugins/crew/mcp-server/src/tools/__tests__/dev-worktree-isolation.test.ts
 */
export {};
