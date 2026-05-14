/**
 * Phrase-lock for the ship-gate empty-commit fallback.
 *
 * Some sprint stories are pure verification (the acceptance criteria all
 * pass already; the dev swing legitimately produces no code change). Under
 * `pr_per_story: true`, the per-story branch then has zero commits ahead
 * of its base — `gh pr create` returns "No commits between …" and the
 * orchestrator's state machine refuses `recordStorySuccess` because there
 * is no PR to point at.
 *
 * `commitStoryArtefacts` detects this structurally (working tree clean
 * AND the per-story branch is zero commits ahead of `base_branch`) and
 * lays down a single empty commit so the push + PR can proceed. The
 * commit subject is prefixed with the constant below so reviewers, log
 * scrapers, and tests can identify a ship-gate empty commit without
 * regexing free-form prose.
 *
 * Story 2 of the orchestrator-state-and-shipgate sprint (B8 fix) locks
 * this prefix.
 */
export const SHIP_GATE_EMPTY_COMMIT_MESSAGE_PREFIX = "chore(ship-gate):";

/**
 * Build the full empty-commit message for a given story id.
 *
 * Format: `chore(ship-gate): <storyId> verification only — see sprint state for AC results`
 */
export function shipGateEmptyCommitMessage(storyId: string): string {
  return `${SHIP_GATE_EMPTY_COMMIT_MESSAGE_PREFIX} ${storyId} verification only — see sprint state for AC results`;
}
