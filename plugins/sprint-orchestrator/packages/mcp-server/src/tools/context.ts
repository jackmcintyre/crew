import * as path from "node:path";

export interface ToolContext {
  /** Project root the plugin operates in (cwd by default). */
  projectRoot: string;
  /** Absolute path to sprint-status.yaml. */
  sprintStatusPath: string;
  /** Absolute path to .sprint-orchestrator/config.yaml. */
  configPath: string;
}

export function defaultContext(projectRoot: string = process.cwd()): ToolContext {
  return {
    projectRoot,
    sprintStatusPath: path.join(projectRoot, "sprint-status.yaml"),
    configPath: path.join(projectRoot, ".sprint-orchestrator", "config.yaml"),
  };
}
