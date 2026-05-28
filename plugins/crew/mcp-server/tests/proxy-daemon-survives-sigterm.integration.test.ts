/**
 * Story 5.32 — AC3: end-to-end integration test.
 *
 * Drives the real proxy script (`plugins/crew/mcp-proxy/bin/mcp-proxy.js`)
 * against the real built MCP daemon (`plugins/crew/mcp-server/dist/index.js`).
 *
 *   1. Spawn the proxy with stdio piped.
 *   2. Send one JSON-RPC `initialize` request via stdin; await response on stdout.
 *   3. Read the daemon's pid from the PID file under tmpHome/.crew/.
 *   4. SIGTERM the proxy.
 *   5. Wait 2 seconds.
 *   6. Assert: process.kill(daemonPid, 0) succeeds AND the daemon's ppid is 1
 *      (reparented to init — Q2's evidence-confirmed transition on darwin).
 *
 * Test is darwin-only per the spike's platform scoping; Linux/Windows are out
 * of scope for v1.1.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = path.resolve(__dirname, "../../mcp-proxy/bin/mcp-proxy.js");
const DAEMON_PATH = path.resolve(__dirname, "../dist/index.js");

beforeAll(() => {
  // Build both packages if their artefacts are missing. The reviewer-side
  // pre-PR gate also runs pnpm build, but vitest is sometimes invoked in
  // isolation by the dev loop.
  if (!fs.existsSync(PROXY_PATH)) {
    cp.execSync("pnpm build", {
      cwd: path.resolve(__dirname, "../../mcp-proxy"),
      stdio: "pipe",
      timeout: 60_000,
    });
  }
  if (!fs.existsSync(DAEMON_PATH)) {
    cp.execSync("pnpm build", {
      cwd: path.resolve(__dirname, "../"),
      stdio: "pipe",
      timeout: 60_000,
    });
  }
}, 120_000);

function waitForPidFile(pidPath: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      try {
        const raw = fs.readFileSync(pidPath, "utf8").trim();
        const pid = Number(raw);
        if (Number.isFinite(pid) && pid > 0) {
          resolve(pid);
          return;
        }
      } catch {
        /* not yet */
      }
      if (Date.now() >= deadline) {
        reject(new Error(`pid file ${pidPath} did not appear within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function readPpidDarwin(pid: number): number {
  const out = cp.execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8" }).trim();
  return Number(out);
}

describe.skipIf(process.platform !== "darwin")("AC3 — daemon survives proxy SIGTERM", () => {
  it(
    "real proxy + real daemon: daemon's ppid flips to 1 after proxy SIGTERM, daemon still alive",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-d2-integration-"));
      const crewDir = path.join(tmpHome, ".crew");
      const pidPath = path.join(crewDir, "mcp-daemon.pid");

      const proxy = cp.spawn(process.execPath, [PROXY_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HOME: tmpHome,
          CREW_MCP_KEEPALIVE_MS: "0",
        },
      });

      proxy.stderr?.on("data", () => {
        /* swallow noise; the test asserts via files + signals */
      });

      let daemonPid: number = 0;
      try {
        // Wait for the daemon to start and write its pid file. Allow up to 6s —
        // first spawn includes node startup + socket bind.
        daemonPid = await waitForPidFile(pidPath, 6000);

        // Send an initialize request through the proxy. Connect a parser to
        // stdout to await the response (line-delimited JSON).
        const responsePromise = new Promise<string>((resolve, reject) => {
          let buf = "";
          const onData = (chunk: Buffer): void => {
            buf += chunk.toString("utf8");
            const idx = buf.indexOf("\n");
            if (idx !== -1) {
              proxy.stdout?.removeListener("data", onData);
              resolve(buf.slice(0, idx));
            }
          };
          proxy.stdout?.on("data", onData);
          setTimeout(() => reject(new Error("initialize response timeout")), 4000);
        });

        proxy.stdin?.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test-harness", version: "0.0.1" },
            },
          }) + "\n",
        );
        const responseLine = await responsePromise;
        const response = JSON.parse(responseLine) as { id: number; result?: unknown; error?: unknown };
        expect(response.id).toBe(1);
        expect(response.error).toBeUndefined();

        // SIGTERM the proxy. The daemon must NOT die because it's in a
        // different process group (Q2's verdict).
        const proxyExited = new Promise<void>((resolve) => {
          proxy.on("exit", () => resolve());
        });
        process.kill(proxy.pid!, "SIGTERM");
        await proxyExited;

        // Wait 2s for darwin to reparent the daemon to init.
        await new Promise((r) => setTimeout(r, 2000));

        // Assert: daemon still alive.
        let alive = true;
        try {
          process.kill(daemonPid, 0);
        } catch {
          alive = false;
        }
        expect(alive).toBe(true);

        // Assert: daemon reparented to init (ppid === 1). Q2 confirmed this
        // transition happens within ~3s post-SIGTERM on darwin.
        const ppid = readPpidDarwin(daemonPid);
        expect(ppid).toBe(1);
      } finally {
        // Cleanup: SIGKILL the daemon, rm -rf tmpHome.
        if (daemonPid > 0) {
          try {
            process.kill(daemonPid, "SIGKILL");
          } catch {
            /* already dead */
          }
        }
        try {
          fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
    15_000,
  );
});

// Make sure the test file does not silently no-op on non-darwin platforms in
// `pnpm test` runs — vitest reports skipped tests in the summary which is the
// signal we want.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ = net;
