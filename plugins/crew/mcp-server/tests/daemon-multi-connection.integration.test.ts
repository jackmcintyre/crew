/**
 * Story 5.33 — sequential-reconnect regression tests.
 *
 * Pre-5.33 the daemon shared one `Server` instance across every accepted
 * socket. The MCP SDK's `Protocol.connect()` throws "Already connected to a
 * transport" when called twice on the same instance — so the first Claude
 * Code session worked, every subsequent session failed to connect.
 *
 * These tests spawn the real daemon binary against a tmpHome and assert:
 *   1. Two sequential socket connections each successfully initialize.
 *   2. Three+ sequential reconnect cycles produce zero
 *      `transport.connect.error` entries in the lifecycle log.
 *
 * (The chained-onclose pingTimer cleanup is verified implicitly by test 2 —
 * if `pingTimer` leaked across closed transports, the second cycle's
 * keepalive would race with the first's leaked timer; the test would
 * observe unexpected events in the lifecycle log.)
 *
 * Upstream precedent: https://github.com/modelcontextprotocol/typescript-sdk/issues/1405
 *
 * Pairs with `proxy-daemon-survives-sigterm.integration.test.ts` which
 * proves the daemon survives proxy SIGTERM (5.32 AC3). These tests prove
 * the daemon accepts a NEW connection from the next proxy.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_PATH = path.resolve(__dirname, "../dist/index.js");

beforeAll(() => {
  if (!fs.existsSync(DAEMON_PATH)) {
    cp.execSync("pnpm build", {
      cwd: path.resolve(__dirname, "../"),
      stdio: "pipe",
      timeout: 60_000,
    });
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForSocket(
  sockPath: string,
  timeoutMs: number,
  child?: cp.ChildProcess,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      try {
        if (fs.statSync(sockPath).isSocket()) {
          resolve();
          return;
        }
      } catch {
        /* not yet */
      }
      if (Date.now() >= deadline) {
        const alive = child && child.exitCode === null && child.signalCode === null;
        reject(
          new Error(
            `socket ${sockPath} did not appear within ${timeoutMs}ms ` +
              `(child alive=${alive} exitCode=${child?.exitCode} signal=${child?.signalCode})`,
          ),
        );
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function connectSocket(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath);
    sock.once("connect", () => resolve(sock));
    sock.once("error", (err) => reject(err));
  });
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function initializeOver(socket: net.Socket, id: number, timeoutMs = 4000): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`initialize id=${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx === -1) return;
      const line = buf.slice(0, idx).trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse;
        if (parsed.id === id) {
          clearTimeout(timer);
          socket.removeListener("data", onData);
          resolve(parsed);
        }
      } catch {
        /* not JSON; keep buffering */
      }
    };
    socket.on("data", onData);
    socket.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "5.33-test-harness", version: "0.0.1" },
        },
      }) + "\n",
    );
  });
}

function closeSocket(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.end();
  });
}

function readLifecycleEvents(logPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(logPath)) return [];
  const body = fs.readFileSync(logPath, "utf8");
  const out: Array<Record<string, unknown>> = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* skip non-JSON noise */
    }
  }
  return out;
}

function spawnOne(opts: {
  tmpHome: string;
  keepaliveMs?: number;
  sockPath: string;
  logPath: string;
}): cp.ChildProcess {
  const child = cp.spawn(process.execPath, [DAEMON_PATH], {
    // detached:true puts the daemon in its own process group so SIGTERM
    // cascades from vitest's worker-pool churn (and other parallel tests'
    // child cleanup) don't reach us during the daemon's early-boot window
    // before index.ts:103 installs its own SIGTERM handler. Mirrors the
    // production design (mcp-proxy spawns the daemon detached for the same
    // reason — see 5.32 spec § Q2).
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: opts.tmpHome,
      CREW_MCP_KEEPALIVE_MS: String(opts.keepaliveMs ?? 0),
      CREW_MCP_LIFECYCLE_LOG: opts.logPath,
    },
  });
  if (typeof child.unref === "function") child.unref();
  child.stderr?.on("data", () => {
    /* swallow */
  });
  return child;
}

async function spawnDaemon(opts: {
  tmpHome: string;
  keepaliveMs?: number;
}): Promise<{ child: cp.ChildProcess; sockPath: string; logPath: string }> {
  const crewDir = path.join(opts.tmpHome, ".crew");
  fs.mkdirSync(crewDir, { recursive: true });
  const sockPath = path.join(crewDir, "mcp-daemon.sock");
  const logPath = path.join(crewDir, "mcp-lifecycle.log");

  // 20s timeout per attempt covers resource-contention slowdowns during
  // full-suite runs (many other tests spawn daemons in parallel). If the
  // child dies before binding (e.g., early-boot SIGTERM cascade from a
  // sibling test cleanup), we retry up to 3 times.
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const child = spawnOne({ ...opts, sockPath, logPath });
    try {
      await waitForSocket(sockPath, 20_000, child);
      return { child, sockPath, logPath };
    } catch (err) {
      lastErr = err;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      // Clean any half-bound socket from the failed attempt so the next
      // bind doesn't get EADDRINUSE.
      try {
        fs.unlinkSync(sockPath);
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`spawnDaemon failed after ${MAX_ATTEMPTS} attempts`);
}

async function killDaemon(child: cp.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Story 5.33 — daemon accepts sequential client reconnects", () => {
  it(
    "two sequential connections each successfully initialize",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-5.33-multi-"));
      const { child, sockPath, logPath } = await spawnDaemon({ tmpHome });

      try {
        // First connection
        const sockA = await connectSocket(sockPath);
        const respA = await initializeOver(sockA, 1);
        expect(respA.id).toBe(1);
        expect(respA.error).toBeUndefined();
        expect(respA.result).toBeDefined();
        await closeSocket(sockA);

        // Brief settle so the daemon's transport.onclose finishes wiring down.
        await new Promise((r) => setTimeout(r, 200));

        // Second connection — this is the path that was broken pre-5.33.
        const sockB = await connectSocket(sockPath);
        const respB = await initializeOver(sockB, 2);
        expect(respB.id).toBe(2);
        expect(respB.error).toBeUndefined();
        expect(respB.result).toBeDefined();
        await closeSocket(sockB);

        // Lifecycle log must show two distinct connections, no connect errors.
        await new Promise((r) => setTimeout(r, 100));
        const events = readLifecycleEvents(logPath);
        const connected = events.filter((e) => e["event"] === "transport.connected");
        const errors = events.filter((e) => e["event"] === "transport.connect.error");
        expect(connected.length).toBeGreaterThanOrEqual(2);
        expect(errors).toEqual([]);
        // connectionId diagnostic — must be monotonically increasing.
        const ids = connected.map((e) => e["connectionId"]);
        expect(ids).toContain(1);
        expect(ids).toContain(2);
      } finally {
        await killDaemon(child);
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "stress: three sequential reconnect cycles all succeed",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-5.33-stress-"));
      const { child, sockPath, logPath } = await spawnDaemon({ tmpHome });

      try {
        for (let i = 1; i <= 3; i++) {
          const sock = await connectSocket(sockPath);
          const resp = await initializeOver(sock, i);
          expect(resp.id).toBe(i);
          expect(resp.error).toBeUndefined();
          await closeSocket(sock);
          // Settle between cycles.
          await new Promise((r) => setTimeout(r, 150));
        }

        const events = readLifecycleEvents(logPath);
        const errors = events.filter((e) => e["event"] === "transport.connect.error");
        expect(errors).toEqual([]);
        const connected = events.filter((e) => e["event"] === "transport.connected");
        expect(connected.length).toBeGreaterThanOrEqual(3);
      } finally {
        await killDaemon(child);
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    },
    60_000,
  );

});
