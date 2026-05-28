/**
 * MCP daemon socket-disconnect + signal handling (Story 5.25 contract,
 * re-homed for Story 5.32's socket transport).
 *
 * Under Story 5.32 the daemon no longer reads JSON-RPC over stdio — it
 * listens on `~/.crew/mcp-daemon.sock` and the proxy shim forwards frames.
 * The original 5.25 AC5 ("on stdin close, daemon exits cleanly within 5s")
 * no longer applies because the daemon's stdio is `'ignore'` in the proxy's
 * spawn opts; there is no stdin to close.
 *
 * What still matters under D2:
 *   - Daemon remains alive when an MCP client (the proxy) disconnects the
 *     socket. The daemon's life is tied to SIGTERM via PID file, not to any
 *     individual client connection.
 *   - SIGTERM still cleanly exits the daemon (now with PID file cleanup).
 *   - Tool dispatch (tools/list) still works through the new transport.
 *
 * Previously preserved AC4d (no premature exit during steady-state) is
 * dropped because the AC's original threat — stdin-close zombie — is
 * structurally impossible under D2.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDaemonHarness, type DaemonHarness } from "./test-helpers/daemon-test-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.resolve(__dirname, "../../dist/index.js");

beforeAll(() => {
  try {
    cp.execSync("pnpm build", {
      cwd: path.resolve(__dirname, "../../"),
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    console.error("pnpm build failed in beforeAll:", (err as Error).message);
  }
}, 90_000);

let harness: DaemonHarness | undefined;

afterEach(async () => {
  if (harness) {
    await harness.close();
    harness = undefined;
  }
});

describe("AC4e — tool dispatch works through the socket transport", () => {
  it(
    "responds to tools/list after init handshake over the unix socket",
    async () => {
      harness = await spawnDaemonHarness({ distIndex: DIST_INDEX });
      await harness.initHandshake();

      const res = await harness.sendRequest({
        jsonrpc: "2.0",
        id: 1000,
        method: "tools/list",
        params: {},
      });

      expect(res.error).toBeUndefined();
      const tools = (res.result as { tools: unknown[] }).tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    },
    { timeout: 20_000 },
  );
});

describe("D2 contract — daemon survives client socket disconnect", () => {
  it(
    "daemon remains alive after the client socket is destroyed",
    async () => {
      harness = await spawnDaemonHarness({ distIndex: DIST_INDEX });
      await harness.initHandshake();

      let exited = false;
      harness.child.on("exit", () => {
        exited = true;
      });

      // Destroy the client socket; the daemon must NOT exit (it can serve
      // future connections from the same per-user proxy).
      harness.socket.destroy();
      await new Promise((r) => setTimeout(r, 1000));
      expect(exited).toBe(false);

      // Tear it down ourselves.
      harness.child.kill("SIGTERM");
    },
    { timeout: 15_000 },
  );
});

describe("AC4c — SIGTERM terminates the daemon cleanly", () => {
  it(
    "daemon exits within 5 seconds of SIGTERM",
    async () => {
      harness = await spawnDaemonHarness({ distIndex: DIST_INDEX });
      await harness.initHandshake();

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          harness!.child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      harness.child.kill("SIGTERM");

      const { code, signal } = await Promise.race([
        exitPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SIGTERM did not kill daemon within 5 seconds")), 5_000),
        ),
      ]);

      const isExpectedExit = signal === "SIGTERM" || code === 143 || code === 0;
      expect(isExpectedExit).toBe(true);
    },
    { timeout: 15_000 },
  );
});
