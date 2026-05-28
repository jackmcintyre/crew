#!/usr/bin/env node
// @ts-check
/**
 * Story 5.32 — post-build normaliser for the mcp-proxy package.
 *
 * What this does
 * --------------
 * After `tsc` emits `bin/*.js` (the proxy's compiled JS), this script:
 *   1. Finds the entry file (`bin/index.js`) and renames it to `bin/mcp-proxy.js`
 *      — the manifest at `plugins/crew/.claude-plugin/plugin.json` points at
 *      `mcp-proxy/bin/mcp-proxy.js` (AC4).
 *   2. Prepends `#!/usr/bin/env node\n` so the file is invokable directly by the
 *      Claude Code host as the MCP `command` (no `node` wrapper in the manifest).
 *   3. Sets mode `0755` so the executable bit is set (AC5).
 *
 * Idempotent: running twice produces the same output (the shebang is only
 * prepended if not already present; the rename is skipped if `mcp-proxy.js`
 * already exists and `index.js` does not).
 *
 * Why a script, not an esbuild banner: keeps the build toolchain tsc-only
 * (no new build-time deps), matches the existing `mcp-server/scripts/normalise-dist.mjs`
 * pattern, and is deterministic.
 */
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN_ROOT = path.resolve(__dirname, "..", "bin");

const SHEBANG = "#!/usr/bin/env node\n";

async function normalise() {
  const indexPath = path.join(BIN_ROOT, "index.js");
  const targetPath = path.join(BIN_ROOT, "mcp-proxy.js");

  // Rename index.js → mcp-proxy.js if the source exists and target does not yet
  // contain the new content. tsc may regenerate index.js on each build.
  let indexExists = false;
  try {
    await fs.access(indexPath);
    indexExists = true;
  } catch {
    /* index.js missing — already renamed, or tsc didn't run */
  }

  if (indexExists) {
    // Read the just-compiled index.js, write it to mcp-proxy.js with the shebang.
    const src = await fs.readFile(indexPath, "utf8");
    const withShebang = src.startsWith("#!") ? src : SHEBANG + src;
    await fs.writeFile(targetPath, withShebang);
    await fs.unlink(indexPath);
  } else {
    // No fresh index.js — ensure existing mcp-proxy.js has a shebang.
    try {
      const existing = await fs.readFile(targetPath, "utf8");
      if (!existing.startsWith("#!")) {
        await fs.writeFile(targetPath, SHEBANG + existing);
      }
    } catch {
      console.error(`normalise-dist (mcp-proxy): no bin/index.js and no bin/mcp-proxy.js — did tsc run?`);
      process.exit(1);
    }
  }

  // chmod 0755 — executable bit required by AC5.
  await fs.chmod(targetPath, 0o755);

  // Also normalise other emitted .js files (acquire-daemon.js, daemon-paths.js)
  // to ensure they keep mode 0644 (no exec bit needed; only the entry runs).
  const entries = await fs.readdir(BIN_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "mcp-proxy.js") continue;
    if (!entry.name.endsWith(".js")) continue;
    await fs.chmod(path.join(BIN_ROOT, entry.name), 0o644);
  }
}

normalise().catch((err) => {
  console.error("normalise-dist (mcp-proxy):", err);
  process.exit(1);
});
