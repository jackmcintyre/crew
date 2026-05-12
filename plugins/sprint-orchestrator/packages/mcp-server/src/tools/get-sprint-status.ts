import { readSprintStatus } from "../state/sprint-status.js";
import { type SprintStatus } from "../state/schema.js";
import { type ToolContext } from "./context.js";

/** Read the entire sprint status file. */
export async function getSprintStatus(ctx: ToolContext): Promise<SprintStatus> {
  return readSprintStatus(ctx.sprintStatusPath);
}
