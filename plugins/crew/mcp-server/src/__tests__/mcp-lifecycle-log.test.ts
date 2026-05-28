/**
 * Integration test suite for MCP lifecycle log (Story 5.25, AC6) — re-homed
 * for Story 5.32's socket transport.
 *
 * The assertions (boot → transport.connected → tool.call → signal → exit;
 * ppid/pgid present; sessionUlid when env set; unwritable log path doesn't
 * crash) are unchanged from 5.25. Only the JSON-RPC plumbing moved from
 * stdio to the unix socket exposed by `startSocketServer`.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

let harness: DaemonHarness | undefined;

afterEach(async () => {
  if (harness) {
    await harness.close();
    harness = undefined;
  }
});

describe("AC6a — lifecycle log contains expected event sequence", () => {
  it(
    "log has boot → transport.connected → signal → exit after tools/list + SIGTERM",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-lifecycle-test-"));
      const logPath = path.join(tmpHome, ".crew", "mcp-lifecycle.log");
      harness = await spawnDaemonHarness({
        distIndex: DIST_INDEX,
        home: tmpHome,
        logPath,
      });
      await harness.initHandshake();

      const res = await harness.sendRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
        params: {},
      });
      expect(res.error).toBeUndefined();

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          harness!.child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      harness.child.kill("SIGTERM");
      await exitPromise;

      // Flush window for the log file stream.
      await new Promise((r) => setTimeout(r, 200));

      const lines = readLogLines(logPath);
      const events = lines.map((l) => l["event"] as string);

      expect(events).toContain("boot");
      expect(events).toContain("transport.connected");
      expect(events).toContain("signal");
      expect(events).toContain("exit");

      expect(events.indexOf("boot")).toBeLessThan(events.indexOf("transport.connected"));
      expect(events.indexOf("signal")).toBeLessThan(events.indexOf("exit"));

      const signalLine = lines.find((l) => l["event"] === "signal");
      expect(signalLine?.["name"]).toBe("SIGTERM");

      const exitLine = lines.find((l) => l["event"] === "exit");
      expect(typeof exitLine?.["code"]).toBe("number");

      const bootLine = lines.find((l) => l["event"] === "boot");
      expect(typeof bootLine?.["version"]).toBe("string");
      expect(typeof bootLine?.["nodeVersion"]).toBe("string");

      const isPosix = os.platform() !== "win32";
      for (const line of lines) {
        expect(typeof line["ppid"]).toBe("number");
        if (isPosix) {
          expect(typeof line["pgid"]).toBe("number");
        }
        expect(line["sessionUlid"]).toBeUndefined();
      }

      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
    { timeout: 20_000 },
  );

  it(
    "(5.30) sessionUlid appears on every event when CREW_SESSION_ULID is set",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-lifecycle-test-"));
      const logPath = path.join(tmpHome, ".crew", "mcp-lifecycle.log");
      const ulid = "01TESTULIDINTEGRATION0000000";
      harness = await spawnDaemonHarness({
        distIndex: DIST_INDEX,
        home: tmpHome,
        logPath,
        env: { CREW_SESSION_ULID: ulid },
      });
      await harness.initHandshake();

      const res = await harness.sendRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
        params: {},
      });
      expect(res.error).toBeUndefined();

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          harness!.child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      harness.child.kill("SIGTERM");
      await exitPromise;
      await new Promise((r) => setTimeout(r, 200));

      const lines = readLogLines(logPath);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line["sessionUlid"]).toBe(ulid);
        expect(typeof line["ppid"]).toBe("number");
      }

      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
    { timeout: 20_000 },
  );
});

describe("AC6b — unwritable log path does not crash server", () => {
  it(
    "daemon still answers tool calls when log path is unwritable",
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-lifecycle-test-"));
      // Place a regular file at logPath so the lifecycle log's mkdir(recursive)
      // fails with ENOTDIR — but the daemon still starts.
      const blocker = path.join(tmpHome, "not-a-directory");
      fs.writeFileSync(blocker, "");
      const unwritableLogPath = path.join(blocker, "crew-lifecycle.log");

      harness = await spawnDaemonHarness({
        distIndex: DIST_INDEX,
        home: tmpHome,
        logPath: unwritableLogPath,
      });
      await harness.initHandshake();

      const res = await harness.sendRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
        params: {},
      });

      expect(res.error).toBeUndefined();
      const tools = (res.result as { tools: unknown[] }).tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
    { timeout: 20_000 },
  );
});
