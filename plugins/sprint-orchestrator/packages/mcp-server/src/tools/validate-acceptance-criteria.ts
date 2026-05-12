import { findStory, readSprintStatus } from "../state/sprint-status.js";
import { runChecks, type ValidationResult } from "../validators/acceptance.js";
import { type ToolContext } from "./context.js";

/**
 * Run all acceptance checks defined on the story. Pure: no state mutation.
 *
 * @throws StoryNotFoundError, StateNotFoundError, StateParseError
 */
export async function validateAcceptanceCriteria(
  ctx: ToolContext,
  storyId: string,
): Promise<ValidationResult> {
  const state = await readSprintStatus(ctx.sprintStatusPath);
  const story = findStory(state, storyId);
  return runChecks(story.acceptance_criteria.checks, { cwd: ctx.projectRoot });
}
