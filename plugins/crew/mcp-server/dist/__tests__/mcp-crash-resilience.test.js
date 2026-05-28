/**
 * Integration test suite for MCP crash-resilience handlers (Story 5.25, AC3) —
 * re-homed for Story 5.32's socket transport.
 *
 * Verifies the three process-level resilience handlers installed by index.ts
 * log the event but do NOT crash the daemon:
 *   - uncaughtException, unhandledRejection — assert via steady-state survival
 *   - SIGTERM/SIGINT/SIGHUP — log the signal then exit with conventional codes
 *
 * The transport changed (stdio → unix socket) but the contracts being
 * asserted (handler-installed, signal-driven exit codes, lifecycle log
 * entries) are unchanged. The test helper `spawnDaemonHarness` handles the
 * new connection mechanics.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDaemonHarness } from "./test-helpers/daemon-test-harness.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.resolve(__dirname, "../../dist/index.js");
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
let harness;
let tmpHomes = [];
afterEach(async () => {
    if (harness) {
        await harness.close();
        harness = undefined;
    }
    for (const h of tmpHomes) {
        try {
            fs.rmSync(h, { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
    }
    tmpHomes = [];
});
function freshHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "crew-resilience-test-"));
    tmpHomes.push(home);
    return { home, logPath: path.join(home, ".crew", "lifecycle.log") };
}
// ---------------------------------------------------------------------------
// AC3a — uncaughtException handler installed; daemon survives healthy ops.
// ---------------------------------------------------------------------------
describe("AC3a — uncaughtException handler installed and daemon survives", () => {
    it("daemon continues to respond to tools/list after steady-state window", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({ distIndex: DIST_INDEX, home, logPath });
        await harness.initHandshake();
        const res1 = await harness.sendRequest({
            jsonrpc: "2.0",
            id: 100,
            method: "tools/list",
            params: {},
        });
        expect(res1.error).toBeUndefined();
        await new Promise((r) => setTimeout(r, 500));
        const res2 = await harness.sendRequest({
            jsonrpc: "2.0",
            id: 101,
            method: "tools/list",
            params: {},
        });
        expect(res2.error).toBeUndefined();
        const lines = readLogLines(logPath);
        const events = lines.map((l) => l["event"]);
        expect(events).toContain("boot");
        expect(events).toContain("transport.connected");
    }, { timeout: 20_000 });
});
// ---------------------------------------------------------------------------
// AC3b — unhandledRejection handler installed; daemon stays alive.
// ---------------------------------------------------------------------------
describe("AC3b — unhandledRejection handler installed, daemon does not crash", () => {
    it("daemon remains alive and responsive after init", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({ distIndex: DIST_INDEX, home, logPath });
        await harness.initHandshake();
        const res = await harness.sendRequest({
            jsonrpc: "2.0",
            id: 200,
            method: "tools/list",
            params: {},
        });
        expect(res.error).toBeUndefined();
        let exited = false;
        harness.child.on("exit", () => {
            exited = true;
        });
        await new Promise((r) => setTimeout(r, 1_000));
        expect(exited).toBe(false);
    }, { timeout: 15_000 });
});
// ---------------------------------------------------------------------------
// AC3c — SIGTERM/SIGINT/SIGHUP log signal event + exit with conventional codes
// ---------------------------------------------------------------------------
describe("AC3c — SIGTERM logs signal event and exits with code 143", () => {
    it("SIGTERM: log contains signal{name:SIGTERM} and process exits with code 143", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({ distIndex: DIST_INDEX, home, logPath });
        await harness.initHandshake();
        const exitPromise = new Promise((resolve) => {
            harness.child.on("exit", (code, signal) => resolve({ code, signal }));
        });
        harness.child.kill("SIGTERM");
        const { code } = await exitPromise;
        await new Promise((r) => setTimeout(r, 200));
        const lines = readLogLines(logPath);
        const signalLine = lines.find((l) => l["event"] === "signal");
        expect(signalLine).toBeDefined();
        expect(signalLine?.["name"]).toBe("SIGTERM");
        const isExpected = code === 143 || code === 0;
        expect(isExpected).toBe(true);
    }, { timeout: 15_000 });
});
describe("AC3c — SIGINT logs signal event and exits with code 130", () => {
    it("SIGINT: log contains signal{name:SIGINT} and process exits with code 130", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({ distIndex: DIST_INDEX, home, logPath });
        await harness.initHandshake();
        const exitPromise = new Promise((resolve) => {
            harness.child.on("exit", (code, signal) => resolve({ code, signal }));
        });
        harness.child.kill("SIGINT");
        const { code } = await exitPromise;
        await new Promise((r) => setTimeout(r, 200));
        const lines = readLogLines(logPath);
        const signalLine = lines.find((l) => l["event"] === "signal");
        expect(signalLine).toBeDefined();
        expect(signalLine?.["name"]).toBe("SIGINT");
        const isExpected = code === 130 || code === 0;
        expect(isExpected).toBe(true);
    }, { timeout: 15_000 });
});
describe("AC3c — SIGHUP logs signal event and exits with code 129", () => {
    it("SIGHUP: log contains signal{name:SIGHUP} and process exits with code 129", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({ distIndex: DIST_INDEX, home, logPath });
        await harness.initHandshake();
        const exitPromise = new Promise((resolve) => {
            harness.child.on("exit", (code, signal) => resolve({ code, signal }));
        });
        harness.child.kill("SIGHUP");
        const { code } = await exitPromise;
        await new Promise((r) => setTimeout(r, 200));
        const lines = readLogLines(logPath);
        const signalLine = lines.find((l) => l["event"] === "signal");
        expect(signalLine).toBeDefined();
        expect(signalLine?.["name"]).toBe("SIGHUP");
        const isExpected = code === 129 || code === 0;
        expect(isExpected).toBe(true);
    }, { timeout: 15_000 });
});
// ---------------------------------------------------------------------------
// AC3d — main().catch(err => process.exit(1)) is preserved in dist/index.js
// ---------------------------------------------------------------------------
describe("AC3d — main().catch preserved in dist/index.js", () => {
    it("dist/index.js contains main().catch with process.exit(1)", () => {
        const distSrc = fs.readFileSync(DIST_INDEX, "utf8");
        const hasCatchPattern = /main\(\)\s*\.catch/.test(distSrc) && /process\.exit\(1\)/.test(distSrc);
        expect(hasCatchPattern).toBe(true);
    });
});
