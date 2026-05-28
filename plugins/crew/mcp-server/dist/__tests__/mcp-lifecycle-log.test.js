/**
 * Integration test suite for MCP lifecycle log (Story 5.25, AC6).
 *
 * Spawns the REAL dist/index.js with CREW_MCP_LIFECYCLE_LOG set to a tmp path,
 * drives a tools/list call, sends SIGTERM, and asserts the log file contains
 * the expected event sequence (boot → transport.connected → tool.call → signal → exit).
 *
 * A second test asserts that an unwritable log path does not crash the server
 * (server still answers tool calls; log writes silently noop).
 *
 * AC coverage:
 *   - AC6a: event sequence in log file after tools/list + SIGTERM
 *   - AC6b: unwritable log path does not crash the server
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
    }
    catch (err) {
        console.error("pnpm build failed in beforeAll:", err.message);
    }
}, 90_000);
function sendRequest(child, req, timeout = 8_000) {
    return new Promise((resolve, reject) => {
        let buffer = "";
        const onData = (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed["id"] === req.id) {
                        cleanup();
                        resolve(parsed);
                        return;
                    }
                }
                catch {
                    // Non-JSON output — ignore
                }
            }
        };
        const cleanup = () => {
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
async function doInitHandshake(child) {
    let id = 1;
    const initRes = await sendRequest(child, {
        jsonrpc: "2.0",
        id: id++,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-harness", version: "0.0.1" },
        },
    }, 8_000);
    if (initRes.error) {
        throw new Error(`initialize error: ${JSON.stringify(initRes.error)}`);
    }
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n";
    child.stdin?.write(notification);
}
function readLogLines(logPath) {
    if (!fs.existsSync(logPath))
        return [];
    const text = fs.readFileSync(logPath, "utf8");
    return text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => {
        try {
            return JSON.parse(l);
        }
        catch {
            return null;
        }
    })
        .filter((l) => l !== null);
}
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let child;
let tmpDir;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-lifecycle-test-"));
});
afterEach(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        // Wait for the child to be reaped so vitest can release its stdio pipes.
        // Without this await, a dangling child can hang the worker indefinitely
        // (observed on CI: AC6b timeout left an orphan, suite hung for 57min).
        await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(), 2_000);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    // Drain stdio buffers so vitest's worker can close them.
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    child?.stdin?.destroy();
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    catch {
        // ignore cleanup errors
    }
});
// ---------------------------------------------------------------------------
// AC6a — event sequence in log file
// ---------------------------------------------------------------------------
describe("AC6a — lifecycle log contains expected event sequence", () => {
    it("log has boot → transport.connected → tool.call → signal → exit after tools/list + SIGTERM", async () => {
        const logPath = path.join(tmpDir, "mcp-lifecycle.log");
        child = cp.spawn("node", [DIST_INDEX], {
            stdio: ["pipe", "pipe", "ignore"],
            env: {
                ...process.env,
                CREW_MCP_LIFECYCLE_LOG: logPath,
                CREW_MCP_KEEPALIVE_MS: "0", // disable keepalive for determinism
            },
        });
        await doInitHandshake(child);
        // Drive a tools/list call (should produce a tool.call event)
        const res = await sendRequest(child, {
            jsonrpc: "2.0",
            id: 10,
            method: "tools/list",
            params: {},
        });
        expect(res.error).toBeUndefined();
        // Capture exit
        const exitPromise = new Promise((resolve) => {
            child.on("exit", (code, signal) => resolve({ code, signal }));
        });
        // Send SIGTERM
        child.kill("SIGTERM");
        await exitPromise;
        // Give a brief moment for the log file stream to flush
        await new Promise((r) => setTimeout(r, 200));
        // Read and assert log
        const lines = readLogLines(logPath);
        const events = lines.map((l) => l["event"]);
        // Required events in order
        expect(events).toContain("boot");
        expect(events).toContain("transport.connected");
        expect(events).toContain("signal");
        expect(events).toContain("exit");
        // boot must come first
        expect(events.indexOf("boot")).toBeLessThan(events.indexOf("transport.connected"));
        // signal must come before exit
        expect(events.indexOf("signal")).toBeLessThan(events.indexOf("exit"));
        // signal event should be SIGTERM
        const signalLine = lines.find((l) => l["event"] === "signal");
        expect(signalLine?.["name"]).toBe("SIGTERM");
        // exit event should carry a code
        const exitLine = lines.find((l) => l["event"] === "exit");
        expect(typeof exitLine?.["code"]).toBe("number");
        // boot should have version and nodeVersion
        const bootLine = lines.find((l) => l["event"] === "boot");
        expect(typeof bootLine?.["version"]).toBe("string");
        expect(typeof bootLine?.["nodeVersion"]).toBe("string");
        // Story 5.30: ppid + pgid mandatory on every event (sessionUlid optional).
        const isPosix = os.platform() !== "win32";
        for (const line of lines) {
            expect(typeof line["ppid"]).toBe("number");
            if (isPosix) {
                expect(typeof line["pgid"]).toBe("number");
            }
            // sessionUlid is intentionally absent here — env var not set.
            expect(line["sessionUlid"]).toBeUndefined();
        }
    }, { timeout: 20_000 });
    // -------------------------------------------------------------------------
    // Story 5.30 — sessionUlid appears when CREW_SESSION_ULID is set
    // -------------------------------------------------------------------------
    it("(5.30) sessionUlid appears on every event when CREW_SESSION_ULID is set", async () => {
        const logPath = path.join(tmpDir, "mcp-lifecycle.log");
        const ulid = "01TESTULIDINTEGRATION0000000";
        child = cp.spawn("node", [DIST_INDEX], {
            stdio: ["pipe", "pipe", "ignore"],
            env: {
                ...process.env,
                CREW_MCP_LIFECYCLE_LOG: logPath,
                CREW_MCP_KEEPALIVE_MS: "0",
                CREW_SESSION_ULID: ulid,
            },
        });
        await doInitHandshake(child);
        const res = await sendRequest(child, {
            jsonrpc: "2.0",
            id: 10,
            method: "tools/list",
            params: {},
        });
        expect(res.error).toBeUndefined();
        const exitPromise = new Promise((resolve) => {
            child.on("exit", (code, signal) => resolve({ code, signal }));
        });
        child.kill("SIGTERM");
        await exitPromise;
        await new Promise((r) => setTimeout(r, 200));
        const lines = readLogLines(logPath);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line["sessionUlid"]).toBe(ulid);
            expect(typeof line["ppid"]).toBe("number");
        }
    }, { timeout: 20_000 });
});
// ---------------------------------------------------------------------------
// AC6b — unwritable log path does not crash the server
// ---------------------------------------------------------------------------
describe("AC6b — unwritable log path does not crash server", () => {
    it("server still answers tool calls when log path is unwritable", async () => {
        // Create a regular file inside tmpDir, then point the log path
        // UNDER it (as if it were a directory). On every Unix-like platform,
        // mkdirSync(<file>/<sub>, { recursive: true }) throws ENOTDIR
        // synchronously. This is more reliable than platform-specific paths
        // like /proc/nonexistent which behave differently across kernels.
        const blocker = path.join(tmpDir, "not-a-directory");
        fs.writeFileSync(blocker, "");
        const unwritablePath = path.join(blocker, "crew-lifecycle.log");
        child = cp.spawn("node", [DIST_INDEX], {
            stdio: ["pipe", "pipe", "ignore"],
            env: {
                ...process.env,
                CREW_MCP_LIFECYCLE_LOG: unwritablePath,
                CREW_MCP_KEEPALIVE_MS: "0",
            },
        });
        // Server should still start and respond despite bad log path
        await doInitHandshake(child);
        const res = await sendRequest(child, {
            jsonrpc: "2.0",
            id: 10,
            method: "tools/list",
            params: {},
        });
        expect(res.error).toBeUndefined();
        const tools = res.result.tools;
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
    }, { timeout: 20_000 });
});
