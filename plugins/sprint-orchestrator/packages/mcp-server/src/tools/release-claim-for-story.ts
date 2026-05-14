import { findStory, replaceStory, updateSprintStatus } from "../state/sprint-status.js";
import { ClaimConflictError } from "../lib/errors.js";
import { type ToolContext } from "./context.js";

export interface ReleaseClaimResult {
  released: boolean;
  storyId: string;
  /** Present only when the story was already unclaimed (idempotent no-op). */
  alreadyFree?: boolean;
}

/**
 * Immediately reset a claimed story from `in_progress` back to `ready`,
 * but only when the supplied `agentId` matches the current claim holder.
 *
 * Designed for fast recovery when `prepareStoryBranch` fails right after
 * `claimStory` — before `releaseStaleClaims` would kick in.
 *
 * Behaviour:
 *  - If the story is `in_progress` and held by `agentId` → reset to `ready`,
 *    clear `claimed_by` / `claimed_at`, return `{ released: true }`.
 *  - If the story is not in `in_progress` (i.e. never claimed or already
 *    released) → idempotent no-op, return `{ released: true, alreadyFree: true }`.
 *  - If the story is `in_progress` but held by a different agent → throw
 *    `ClaimConflictError` to prevent cross-agent tampering.
 *
 * @throws StoryNotFoundError, ClaimConflictError, LockTimeoutError
 */
export async function releaseClaimForStory(
  ctx: ToolContext,
  storyId: string,
  agentId: string,
): Promise<ReleaseClaimResult> {
  return updateSprintStatus<ReleaseClaimResult>(ctx.sprintStatusPath, async (state) => {
    const story = findStory(state, storyId);

    // Idempotent: story is not in_progress — treat as already free.
    if (story.status !== "in_progress") {
      return {
        next: state,
        result: { released: true, storyId, alreadyFree: true },
      };
    }

    // Reject if a different agent holds the claim.
    const currentHolder = story.orchestrator.claimed_by;
    if (currentHolder !== agentId) {
      throw new ClaimConflictError(storyId, agentId, currentHolder);
    }

    // Clear the claim and flip back to ready.
    const rest = { ...story.orchestrator };
    delete rest.claimed_by;
    delete rest.claimed_at;

    const updated = {
      ...story,
      status: "ready" as const,
      orchestrator: rest,
    };

    return {
      next: replaceStory(state, updated),
      result: { released: true, storyId },
    };
  });
}
