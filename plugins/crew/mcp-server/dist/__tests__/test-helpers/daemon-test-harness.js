/**
 * Test harness for the post-D2 (Story 5.32) MCP daemon.
 *
 * The daemon no longer reads JSON-RPC over stdio — it listens on a unix
 * socket at `~/.crew/mcp-daemon.sock` (per the Story 5.32 transport change).
 * Tests that previously piped JSON-RPC through `child.stdin`/`child.stdout`
 * now spawn the daemon with HOME pointed at a tmpdir and connect to the
 * resulting socket as a client. This helper centralises that plumbing so
 * the existing Story 5.25 assertions (lifecycle log, crash resilience,
 * keepalive, signal handling) can keep their semantics under the new
 * transport.
 *
 * Why a harness, not raw socket calls per test: every Story 5.25 test does
 * roughly the same six things (spawn daemon, wait for socket, connect,
 * initialize, sendRequest, cleanup). Pre-D2 those lived on stdio, now they
 * live on a unix socket — extracting the helper keeps each test focused on
 * its assertion.
 */
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
async function waitForSocket(sockPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const st = fs.statSync(sockPath);
            if (st.isSocket())
                return;
        }
        catch {
            /* not yet */
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`daemon socket did not appear at ${sockPath} within ${timeoutMs}ms`);
}
function connectSocket(sockPath) {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection(sockPath);
        sock.once("connect", () => resolve(sock));
        sock.once("error", (err) => reject(err));
    });
}
export async function spawnDaemonHarness(opts) {
    const tmpHome = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "crew-daemon-test-"));
    const crewDir = path.join(tmpHome, ".crew");
    fs.mkdirSync(crewDir, { recursive: true });
    const sockPath = path.join(crewDir, "mcp-daemon.sock");
    const pidPath = path.join(crewDir, "mcp-daemon.pid");
    const logPath = opts.logPath ?? path.join(crewDir, "lifecycle.log");
    const child = cp.spawn("node", [opts.distIndex], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            HOME: tmpHome,
            CREW_MCP_KEEPALIVE_MS: opts.env?.["CREW_MCP_KEEPALIVE_MS"] ?? "0",
            CREW_MCP_LIFECYCLE_LOG: logPath,
            ...opts.env,
        },
    });
    // Collect stderr for diagnostics; never assert on it but expose to debug.
    child.stderr?.on("data", () => {
        /* swallow — tests assert via log file */
    });
    await waitForSocket(sockPath, opts.socketWaitMs ?? 5000);
    const socket = await connectSocket(sockPath);
    // ----- sendRequest plumbing over the socket -----
    let buffer = "";
    const pending = new Map();
    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line)
                continue;
            try {
                const parsed = JSON.parse(line);
                const id = parsed["id"];
                if (typeof id === "number" && pending.has(id)) {
                    pending.get(id)(parsed);
                    pending.delete(id);
                }
            }
            catch {
                /* non-JSON noise; ignore */
            }
        }
    });
    function sendRequest(req, timeoutMs = 8_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(req.id);
                reject(new Error(`Timed out waiting for response to id=${req.id}`));
            }, timeoutMs);
            pending.set(req.id, (resp) => {
                clearTimeout(timer);
                resolve(resp);
            });
            socket.write(JSON.stringify(req) + "\n", (err) => {
                if (err) {
                    clearTimeout(timer);
                    pending.delete(req.id);
                    reject(err);
                }
            });
        });
    }
    let _id = 1;
    async function initHandshake() {
        const initRes = await sendRequest({
            jsonrpc: "2.0",
            id: _id++,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-harness", version: "0.0.1" },
            },
        });
        if (initRes.error) {
            throw new Error(`initialize error: ${JSON.stringify(initRes.error)}`);
        }
        socket.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }
    async function close() {
        try {
            socket.destroy();
        }
        catch {
            /* ignore */
        }
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(), 2_000);
                child.once("exit", () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        if (!opts.home) {
            // Only delete the tmpHome if we created it.
            try {
                fs.rmSync(tmpHome, { recursive: true, force: true });
            }
            catch {
                /* ignore */
            }
        }
    }
    return {
        child,
        socket,
        tmpHome,
        sockPath,
        pidPath,
        logPath,
        sendRequest,
        initHandshake,
        close,
    };
}
