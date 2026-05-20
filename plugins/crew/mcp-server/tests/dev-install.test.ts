/**
 * Story 1.11 — Dev-install loop: make plugin changes visible without a daemon restart.
 * AC6 (content-anchor) + AC7 (integration scenario).
 *
 * See plugins/crew/docs/dev-loop.md for the operator-facing documentation of the
 * script this harness validates.
 *
 * AC6 — content-anchor test (hermetic file-existence + substring assertions):
 *   1. `plugins/crew/scripts/dev-install.sh` is executable.
 *   2. The script source contains the substring `$HOME/.claude/plugins/cache/crew/crew`
 *      proving it targets the right cache location.
 *   3. `plugins/crew/docs/dev-loop.md` exists and contains the substring
 *      `pnpm --dir plugins/crew dev:install` proving docs and reality stay in sync.
 *
 * AC7 — integration scenario (hermetic, temp dirs, simulated git repo):
 *   1. First run populates the cache (symlink created, resolves to source).
 *   2. Second run is a no-op (mtime of symlink unchanged).
 *   3. Edit propagation — changes in the source are immediately visible via the cache
 *      (because the cache IS a symlink to the source, not a copy).
 *
 * The actual Claude Code daemon interaction is out of scope — verified by the story's
 * user-surface smoke gate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  statSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/ -> mcp-server -> crew -> plugins -> repo root
const REPO_ROOT = resolve(HERE, "../../../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "plugins/crew/scripts/dev-install.sh");
const DEV_LOOP_DOC = resolve(REPO_ROOT, "plugins/crew/docs/dev-loop.md");

// ── AC6: content-anchor tests ────────────────────────────────────────────────

describe("dev-install.sh content-anchor (Story 1.11 AC6)", () => {
  it("script file exists and is executable", () => {
    const mode = statSync(SCRIPT_PATH).mode;
    // 0o111 = owner+group+other execute bits
    expect(mode & 0o111).toBeTruthy();
  });

  it("script contains the cache path substring targeting the right location", () => {
    const content = readFileSync(SCRIPT_PATH, "utf8");
    // The script uses $HOME/.claude/plugins/cache/crew/crew in its printed output
    // and variable assignments. This substring proves it targets the correct cache.
    expect(content).toContain("$HOME/.claude/plugins/cache/crew/crew");
  });

  it("dev-loop.md exists and contains the canonical pnpm dev:install command", () => {
    expect(existsSync(DEV_LOOP_DOC)).toBe(true);
    const content = readFileSync(DEV_LOOP_DOC, "utf8");
    // The canonical operator-typed command (Task 3.3 wired form).
    expect(content).toContain("pnpm --dir plugins/crew dev:install");
  });
});

// ── AC7: integration scenario ────────────────────────────────────────────────

/**
 * Creates a minimal git repo simulating `<worktree-root>/plugins/crew/`.
 * Returns { repoRoot, pluginsCrewDir, cacheParent }.
 */
function makeTempEnvironment(): {
  repoRoot: string;
  pluginsCrewDir: string;
  cacheParent: string;
  cleanup: () => Promise<void>;
} {
  const base = mkdtempSync(resolve(tmpdir(), "crew-dev-install-"));
  const repoRoot = resolve(base, "repo");
  const pluginsCrewDir = resolve(repoRoot, "plugins", "crew");
  const cacheParent = resolve(base, "home");

  // Create the source plugin tree.
  mkdirSync(resolve(pluginsCrewDir, ".claude-plugin"), { recursive: true });
  mkdirSync(resolve(pluginsCrewDir, "mcp-server", "dist"), { recursive: true });
  mkdirSync(resolve(pluginsCrewDir, "skills", "sentinel"), { recursive: true });

  writeFileSync(
    resolve(pluginsCrewDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "crew", version: "0.0.0-test", description: "test" }),
  );
  writeFileSync(
    resolve(pluginsCrewDir, "mcp-server", "dist", "index.js"),
    "// test stub\n",
  );
  writeFileSync(
    resolve(pluginsCrewDir, "skills", "sentinel", "SKILL.md"),
    "# Sentinel skill\nOriginal content.\n",
  );

  // Initialise as a git repo so `git rev-parse --show-toplevel` works.
  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@test.com"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", repoRoot, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "init"], { stdio: "pipe" });

  // Create a HOME-like dir that the script will use for cache resolution.
  mkdirSync(cacheParent, { recursive: true });

  return {
    repoRoot,
    pluginsCrewDir,
    cacheParent,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

function runScript(
  repoRoot: string,
  homeDir: string,
  extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync("sh", [SCRIPT_PATH, ...extraArgs], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      // Ensure git is usable in the temp dir.
      GIT_CONFIG_NOSYSTEM: "1",
    },
    encoding: "utf8",
  });
}

describe("dev-install.sh integration scenario (Story 1.11 AC7)", () => {
  let env: ReturnType<typeof makeTempEnvironment>;

  beforeEach(() => {
    env = makeTempEnvironment();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("AC7-1: first run creates a symlink from cache to the source dir", () => {
    const result = runScript(env.repoRoot, env.cacheParent);
    expect(result.status).toBe(0);

    const expectedCache = resolve(
      env.cacheParent,
      ".claude",
      "plugins",
      "cache",
      "crew",
      "crew",
      "0.0.0-test",
    );
    // The cache entry must be a symlink.
    const stat = statSync(expectedCache);
    // lstatSync would be clearer, but statSync follows symlinks — use lstat to check symlink.
    const { lstatSync } = require("node:fs");
    const lstat = lstatSync(expectedCache);
    expect(lstat.isSymbolicLink()).toBe(true);

    // The symlink must resolve to the source plugins/crew dir.
    // Use realpathSync on both sides to handle macOS /var → /private/var aliasing.
    const resolved = realpathSync(expectedCache);
    const expectedReal = realpathSync(env.pluginsCrewDir);
    expect(resolved).toBe(expectedReal);

    // Success line must contain the cache path literal.
    expect(result.stdout).toContain(".claude/plugins/cache/crew/crew");
  });

  it("AC7-2: second run is a no-op (symlink mtime unchanged)", () => {
    // First run.
    runScript(env.repoRoot, env.cacheParent);

    const expectedCache = resolve(
      env.cacheParent,
      ".claude",
      "plugins",
      "cache",
      "crew",
      "crew",
      "0.0.0-test",
    );
    const { lstatSync } = require("node:fs");
    const mtimeBefore = lstatSync(expectedCache).mtimeMs;

    // Second run — no source changes.
    const result2 = runScript(env.repoRoot, env.cacheParent);
    expect(result2.status).toBe(0);
    expect(result2.stdout).toContain("already up to date");

    const mtimeAfter = lstatSync(expectedCache).mtimeMs;
    // The symlink itself was NOT recreated (mtime unchanged).
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("AC7-3: edit propagation — changes in source are immediately visible via cache (symlink)", () => {
    // First run.
    runScript(env.repoRoot, env.cacheParent);

    const expectedCache = resolve(
      env.cacheParent,
      ".claude",
      "plugins",
      "cache",
      "crew",
      "crew",
      "0.0.0-test",
    );

    // Modify the sentinel skill in the source.
    const skillPath = resolve(env.pluginsCrewDir, "skills", "sentinel", "SKILL.md");
    writeFileSync(skillPath, "# Sentinel skill\nEdited content — UPDATED.\n");

    // Because cache is a symlink, the change is immediately visible without re-running the script.
    const cacheSkillPath = resolve(expectedCache, "skills", "sentinel", "SKILL.md");
    const content = readFileSync(cacheSkillPath, "utf8");
    expect(content).toContain("UPDATED");

    // Running the script again still reports no-op (symlink already correct).
    const result2 = runScript(env.repoRoot, env.cacheParent);
    expect(result2.status).toBe(0);
  });

  it("AC7 error path: exits 3 when dist/index.js is missing", () => {
    const { rmSync } = require("node:fs");
    rmSync(resolve(env.pluginsCrewDir, "mcp-server", "dist", "index.js"));

    const result = runScript(env.repoRoot, env.cacheParent);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("dist/index.js not found");
  });
});
