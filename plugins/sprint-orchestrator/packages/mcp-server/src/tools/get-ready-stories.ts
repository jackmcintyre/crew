import { readSprintStatus } from "../state/sprint-status.js";
import { type Story } from "../state/schema.js";
import { type ToolContext } from "./context.js";

/**
 * Returns stories with `status: ready` whose dependencies are all `done`.
 * Excludes stories whose declared deps don't exist (treated as unmet).
 */
export async function getReadyStories(ctx: ToolContext): Promise<Story[]> {
  const state = await readSprintStatus(ctx.sprintStatusPath);
  const doneIds = new Set(state.stories.filter((s) => s.status === "done").map((s) => s.id));
  return state.stories.filter(
    (s) => s.status === "ready" && s.depends_on.every((d) => doneIds.has(d)),
  );
}
