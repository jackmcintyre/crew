/**
 * Phrase-lock for the `process-backlog` skill's pr_per_story setup prompt.
 *
 * When `getOrInitConfig` detects that `pr_per_story` is not explicitly set
 * in the project config, it returns this prompt in `setupQuestions[]` so
 * the orchestrator skill can surface the choice to the user. The user's
 * answer is persisted via `setConfigPrPerStory`.
 *
 * The exact phrase below appears verbatim in SKILL.md and is asserted by
 * the e2e harness so the skill prose and the tool contract cannot drift.
 *
 * Story 5 of the mvp-polish sprint locks the wording.
 */
export const PR_PER_STORY_SETUP_PROMPT =
  "Should the orchestrator open a branch + PR per story (more reviewable, more GitHub churn), or let stories commit directly to the current working branch (faster, less inspectable)? Reply `yes` to enable per-story PRs or `no` to use shared-branch mode. This choice is persisted; you can change it later by editing `pr_per_story` in `.sprint-orchestrator/config.yaml`.";
