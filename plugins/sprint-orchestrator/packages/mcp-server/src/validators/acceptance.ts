import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type Check } from "../state/schema.js";

export type CheckResult =
  | { type: "shell"; cmd: string; passed: boolean; exit_code: number; output: string }
  | { type: "file_exists"; path: string; passed: boolean }
  | { type: "regex"; cmd: string; pattern: string; passed: boolean; output: string };

export type ValidationResult = { passed: boolean; results: CheckResult[] };

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface RunCheckOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a single check. Pure with respect to the project state — no mutations
 * to the sprint status file or anywhere else.
 */
export async function runCheck(check: Check, opts: RunCheckOptions = {}): Promise<CheckResult> {
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = opts.env ?? process.env;

  switch (check.type) {
    case "file_exists": {
      const resolved = path.isAbsolute(check.path) ? check.path : path.join(cwd, check.path);
      try {
        await fs.access(resolved);
        return { type: "file_exists", path: check.path, passed: true };
      } catch {
        return { type: "file_exists", path: check.path, passed: false };
      }
    }
    case "shell": {
      const { exitCode, output } = await runShell(check.cmd, { cwd, timeoutMs, env });
      return {
        type: "shell",
        cmd: check.cmd,
        passed: exitCode === check.expect_exit,
        exit_code: exitCode,
        output,
      };
    }
    case "regex": {
      const { output } = await runShell(check.cmd, { cwd, timeoutMs, env });
      const re = new RegExp(check.pattern);
      return {
        type: "regex",
        cmd: check.cmd,
        pattern: check.pattern,
        passed: re.test(output),
        output,
      };
    }
  }
}

export async function runChecks(
  checks: Check[],
  opts: RunCheckOptions = {},
): Promise<ValidationResult> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check, opts));
  }
  return { passed: results.every((r) => r.passed), results };
}

async function runShell(
  cmd: string,
  opts: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], { cwd: opts.cwd, env: opts.env });
    let output = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: killed ? 124 : (code ?? 1), output });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `${output}${(err as Error).message}` });
    });
  });
}
