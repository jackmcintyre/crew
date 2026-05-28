/**
 * Integration test suite for MCP child stdin-close behaviour (Story 5.25, AC5).
 *
 * These tests spawn the REAL dist/index.js as a child process and exercise the
 * new contract: on stdin close, the child exits CLEANLY (exit code 0) within
 * 5 seconds. Story 5.12's "survive stdin close" contract is inverted here
 * because Story 5.25 removed the zombie-keeping keep-alive in favour of the
 * spec-aligned approach (keepalive pings prevent the trigger; clean exit when
 * shutdown happens).
 *
 * AC coverage (Story 5.25):
 *   - AC5  / new-4a: on stdin close, child exits cleanly within 5 seconds (exit code 0)
 *   - AC4c (preserved): SIGTERM still terminates the child
 *   - AC4d (preserved): no premature exit during healthy steady-state (5-second window)
 *   - AC4e (preserved): no regression in tool dispatch (getStatus round-trip)
 *   - AC4f (preserved): tests run against dist/index.js (the shipped artefact), not src/
 *
 * NOT preserved from Story 5.12:
 *   - Old AC1/AC4a: "child survives stdin close" — inverted; clean exit is now the contract
 *   - Old AC2/AC4b: "stdout open after stdin close" — no longer a meaningful invariant
 *
 * Timeouts: individual tests declare explicit { timeout: ... } values.
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
          // Non-JSON diagnostic output — ignore
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

  const notification =
    JSON.stringify({
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
    env: {
      ...process.env,
      // Disable keepalive so it doesn't hold the event loop for these tests
      CREW_MCP_KEEPALIVE_MS: "0",
      // Route lifecycle log to /dev/null to avoid creating ~/.crew in CI
      CREW_MCP_LIFECYCLE_LOG: "/dev/null",
    },
  });
});

afterEach(() => {
  if (child && !child.killed) {
    child.kill("SIGKILL");
  }
});

// ---------------------------------------------------------------------------
// AC4e — no dispatcher regression (tool round-trip before any stdin manipulation)
// ---------------------------------------------------------------------------

describe("AC4e — tool dispatch is unaffected by the lifecycle logging setup", () => {
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
// AC5 / new-AC4a — child exits CLEANLY on stdin close (new contract)
// Story 5.25 inverts Story 5.12's "survive stdin close" assertion.
// Per MCP spec, stdin close is the client's shutdown signal; the server
// should honour it and exit cleanly (code 0) rather than surviving as a zombie.
// ---------------------------------------------------------------------------

describe("AC5 — child exits cleanly on stdin close (Story 5.25 new contract)", () => {
  it(
    "child exits with code 0 within 5 seconds after stdin is closed",
    async () => {
      await doInitHandshake(child);

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      // Simulate parent stdin reap: end stdin
      child.stdin?.end();

      const result = await Promise.race([
        exitPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Child did not exit within 5 seconds after stdin close")),
            5_000,
          ),
        ),
      ]);

      // Expect clean exit: code 0, no signal
      expect(result.signal).toBeNull();
      expect(result.code).toBe(0);
    },
    { timeout: 15_000 },
  );
});

// ---------------------------------------------------------------------------
// AC4c (preserved) — SIGTERM terminates the child
// This contract holds regardless of the stdin-close behaviour change.
// ---------------------------------------------------------------------------

describe("AC4c — SIGTERM terminates the child", () => {
  it(
    "child exits within 5 seconds of SIGTERM",
    async () => {
      await doInitHandshake(child);

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

      // Conventional SIGTERM exit: code 143 (128+15) from our handler, or
      // signal='SIGTERM' if the OS reports it that way
      const isExpectedExit =
        signal === "SIGTERM" || code === 143 || code === 0;
      expect(isExpectedExit).toBe(true);
    },
    { timeout: 15_000 },
  );
});
