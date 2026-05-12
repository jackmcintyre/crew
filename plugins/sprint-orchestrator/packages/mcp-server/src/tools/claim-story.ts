import { findStory, replaceStory, updateSprintStatus } from "../state/sprint-status.js";
import { type ToolContext } from "./context.js";

export interface ClaimResult {
  claimed: boolean;
  holder?: string;
}

/**
 * Atomically claim a `ready` story for `agentId`. Returns `claimed: false`
 * (with current holder) if the story is no longer ready when the lock is held.
 *
 * @throws StoryNotFoundError, LockTimeoutError
 */
export async function claimStory(
  ctx: ToolContext,
  storyId: string,
  agentId: string,
): Promise<ClaimResult> {
  return updateSprintStatus<ClaimResult>(ctx.sprintStatusPath, async (state) => {
    const story = findStory(state, storyId);
    if (story.status !== "ready") {
      const result: ClaimResult = { claimed: false, holder: story.orchestrator.claimed_by };
      return { next: state, result };
    }
    const updated = {
      ...story,
      status: "in_progress" as const,
      orchestrator: {
        ...story.orchestrator,
        claimed_by: agentId,
        claimed_at: new Date().toISOString(),
      },
    };
    const result: ClaimResult = { claimed: true };
    return { next: replaceStory(state, updated), result };
  });
}
