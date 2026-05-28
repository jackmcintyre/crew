/**
 * Story 5.32 — AC4 + AC5 artifact checks.
 *
 * AC4: plugin.json's mcpServers.crew.command points at the proxy script.
 * AC5: mcp-proxy/bin/mcp-proxy.js exists, starts with #!/usr/bin/env node,
 *      and has the executable bit set.
 *
 * These are deterministic artifact assertions — no spawn, no network. They
 * complement the `artifact:` AC markers by giving the reviewer a vitest
 * signal for the same files.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "../../../");
const MANIFEST_PATH = path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
const PROXY_PATH = path.join(PLUGIN_ROOT, "mcp-proxy", "bin", "mcp-proxy.js");

describe("AC4 — plugin.json points at proxy", () => {
  it("mcpServers.crew.command equals ${CLAUDE_PLUGIN_ROOT}/mcp-proxy/bin/mcp-proxy.js", () => {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw) as {
      mcpServers: { crew: { command: string; cwd?: string; args?: string[] } };
    };
    expect(manifest.mcpServers.crew.command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/mcp-proxy/bin/mcp-proxy.js",
    );
    // The proxy resolves its daemon path internally; no `args` should remain.
    expect(manifest.mcpServers.crew.args).toBeUndefined();
  });

  it("preserves the cwd field", () => {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw) as {
      mcpServers: { crew: { cwd?: string } };
    };
    expect(manifest.mcpServers.crew.cwd).toBe("${CLAUDE_PLUGIN_ROOT}");
  });
});

describe("AC5 — proxy script artifact exists, shebanged, executable", () => {
  it("file exists at plugins/crew/mcp-proxy/bin/mcp-proxy.js", () => {
    expect(fs.existsSync(PROXY_PATH)).toBe(true);
  });

  it("starts with #!/usr/bin/env node", () => {
    const src = fs.readFileSync(PROXY_PATH, "utf8");
    expect(src.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("has the executable bit set (mode & 0o111 truthy)", () => {
    const mode = fs.statSync(PROXY_PATH).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});
