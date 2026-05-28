/**
 * Integration test suite for MCP server keepalive ping (Story 5.25, AC7).
 *
 * Spawns the REAL dist/index.js with CREW_MCP_KEEPALIVE_MS=2000 and a tmp log
 * path. After 7 seconds, reads the log and asserts:
 *   - At least 3 keepalive.sent events
 *   - At least 1 keepalive.response event (proving the SDK auto-pong works)
 *
 * A second test verifies the disabled-by-zero contract:
 * CREW_MCP_KEEPALIVE_MS=0 → no keepalive.sent events within 5 seconds.
 *
 * The test fixture includes a tiny ping-responder loop on the client side
 * (this test acts as the MCP client). Without it, the server's server.ping()
 * request would hang and keepalive.response would never appear.
 *
 * AC coverage:
 *   - AC7a: 3+ keepalive.sent + 1+ keepalive.response after 7s with 2000ms interval
 *   - AC7b: no keepalive.sent within 5s when CREW_MCP_KEEPALIVE_MS=0
 *   - AC4f (inherited): tests run against dist/index.js
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Resolve dist/index.js path
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.resolve(__dirname, "../../dist/index.js");

// ---------------------------------------------------------------------------
// Build dist if stale
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

function sendRequest(
  child: cp.ChildProcess,
  req: JsonRpcRequest,
  timeout = 8_000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed["id"] === req.id) {
            cleanup();
            resolve(parsed as JsonRpcResponse);
            return;
          }
        } catch {
          // Non-JSON output — ignore
        }
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.removeListener("data", onData);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for response to id=${req.id}`));
    }, timeout);

    child.stdout?.on("data", onData);

    const line = JSON.stringify(req) + "\n";
    child.stdin?.write(line, (err) => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

/**
 * Install a ping-responder on the child's stdout that automatically answers
 * any incoming JSON-RPC ping requests with an empty result pong.
 *
 * The server (dist/index.js) sends `{jsonrpc:"2.0", id:X, method:"ping"}`.
 * As the client, we must reply with `{jsonrpc:"2.0", id:X, result:{}}`.
 *
 * Without this responder, server.ping() hangs, no keepalive.response event
 * is logged, and AC7a's response-side assertion fails.
 *
 * Returns a cleanup function that removes the listener.
 */
function installPingResponder(child: cp.ChildProcess): () => void {
  let buffer = "";

  const onData = (chunk: Buffer | string): void => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        // Answer ping requests (method === "ping", has an id)
        if (msg["method"] === "ping" && msg["id"] !== undefined) {
          const pong =
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg["id"],
              result: {},
            }) + "\n";
          child.stdin?.write(pong);
        }
      } catch {
        // Non-JSON — ignore
      }
    }
  };

  child.stdout?.on("data", onData);

  return () => {
    child.stdout?.removeListener("data", onData);
  };
}

async function doInitHandshake(child: cp.ChildProcess): Promise<void> {
  let id = 1;
  const initRes = await sendRequest(
    child,
    {
      jsonrpc: "2.0",
      id: id++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-harness", version: "0.0.1" },
      },
    },
    8_000,
  );

  if (initRes.error) {
    throw new Error(`initialize error: ${JSON.stringify(initRes.error)}`);
  }

  const notification =
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n";
  child.stdin?.write(notification);
}

function readLogLines(logPath: string): Record<string, unknown>[] {
  if (!fs.existsSync(logPath)) return [];
  const text = fs.readFileSync(logPath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let child: cp.ChildProcess;
let tmpDir: string;
let cleanupPingResponder: (() => void) | null = null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-keepalive-test-"));
  cleanupPingResponder = null;
});

afterEach(async () => {
  if (cleanupPingResponder) {
    cleanupPingResponder();
    cleanupPingResponder = null;
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  child?.stdout?.destroy();
  child?.stderr?.destroy();
  child?.stdin?.destroy();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// AC7a — keepalive.sent + keepalive.response appear in log
// ---------------------------------------------------------------------------

describe("AC7a — keepalive timer fires and pong is received", () => {
  it(
    "logs 3+ keepalive.sent and 1+ keepalive.response within 7 seconds (2000ms interval)",
    async () => {
      const logPath = path.join(tmpDir, "mcp-lifecycle.log");

      child = cp.spawn("node", [DIST_INDEX], {
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...process.env,
          CREW_MCP_LIFECYCLE_LOG: logPath,
          CREW_MCP_KEEPALIVE_MS: "2000", // ping every 2 seconds
        },
      });

      // Install ping responder BEFORE handshake so we don't miss early pings
      cleanupPingResponder = installPingResponder(child);

      await doInitHandshake(child);

      // Wait 7 seconds — should see at least 3 pings (at t=2, 4, 6)
      await new Promise((r) => setTimeout(r, 7_000));

      const lines = readLogLines(logPath);
      const sentEvents = lines.filter((l) => l["event"] === "keepalive.sent");
      const responseEvents = lines.filter((l) => l["event"] === "keepalive.response");

      expect(sentEvents.length).toBeGreaterThanOrEqual(3);
      expect(responseEvents.length).toBeGreaterThanOrEqual(1);
    },
    { timeout: 20_000 },
  );
});

// ---------------------------------------------------------------------------
// AC7b — disabled-by-zero contract
// ---------------------------------------------------------------------------

describe("AC7b — keepalive disabled when CREW_MCP_KEEPALIVE_MS=0", () => {
  it(
    "no keepalive.sent events appear within 5 seconds when interval is 0",
    async () => {
      const logPath = path.join(tmpDir, "mcp-lifecycle.log");

      child = cp.spawn("node", [DIST_INDEX], {
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...process.env,
          CREW_MCP_LIFECYCLE_LOG: logPath,
          CREW_MCP_KEEPALIVE_MS: "0",
        },
      });

      await doInitHandshake(child);

      // Wait 5 seconds — no pings should fire
      await new Promise((r) => setTimeout(r, 5_000));

      const lines = readLogLines(logPath);
      const sentEvents = lines.filter((l) => l["event"] === "keepalive.sent");
      const disabledEvents = lines.filter((l) => l["event"] === "keepalive.disabled");

      expect(sentEvents.length).toBe(0);
      // The server should log keepalive.disabled when interval is 0
      expect(disabledEvents.length).toBeGreaterThanOrEqual(1);
    },
    { timeout: 15_000 },
  );
});
