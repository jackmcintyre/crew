/**
 * `runDevSession` MCP tool — Story 4.3 Task 6.
 *
 * Single MCP-tool entry point for the entire `/crew:start` loop body
 * (outer claim-loop + inner dev → reviewer → rework cycle). The SKILL.md
 * prose is reduced to three MCP calls: `getStatus` (preflight),
 * `mintSessionUlid` (session ID), and `runDevSession` (the bundled loop body).
 *
 * The tool internally wires `runStartLoop` and `runDevReviewerCycle` with
 * production dependencies:
 *   - `listClaimableTodos` — enumerate claimable to-do manifests.
 *   - `claimStory` — atomic claim.
 *   - `buildPersonaSpawnPrompt` — persona prompt assembly (dev + reviewer).
 *   - The Claude Code `Task` tool (wrapped to capture transcript text).
 *   - `parseExecutionManifest` / `atomicWriteFile` — manifest reads/writes.
 *
 * `buildPersonaSpawnPrompt` is NOT an allowed MCP tool for the subagents —
 * it is wrapped by `runDevSession`'s internals and is not invoked from
 * SKILL.md prose.
 *
 * Architecture §MCP Tool Naming — camelCase verb-noun: `runDevSession`.
 * Story 4.3 Task 6.2.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { listClaimableTodos } from "./list-claimable-todos.js";
import { claimStory } from "./claim-story.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { parseExecutionManifest } from "../schemas/execution-manifest.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import { runStartLoop } from "../skills/start-loop.js";
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import type { TaskSpawnWithTranscriptArgs } from "../skills/dev-reviewer-cycle.js";

export interface RunDevSessionOptions {
  targetRepoRoot: string;
  sessionUlid: string;
  /**
   * Injectable Task-spawn function for testing. In production, the Claude
   * Code harness provides this via the `Task` tool. Tests pass a fake.
   */
  taskSpawnWithTranscript?: (
    args: TaskSpawnWithTranscriptArgs,
  ) => Promise<{ transcript: string }>;
}

export interface RunDevSessionResult {
  chatLog: string[];
}

/**
 * Run the full `/crew:start` session: outer claim-loop + inner dev → reviewer
 * → rework cycle. Returns the complete `chatLog` for the operator to read.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repo.
 * @param opts.sessionUlid - ULID minted by `mintSessionUlid` before this call.
 * @param opts.taskSpawnWithTranscript - Optional injectable Task-spawn seam
 *   (production callers omit this; tests supply a fake).
 */
export async function runDevSession(
  opts: RunDevSessionOptions,
): Promise<RunDevSessionResult> {
  const { targetRepoRoot, sessionUlid } = opts;

  // Production Task-spawn implementation: delegates to the Claude Code `Task`
  // tool via the harness. In tests, this is replaced by the injected fake.
  //
  // This is a placeholder that tests override via `opts.taskSpawnWithTranscript`.
  // In production, the MCP tool handler is responsible for wiring the real
  // Claude Code Task tool call here.
  const taskSpawnWithTranscript =
    opts.taskSpawnWithTranscript ??
    (async (_args: TaskSpawnWithTranscriptArgs) => {
      // Production: the Claude Code harness intercepts the Task tool.
      // This stub is never reached in a real harness environment because
      // the MCP tool's register.ts handler supplies the real implementation.
      return { transcript: "" };
    });

  const result = await runStartLoop({
    targetRepoRoot,
    sessionUlid,
    deps: {
      listTodos: (o) => listClaimableTodos(o),
      claim: (o) => claimStory(o),
      buildPrompt: (o) =>
        buildPersonaSpawnPrompt({
          targetRepoRoot: o.targetRepoRoot,
          role: o.role,
        }),
      taskSpawnWithTranscript,
    },
  });

  return { chatLog: result.chatLog };
}

/**
 * Read and parse an execution manifest from disk.
 * Exported for use by `run-dev-session.test.ts` fixtures.
 */
export async function readManifestFromDisk(
  absPath: string,
): Promise<ExecutionManifest> {
  const raw = await fs.readFile(absPath, "utf8");
  const parsed = yamlParse(raw) as unknown;
  return parseExecutionManifest(parsed, { absPath });
}

/**
 * Write an execution manifest back to disk atomically.
 * Exported for use by `run-dev-session.test.ts` fixtures.
 */
export async function writeManifestToDisk(
  absPath: string,
  manifest: ExecutionManifest,
): Promise<void> {
  const yaml = yamlStringify(manifest, { lineWidth: 0 });
  await atomicWriteFile(absPath, yaml);
}
