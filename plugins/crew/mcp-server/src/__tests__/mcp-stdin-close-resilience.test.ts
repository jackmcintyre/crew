/**
 * Integration test suite for MCP child stdin-close resilience (Story 5.12).
 *
 * These tests spawn the REAL dist/index.js as a child process and exercise the
 * process-level keep-alive fix. They do NOT use the SDK client; raw
 * line-delimited JSON-RPC 2.0 over stdio is sufficient and more representative
 * of what Claude Code actually sends.
 *
 * AC coverage:
 *   - AC1  / AC4a: child survives stdin close (spawn-and-survive)
 *   - AC2  / AC4b: stdout is still open after stdin close
 *   - AC3  / AC4c: SIGTERM still terminates the child after survival
 *   - AC4d: no premature exit on healthy steady-state (sanity check)
 *   - AC4e: no regression in tool dispatch (getStatus round-trip before any
 *           stdin manipulation)
 *   - AC4f: tests run against dist/index.js (the shipped artefact), not src/
 *
 * NOT covered here (out-of-scope for Story 5.12):
 *   - Re-attach after stdin re-open (deferred work)
 *   - New CallTool request succeeding AFTER stdin close (requires re-attach)
 *
 * Timeouts: individual tests that wait for the keep-alive window declare an
 * explicit { timeout: 30000 } to override vitest's 5-second default.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as cp from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Resolve dist/index.js path (AC4f)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.resolve(__dirname, "../../dist/index.js");

// ---------------------------------------------------------------------------
// Build dist if stale (mirrors dist-shipping-drift pattern from Story 1.9)
// ---------------------------------------------------------------------------

beforeAll(() => {
  try {
    cp.execSync("pnpm build", {
      cwd: path.resolve(__dirname, "../../"),
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    // If pnpm build fails, let the tests surface a useful spawn error.
    // eslint-disable-next-line no-console
    console.error("pnpm build failed in beforeAll:", (err as Error).message);
  }
}, 90_000);

// ---------------------------------------------------------------------------
// Helper: send a JSON-RPC 2.0 request and receive the next response line
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

/**
 * Write a JSON-RPC 2.0 request to child.stdin and resolve with the first
 * matching response line from child.stdout. The MCP SDK uses newline-delimited
 * JSON framing.
 *
 * @param child  - the spawned child process
 * @param req    - JSON-RPC request object
 * @param timeout - ms to wait for a response (default 8000)
 */
function sendRequest(
  child: cp.ChildProcess,
  req: JsonRpcRequest,
  timeout = 8_000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for response to id=${req.id}`));
    }, timeout);

    let buffer = "";

    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep the last potentially-incomplete line in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed["id"] === req.id) {
            clearTimeout(timer);
            child.stdout?.removeListener("data", onData);
            resolve(parsed as JsonRpcResponse);
            return;
          }
        } catch {
          // Non-JSON diagnostic output from CREW_MCP_DIAG — ignore
        }
      }
    };

    child.stdout?.on("data", onData);

    const line = JSON.stringify(req) + "\n";
    child.stdin?.write(line, (err) => {
      if (err) {
        clearTimeout(timer);
        child.stdout?.removeListener("data", onData);
        reject(err);
      }
    });
  });
}

/**
 * Wait for the MCP server to be ready by sending a tools/list request
 * and waiting for a successful response.
 */
async function waitForReady(
  child: cp.ChildProcess,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      await sendRequest(
        child,
        {
          jsonrpc: "2.0",
          id: 9000 + attempt,
          method: "tools/list",
          params: {},
        },
        Math.min(3_000, deadline - Date.now()),
      );
      return;
    } catch {
      attempt++;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("MCP server did not become ready within timeout");
}

// ---------------------------------------------------------------------------
// MCP initialisation handshake helpers
// ---------------------------------------------------------------------------

let _reqId = 1;

function nextId(): number {
  return _reqId++;
}

/**
 * Perform the MCP initialize / initialized handshake so that the server
 * enters READY state and will service tools/list and tools/call requests.
 */
async function doInitHandshake(child: cp.ChildProcess): Promise<void> {
  // 1. Send initialize
  const initRes = await sendRequest(
    child,
    {
      jsonrpc: "2.0",
      id: nextId(),
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

  // 2. Send the notifications/initialized notification (no response expected)
  const notification = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }) + "\n";
  child.stdin?.write(notification);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let child: cp.ChildProcess;

beforeEach(() => {
  _reqId = 1;
  child = cp.spawn("node", [DIST_INDEX], {
    stdio: ["pipe", "pipe", "pipe"],
  });
});

afterEach(() => {
  // Defensive teardown: kill the child even on test failure so a surviving
  // keep-alive child doesn't leak between tests.
  if (child && !child.killed) {
    child.kill("SIGKILL");
  }
});

// ---------------------------------------------------------------------------
// AC4e — no dispatcher regression (tool round-trip before any stdin manipulation)
// ---------------------------------------------------------------------------

describe("AC4e — tool dispatch is unaffected by the keep-alive setup", () => {
  it(
    "responds to tools/list before any stdin close",
    async () => {
      await doInitHandshake(child);

      const res = await sendRequest(child, {
        jsonrpc: "2.0",
        id: nextId(),
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

// ---------------------------------------------------------------------------
// AC4d — no premature exit on healthy steady-state
// ---------------------------------------------------------------------------

describe("AC4d — child does not exit during healthy steady-state", () => {
  it(
    "child remains alive for 5 seconds under normal operation",
    async () => {
      await doInitHandshake(child);

      let exited = false;
      child.on("exit", () => {
        exited = true;
      });

      // Wait 5 seconds — the child should not exit on its own
      await new Promise((r) => setTimeout(r, 5_000));
      expect(exited).toBe(false);
    },
    { timeout: 15_000 },
  );
});

// ---------------------------------------------------------------------------
// AC1 / AC4a — child survives stdin close
// ---------------------------------------------------------------------------

describe("AC1 / AC4a — child survives parent stdin close", () => {
  it(
    "child does NOT exit within 10 seconds after stdin is closed",
    async () => {
      await doInitHandshake(child);

      let exited = false;
      child.on("exit", () => {
        exited = true;
      });

      // Simulate parent stdin reap: end and destroy stdin
      child.stdin?.end();
      child.stdin?.destroy();

      // Wait 10 seconds — the fixed child must not exit
      await new Promise((r) => setTimeout(r, 10_000));

      expect(exited).toBe(false);
    },
    { timeout: 20_000 },
  );
});

// ---------------------------------------------------------------------------
// AC2 / AC4b — stdout is still open after stdin close
// ---------------------------------------------------------------------------

describe("AC2 / AC4b — stdout is not destroyed as a side-effect of stdin close", () => {
  it(
    "child stdout is still open (not destroyed) after stdin is closed",
    async () => {
      await doInitHandshake(child);

      // Close stdin
      child.stdin?.end();
      child.stdin?.destroy();

      // Brief pause to let any synchronous teardown propagate
      await new Promise((r) => setTimeout(r, 1_000));

      expect(child.stdout?.destroyed).toBe(false);
    },
    { timeout: 15_000 },
  );
});

// ---------------------------------------------------------------------------
// AC3 / AC4c — SIGTERM still terminates the child after it has survived stdin close
// ---------------------------------------------------------------------------

describe("AC3 / AC4c — SIGTERM terminates the child even after stdin close survival", () => {
  it(
    "child exits within 5 seconds of SIGTERM after surviving stdin close",
    async () => {
      await doInitHandshake(child);

      // First survive a stdin close (mirrors AC4a setup)
      child.stdin?.end();
      child.stdin?.destroy();

      // Give the child a moment to settle into the keep-alive state
      await new Promise((r) => setTimeout(r, 1_000));

      // Now send SIGTERM and assert it exits promptly
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      child.kill("SIGTERM");

      const { code, signal } = await Promise.race([
        exitPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SIGTERM did not kill child within 5 seconds")), 5_000),
        ),
      ]);

      // Conventional SIGTERM exit: code 143 (128+15), or signal='SIGTERM', or code 0
      const isExpectedExit =
        signal === "SIGTERM" || code === 143 || code === 0;
      expect(isExpectedExit).toBe(true);
    },
    { timeout: 20_000 },
  );
});
