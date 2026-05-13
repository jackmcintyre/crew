import { findStory, replaceStory, updateSprintStatus } from "../state/sprint-status.js";
import { commitSprintState } from "../lib/commit-state.js";
import { type ToolContext } from "./context.js";

export interface MarkStoryFailedResult {
  status: "failed";
  failed_at: string;
}

/**
 * Mark a story as `failed` with the supplied reason. Never retries silently;
 * the human (or a later run) decides what to do next.
 *
 * Note: `failed` means the orchestrator gave up on this story. It is distinct
 * from `blocked`, which is reserved for stories waiting on an external signal.
 *
 * Returns the new status + failure timestamp so MCP callers can surface them
 * in their replies.
 *
 * @throws StoryNotFoundError, LockTimeoutError
 */
export async function markStoryFailed(
  ctx: ToolContext,
  storyId: string,
  reason: string,
): Promise<MarkStoryFailedResult> {
  const failed_at = new Date().toISOString();
  await updateSprintStatus(ctx.sprintStatusPath, async (state) => {
    const story = findStory(state, storyId);
    const updated = {
      ...story,
      status: "failed" as const,
      orchestrator: {
        ...story.orchestrator,
        last_failure_reason: reason,
        failed_at,
      },
    };
    return { next: replaceStory(state, updated), result: undefined };
  });

  // Persist the state mutation as its own commit; idempotent when clean.
  await commitSprintState(ctx.projectRoot, `chore(sprint): persist ${storyId} failure`);

  return { status: "failed", failed_at };
}
