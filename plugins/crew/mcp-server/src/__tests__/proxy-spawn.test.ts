/**
 * Story 5.32 — AC1: proxy shim spawn path (detached child + JSON-RPC
 * initialize forward).
 *
 * Asserts that the proxy's `acquireDaemon` factory:
 *   (a) spawns the daemon with `{ detached: true, stdio: 'ignore' }`
 *   (b) calls `child.unref()` on the returned ChildProcess
 *   (c) writes a JSON-RPC `initialize` frame and confirms the response
 *       reaches the daemon over the socket
 *   (d) writes the spawned child's pid to the PID file
 *
 * The "daemon" in this test is the tiny `tests/fixtures/echo-daemon.mjs`
 * fixture — a Node script that binds the unix socket, echoes one
 * initialize frame, and stays alive for 10s. This keeps the test
 * deterministic and lightweight; the heavy integration is AC3.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireDaemon } from "../../../mcp-proxy/src/acquire-daemon.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_DAEMON = path.resolve(__dirname, "../../tests/fixtures/echo-daemon.mjs");

let tmpDir: string;
let spawnCalls: { command: string; args: ReadonlyArray<string>; options: childProcess.SpawnOptions }[] = [];
let unrefCount = 0;
let spawnedChildren: childProcess.ChildProcess[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-proxy-spawn-test-"));
  spawnCalls = [];
  unrefCount = 0;
  spawnedChildren = [];
});

afterEach(() => {
  for (const child of spawnedChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("AC1 — proxy shim spawn path", () => {
  it(
    "spawns the daemon detached + stdio:ignore, calls unref(), writes pid file, forwards initialize",
    async () => {
      const sockPath = path.join(tmpDir, "mcp-daemon.sock");
      const pidPath = path.join(tmpDir, "mcp-daemon.pid");
      const lockPath = path.join(tmpDir, "mcp-daemon.lock");

      // Wrap real spawn so we can record args + observe unref().
      const spawnSpy: typeof childProcess.spawn & {
        // expose for inspection
      } = ((command: string, args: ReadonlyArray<string>, options: childProcess.SpawnOptions) => {
        spawnCalls.push({ command, args, options });
        const child = childProcess.spawn(command, args, options);
        spawnedChildren.push(child);
        const origUnref = child.unref.bind(child);
        child.unref = (): void => {
          unrefCount++;
          return origUnref();
        };
        return child;
      }) as unknown as typeof childProcess.spawn;

      const { socket, daemonPid, spawned } = await acquireDaemon({
        sockPath,
        pidPath,
        lockPath,
        crewDir: tmpDir,
        daemonCommand: process.execPath,
        daemonArgs: [ECHO_DAEMON],
        daemonEnv: {
          ...process.env,
          SOCKET_PATH: sockPath,
          PID_FILE: pidPath,
        },
        spawn: spawnSpy,
        kill: (pid, sig) => process.kill(pid, sig),
        connect: (p) => net.createConnection(p),
        fs: {
          statSync: fs.statSync,
          readFileSync: (p, enc) => fs.readFileSync(p, enc),
          writeFileSync: (p, data) => fs.writeFileSync(p, data),
          unlinkSync: fs.unlinkSync,
          openSync: (p, flags) => fs.openSync(p, flags),
          closeSync: fs.closeSync,
          mkdirSync: (p, opts) => {
            fs.mkdirSync(p, opts);
          },
        },
        connectProbeTimeoutMs: 500,
        connectReadyTimeoutMs: 4000,
        spawnSettleDelayMs: 50,
      });

      try {
        // (a) + (b): one spawn call with detached/stdio:ignore; unref called once.
        expect(spawnCalls.length).toBe(1);
        const call = spawnCalls[0]!;
        expect(call.command).toBe(process.execPath);
        expect(call.args[0]).toBe(ECHO_DAEMON);
        expect(call.options.detached).toBe(true);
        expect(call.options.stdio).toBe("ignore");
        expect(unrefCount).toBeGreaterThanOrEqual(1);
        expect(spawned).toBe(true);
        expect(daemonPid).toBeGreaterThan(0);

        // (d): PID file written by the proxy with the daemon pid.
        const pidFileContent = fs.readFileSync(pidPath, "utf8").trim();
        expect(Number(pidFileContent)).toBe(daemonPid);

        // (c): JSON-RPC initialize frame round-trips through the socket.
        const responsePromise = new Promise<string>((resolve, reject) => {
          let buf = "";
          const onData = (chunk: Buffer): void => {
            buf += chunk.toString("utf8");
            const idx = buf.indexOf("\n");
            if (idx !== -1) {
              socket.removeListener("data", onData);
              resolve(buf.slice(0, idx));
            }
          };
          socket.on("data", onData);
          setTimeout(() => reject(new Error("initialize response timeout")), 2000);
        });
        socket.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
          }) + "\n",
        );
        const responseLine = await responsePromise;
        const response = JSON.parse(responseLine) as { id: number; result: unknown };
        expect(response.id).toBe(1);
        expect(response.result).toBeDefined();
      } finally {
        socket.destroy();
      }
    },
    20_000,
  );
});
