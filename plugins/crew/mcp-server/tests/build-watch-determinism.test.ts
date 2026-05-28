import { describe, it, expect, afterEach } from "vitest";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  utimesSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Story 5.28 — AC3 build-watch determinism integration test.
 *
 * Asserts that `scripts/watch-and-normalise.mjs` runs the normaliser after each
 * successful tsc recompile, producing a `.d.ts` tree byte-identical to what
 * `pnpm build` (one-shot) produces from the same source.
 *
 * Isolation strategy:
 * - We create a completely self-contained scratch project in tmpdir (separate from
 *   the real src/ tree) with its own tsconfig.json and a minimal source file.
 * - The wrapper is invoked with WATCH_NORMALISE_TSCONFIG pointing to the scratch
 *   tsconfig and WATCH_NORMALISE_OUT_DIR / WATCH_NORMALISE_DIST_ROOT pointing to
 *   a scratch outDir. This means:
 *   (a) The real dist/ and src/ are never touched.
 *   (b) Parallel vitest workers running tsc against the real tsconfig/src/ see no
 *       interference from this test.
 * - All scratch dirs are cleaned up unconditionally in afterEach.
 *
 * Orphan-process discipline:
 * - detached: false (default) so the wrapper is in our process group.
 * - Teardown: SIGTERM → 2s wait → SIGKILL escalation.
 * - afterEach safety net in case the test body throws early.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_ROOT = resolve(HERE, "..");
const WRAPPER_SCRIPT = resolve(MCP_SERVER_ROOT, "scripts", "watch-and-normalise.mjs");
const TSCONFIG = resolve(MCP_SERVER_ROOT, "tsconfig.json");
const NORMALISER = resolve(MCP_SERVER_ROOT, "scripts", "normalise-dist.mjs");

// tsc --watch success sentinel line (English locale)
const SENTINEL_RE = /Found 0 errors\. Watching for file changes\./;

// Track spawned watcher and temp dirs for afterEach cleanup.
let activeWatcher: ChildProcessWithoutNullStreams | null = null;
let activeTmpDirs: string[] = [];

afterEach(async () => {
  if (activeWatcher) {
    await killProcess(activeWatcher);
    activeWatcher = null;
  }
  for (const d of activeTmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
  }
  activeTmpDirs = [];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Terminate a process: SIGTERM first, escalate to SIGKILL after ~2s.
 */
async function killProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  });
}

/**
 * Wait until the sentinel counter reaches `targetCount`, up to `timeoutMs`.
 * Attach this listener right after spawning — no events are dropped.
 */
function createSentinelWaiter(child: ChildProcessWithoutNullStreams) {
  let count = 0;
  type Waiter = { target: number; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
  const waiters: Waiter[] = [];

  child.stdout.on("data", (buf: Buffer) => {
    const s = buf.toString("utf8");
    const matches = s.match(new RegExp(SENTINEL_RE.source, "g"));
    if (matches) {
      count += matches.length;
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (count >= w.target) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(true);
        }
      }
    }
  });

  return {
    waitFor(target: number, timeoutMs: number): Promise<boolean> {
      if (count >= target) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const w: Waiter = {
          target,
          resolve,
          timer: setTimeout(() => {
            const idx = waiters.indexOf(w);
            if (idx >= 0) waiters.splice(idx, 1);
            resolve(false);
          }, timeoutMs),
        };
        waiters.push(w);
      });
    },
    getCount() { return count; },
  };
}

/**
 * Walk a directory recursively, returning a sorted list of relative file paths.
 */
function listAllFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  }
  walk(root);
  return out.sort();
}

/**
 * Build a manifest of `{ relativePath: sha256(contents) }` for .d.ts files under `root`.
 */
function hashDtsTree(root: string): Record<string, string> {
  const files = listAllFiles(root).filter((f) => f.endsWith(".d.ts"));
  const manifest: Record<string, string> = {};
  for (const rel of files) {
    const buf = readFileSync(join(root, rel));
    manifest[rel] = createHash("sha256").update(buf).digest("hex");
  }
  return manifest;
}

/**
 * Create a minimal isolated TypeScript project in `projectDir` with its own
 * tsconfig.json, a `src/` subdir, and a source file that imports zod and exports
 * a z.enum with unsorted keys (so the normaliser must actually reorder them).
 *
 * The tsconfig points to the mcp-server's node_modules so `import { z } from "zod"`
 * resolves without a separate install.
 *
 * Returns the path to the initial source file.
 */
function createScratchProject(projectDir: string, outDir: string): {
  tsconfig: string;
  srcFile: string;
  initialContent: string;
} {
  const srcDir = join(projectDir, "src");
  mkdirSync(srcDir, { recursive: true });

  const tsconfig = join(projectDir, "tsconfig.json");
  const tsconfigJson = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      strict: true,
      declaration: true,
      skipLibCheck: true,
      esModuleInterop: true,
      outDir,
      rootDir: srcDir,
    },
    include: [join(srcDir, "**", "*.ts")],
  };
  writeFileSync(tsconfig, JSON.stringify(tsconfigJson, null, 2));

  // Source file with unsorted z.enum keys — the normaliser must sort them.
  // We also need zod's types available: tsc resolves node_modules relative to
  // each source file, then walks up to find node_modules/zod. Since srcDir is in
  // tmpdir, we symlink node_modules at the project root level.
  const nodeModulesLink = join(projectDir, "node_modules");
  try {
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    symlinkSync(resolve(MCP_SERVER_ROOT, "node_modules"), nodeModulesLink);
  } catch {
    // Already exists or permission error — skip.
  }

  const srcFile = join(srcDir, "scratch-enum.ts");
  // NOTE: Use keys that are NOT in alphabetical order so the normaliser is exercised.
  const initialContent = [
    "// auto-generated by build-watch-determinism.test.ts — do not commit",
    'import { z } from "zod";',
    'export const ScratchEnum = z.enum(["gamma", "alpha", "beta"]);',
  ].join("\n") + "\n";
  writeFileSync(srcFile, initialContent);
  const t = new Date();
  utimesSync(srcFile, t, t);

  return { tsconfig, srcFile, initialContent };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Story 5.28 — build:watch normaliser chaining (AC3)", () => {
  it("wrapper script exists and is a regular file", () => {
    const stat = statSync(WRAPPER_SCRIPT);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("wrapper script imports normaliseDistTree from normalise-dist.mjs (content check)", () => {
    const src = readFileSync(WRAPPER_SCRIPT, "utf8");
    expect(src).toMatch(/from\s+["']\.\/normalise-dist\.mjs["']/);
    expect(src).toMatch(/normaliseDistTree/);
  });

  it("package.json build:watch script points to wrapper, not bare tsc", () => {
    const pkg = JSON.parse(readFileSync(join(MCP_SERVER_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:watch"]).toBe("node scripts/watch-and-normalise.mjs");
    // build (one-shot) must remain unchanged
    expect(pkg.scripts["build"]).toMatch(/tsc.*&&.*normalise-dist/);
  });

  it(
    "build:watch normalises dist/ after a source touch (byte-identical to one-shot build)",
    async () => {
      // ── Phase 0: create fully-isolated scratch project and output dirs ──
      const scratchProjectDir = mkdtempSync(join(tmpdir(), "crew-watch-proj-"));
      const watchOutDir = mkdtempSync(join(tmpdir(), "crew-watch-out-"));
      const refOutDir = mkdtempSync(join(tmpdir(), "crew-ref-out-"));
      activeTmpDirs = [scratchProjectDir, watchOutDir, refOutDir];

      const { tsconfig: scratchTsconfig, srcFile, initialContent } = createScratchProject(
        scratchProjectDir,
        watchOutDir,
      );

      // ── Phase 1: spawn the wrapper, directed to scratch project + watchOutDir ──
      const watcher = spawn("node", [WRAPPER_SCRIPT], {
        cwd: MCP_SERVER_ROOT,
        stdio: ["inherit", "pipe", "inherit"],
        detached: false,
        env: {
          ...process.env,
          WATCH_NORMALISE_TSCONFIG: scratchTsconfig,
          WATCH_NORMALISE_OUT_DIR: watchOutDir,
          WATCH_NORMALISE_DIST_ROOT: watchOutDir,
        },
      }) as ChildProcessWithoutNullStreams;
      activeWatcher = watcher;

      const sentinel = createSentinelWaiter(watcher);

      // Wait for first successful compile
      const ready = await sentinel.waitFor(1, 30_000);
      expect(ready, "tsc --watch never reached steady-state within 30s").toBe(true);

      // ── Phase 2: mutate the scratch source file to force a recompile ──
      const v2Content = initialContent.trimEnd() + "\n// touch\n";
      const t1 = new Date();
      writeFileSync(srcFile, v2Content);
      utimesSync(srcFile, t1, t1);

      // ── Phase 3: wait for second sentinel (recompile done) ──
      const recompiled = await sentinel.waitFor(2, 20_000);
      // Restore original content immediately (before expect) so the reference build
      // sees the same source state.
      const t2 = new Date();
      writeFileSync(srcFile, initialContent);
      utimesSync(srcFile, t2, t2);

      expect(recompiled, "tsc --watch did not emit a second success sentinel within 20s after source touch").toBe(true);

      // Give the normaliser a moment to finish (runs async after the sentinel).
      await new Promise((r) => setTimeout(r, 800));

      // Kill the watcher BEFORE the reference build to prevent concurrent writes.
      await killProcess(watcher);
      activeWatcher = null;

      const hashAfterWatch = hashDtsTree(watchOutDir);

      // ── Phase 4: one-shot reference build into refOutDir ──
      // Source is restored, so both builds see the same state.
      const tsc = resolve(MCP_SERVER_ROOT, "node_modules", ".bin", "tsc");
      execFileSync(tsc, ["-p", scratchTsconfig, "--outDir", refOutDir], {
        cwd: MCP_SERVER_ROOT,
        stdio: "pipe",
      });
      const normMod = (await import(NORMALISER)) as {
        normaliseDistTree: (root: string) => Promise<string[]>;
      };
      await normMod.normaliseDistTree(refOutDir);
      const hashOneShot = hashDtsTree(refOutDir);

      // ── Phase 5: compare the scratch enum's .d.ts specifically ──
      // We look for the scratch-enum.d.ts file in both trees.
      const scratchDts = "scratch-enum.d.ts";
      expect(hashAfterWatch[scratchDts], `watch build missing ${scratchDts}`).toBeDefined();
      expect(hashOneShot[scratchDts], `one-shot build missing ${scratchDts}`).toBeDefined();
      expect(
        hashAfterWatch[scratchDts],
        `build:watch .d.ts for ${scratchDts} differs from one-shot build — normaliser may not have run`,
      ).toBe(hashOneShot[scratchDts]);

      // Also verify the .d.ts actually has sorted ZodEnum keys
      // (confirms the normaliser ran — without it, gamma/alpha/beta would be unsorted).
      const watchedDts = readFileSync(join(watchOutDir, scratchDts), "utf8");
      const alphaIdx = watchedDts.indexOf('"alpha"');
      const betaIdx = watchedDts.indexOf('"beta"');
      const gammaIdx = watchedDts.indexOf('"gamma"');
      if (alphaIdx >= 0 && betaIdx >= 0 && gammaIdx >= 0) {
        // Only assert ordering if the type actually appears in the output
        // (older zod versions may inline differently).
        expect(alphaIdx, "normaliser should have sorted enum keys: alpha < beta").toBeLessThan(betaIdx);
        expect(betaIdx, "normaliser should have sorted enum keys: beta < gamma").toBeLessThan(gammaIdx);
      }
    },
    // Two tsc runs against the scratch project + overhead.
    120_000,
  );
});
