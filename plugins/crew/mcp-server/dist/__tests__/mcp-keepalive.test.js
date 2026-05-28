/**
 * Integration test suite for MCP server keepalive ping (Story 5.25, AC7) —
 * re-homed for Story 5.32's socket transport.
 *
 * Assertions unchanged from 5.25 (3+ keepalive.sent + 1+ keepalive.response
 * within 7s for a 2000ms interval; no sent events when interval = 0). Only
 * the wire is now a unix socket; the ping-responder is wired on the client
 * socket rather than the child's stdio pipe.
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
/**
 * Wire a per-frame parser on the client socket that auto-pongs any incoming
 * `{ method: "ping" }` request. server.ping() expects this on the wire — the
 * SDK Protocol layer treats `ping` as a client-routable request and resolves
 * the daemon's pending promise once the pong arrives.
 */
function installPingResponder(socket) {
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
                const msg = JSON.parse(trimmed);
                if (msg["method"] === "ping" && msg["id"] !== undefined) {
                    socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg["id"], result: {} }) + "\n");
                }
            }
            catch {
                /* ignore non-JSON */
            }
        }
    };
    socket.on("data", onData);
    return () => {
        socket.removeListener("data", onData);
    };
}
let harness;
let pingCleanup = null;
let tmpHomes = [];
afterEach(async () => {
    if (pingCleanup) {
        pingCleanup();
        pingCleanup = null;
    }
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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "crew-keepalive-test-"));
    tmpHomes.push(home);
    return { home, logPath: path.join(home, ".crew", "lifecycle.log") };
}
describe("AC7a — keepalive timer fires and pong is received", () => {
    it("logs 3+ keepalive.sent and 1+ keepalive.response within 7 seconds (2000ms interval)", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({
            distIndex: DIST_INDEX,
            home,
            logPath,
            env: { CREW_MCP_KEEPALIVE_MS: "2000" },
        });
        pingCleanup = installPingResponder(harness.socket);
        await harness.initHandshake();
        await new Promise((r) => setTimeout(r, 7_000));
        const lines = readLogLines(logPath);
        const sentEvents = lines.filter((l) => l["event"] === "keepalive.sent");
        const responseEvents = lines.filter((l) => l["event"] === "keepalive.response");
        expect(sentEvents.length).toBeGreaterThanOrEqual(3);
        expect(responseEvents.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 20_000 });
});
describe("AC7b — keepalive disabled when CREW_MCP_KEEPALIVE_MS=0", () => {
    it("no keepalive.sent events appear within 5 seconds when interval is 0", async () => {
        const { home, logPath } = freshHome();
        harness = await spawnDaemonHarness({
            distIndex: DIST_INDEX,
            home,
            logPath,
            env: { CREW_MCP_KEEPALIVE_MS: "0" },
        });
        await harness.initHandshake();
        await new Promise((r) => setTimeout(r, 5_000));
        const lines = readLogLines(logPath);
        const sentEvents = lines.filter((l) => l["event"] === "keepalive.sent");
        const disabledEvents = lines.filter((l) => l["event"] === "keepalive.disabled");
        expect(sentEvents.length).toBe(0);
        expect(disabledEvents.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 15_000 });
});
