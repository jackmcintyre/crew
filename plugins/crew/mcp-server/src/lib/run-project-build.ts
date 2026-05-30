/**
 * `runProjectBuild` — Story 8.17.
 *
 * The pre-PR build gate's runner. `runDevTerminalAction` calls this AFTER the
 * dev's commit but BEFORE `gh pr create`, so a red build blocks the PR from ever
 * being opened (the #211 failure class — a story broke an untouched sibling file,
 * its story-scoped vitest passed in isolation, and a red PR was opened).
 *
 * The command and its working directory are DERIVED here, in one place, so the
 * derivation is assertable in a test and a future refactor cannot silently narrow
 * the gate to a partial / story-scoped build:
 *
 *   - command: `pnpm build` — the project's full build, i.e. the same command CI
 *     runs (.github/workflows/ci.yml `- run: pnpm build`, which fans out to
 *     `pnpm -r build` → `tsc -p tsconfig.json && node scripts/normalise-dist.mjs`
 *     for the mcp-server). This is a WHOLE-PROJECT type-check, not a subset, so it
 *     catches breakage in files the story did not touch.
 *   - cwd: `<devWorkingDir>/plugins/crew` — derived from the dev's working
 *     directory (the worktree when Story 8.16 isolation is on, else
 *     `targetRepoRoot`), matching CI's `working-directory: plugins/crew`. Pinning
 *     it to the dev's working directory is what makes the gate catch cross-file
 *     breakage the dev introduced, and lets this story compose with 8.16 in either
 *     order.
 *
 * The build is spawned through the SAME `execa` injection seam the rest of
 * `runDevTerminalAction` already uses (no second spawn mechanism), so the vitest
 * can stub it to simulate a passing / failing build without spawning a real one.
 */

import * as path from "node:path";
import { execa as defaultExeca } from "execa";

/**
 * The full-build command + args. Mirrors CI's `- run: pnpm build` step verbatim
 * (the `build` script in `plugins/crew/package.json` is `pnpm -r build`). Kept as
 * a named export so the test can assert the gate runs the project's full build
 * and not a story-scoped subset.
 */
export const PROJECT_BUILD_COMMAND = "pnpm" as const;
export const PROJECT_BUILD_ARGS: readonly string[] = ["build"] as const;

export interface ProjectBuildResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The absolute working directory the build ran in (`<devWorkingDir>/plugins/crew`). */
  cwd: string;
  /** The human-readable command line, for diagnostics (`pnpm build`). */
  commandLine: string;
}

/**
 * Derive the absolute working directory the full build runs in from the dev's
 * working directory. Exported so the test can assert the derivation directly
 * (AC3 — a future refactor must not silently narrow or relocate the gate).
 */
export function deriveProjectBuildCwd(devWorkingDir: string): string {
  return path.join(devWorkingDir, "plugins", "crew");
}

/**
 * Run the project's full build in the dev's working directory and return a
 * structured result (never throws on a non-zero build — the caller decides how
 * to surface a failure). `reject: false` mirrors the `gitPush` precedent so a
 * failing build comes back as a non-zero `exitCode` rather than an execa throw.
 *
 * @param opts.devWorkingDir  The dev's working directory (worktree or targetRepoRoot).
 * @param opts.execaImpl      Test seam — production callers omit this.
 */
export async function runProjectBuild(opts: {
  devWorkingDir: string;
  execaImpl?: typeof defaultExeca;
}): Promise<ProjectBuildResult> {
  const execaImpl = opts.execaImpl ?? defaultExeca;
  const cwd = deriveProjectBuildCwd(opts.devWorkingDir);

  const result = await execaImpl(PROJECT_BUILD_COMMAND, [...PROJECT_BUILD_ARGS], {
    cwd,
    reject: false,
  });

  return {
    exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    cwd,
    commandLine: `${PROJECT_BUILD_COMMAND} ${PROJECT_BUILD_ARGS.join(" ")}`,
  };
}
