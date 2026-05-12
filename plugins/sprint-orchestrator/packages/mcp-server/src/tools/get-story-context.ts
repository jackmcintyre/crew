import * as path from "node:path";
import { promises as fs } from "node:fs";
import { findStory, readSprintStatus } from "../state/sprint-status.js";
import { type Story } from "../state/schema.js";
import { type ToolContext } from "./context.js";
import { getOrInitConfig } from "./get-or-init-config.js";

export interface StoryContext {
  story: Story;
  /** Resolved absolute paths to optional planning docs. Caller reads them as needed. */
  contextPaths: {
    prd?: string;
    architecture?: string;
    storyFile?: string;
  };
}

/**
 * Returns the story plus pointers to PRD/architecture/story-file paths drawn
 * from the orchestrator config. The dev agent uses its own Read tool to pull
 * what it needs from those files — we do not excerpt here.
 */
export async function getStoryContext(ctx: ToolContext, storyId: string): Promise<StoryContext> {
  const state = await readSprintStatus(ctx.sprintStatusPath);
  const story = findStory(state, storyId);

  const { config } = await getOrInitConfig(ctx);
  const contextPaths: StoryContext["contextPaths"] = {};
  if (config?.prdPath) contextPaths.prd = path.join(ctx.projectRoot, config.prdPath);
  if (config?.architecturePath)
    contextPaths.architecture = path.join(ctx.projectRoot, config.architecturePath);
  if (config?.storiesDir) {
    const candidate = path.join(ctx.projectRoot, config.storiesDir, `${storyId}.md`);
    if (await pathExists(candidate)) contextPaths.storyFile = candidate;
  }
  return { story, contextPaths };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
