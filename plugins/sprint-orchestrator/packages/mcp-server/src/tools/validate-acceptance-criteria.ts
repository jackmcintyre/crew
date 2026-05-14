import { findStory, readSprintStatus } from "../state/sprint-status.js";
import { runChecks, type ValidationResult } from "../validators/acceptance.js";
import { DevNotReturnedError } from "../lib/errors.js";
import { type ToolContext } from "./context.js";

/**
 * Run all acceptance checks defined on the story. Pure: no state mutation.
 *
 * Refuses with `DevNotReturnedError` when `orchestrator.dev_returned_at` is
 * absent — the dev subagent must call `markDevReturned` before the reviewer
 * evaluates ACs, so we never evaluate against a pre-dev state.
 *
 * @throws StoryNotFoundError, StateNotFoundError, StateParseError, DevNotReturnedError
 */
export async function validateAcceptanceCriteria(
  ctx: ToolContext,
  storyId: string,
): Promise<ValidationResult> {
  const state = await readSprintStatus(ctx.sprintStatusPath);
  const story = findStory(state, storyId);
  if (!story.orchestrator.dev_returned_at) {
    throw new DevNotReturnedError(storyId);
  }
  return runChecks(story.acceptance_criteria.checks, { cwd: ctx.projectRoot });
}
