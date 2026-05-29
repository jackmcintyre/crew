/**
 * Daemon entrypoint — spawned by the mcp-proxy shim (NOT by Claude Code directly).
 *
 * Story 5.32 — Path D2 detached-proxy build.
 *
 * Until 5.32 the manifest pointed `mcpServers.crew.command` at this file via
 * `node`. The host SIGTERMed the daemon's process group whenever any subagent
 * Task returned (the cascade RCA — 8/8 paired SIGTERMs in
 * `~/.crew/mcp-lifecycle.log`). Story 5.32 inserts a proxy shim at
 * `plugins/crew/mcp-proxy/bin/mcp-proxy.js` between the host and this daemon;
 * the shim becomes the host's stdio child and spawns this daemon detached, in
 * its own process group, so the cascade SIGTERM no longer reaches it.
 *
 * Transport change: this daemon no longer reads/writes JSON-RPC over stdio.
 * It listens on a per-user unix socket at `~/.crew/mcp-daemon.sock` and wraps
 * each accepted connection in a `SocketServerTransport`. The proxy
 * byte-forwards JSON-RPC frames between Claude Code's stdio and the socket.
 *
 * What stays from Story 5.25 (always-on lifecycle logging):
 *   • Crash-resilience handlers (uncaughtException, unhandledRejection, stdout
 *     EPIPE — though stdout is unused once detached).
 *   • Signal handlers (SIGTERM/SIGINT/SIGHUP) — these now only fire when an
 *     operator explicitly kills the daemon (e.g., `kill $(cat ~/.crew/mcp-daemon.pid)`).
 *   • Server-initiated keepalive ping (now per-connection — see main()).
 *
 * What changes:
 *   • StdioServerTransport → SocketServerTransport (per connection).
 *   • Stdin.end/close handlers removed: the daemon is detached, stdio is
 *     `'ignore'` in the proxy's spawn opts; there is no stdin to listen on.
 *   • PID file written to `~/.crew/mcp-daemon.pid` after socket bind so
 *     subsequent proxy shims can detect the running daemon (Q4 hybrid pattern).
 *
 * References:
 *   - Story spec:  _bmad-output/implementation-artifacts/5-32-d2-build-detached-proxy-and-parent-owned-daemon.md
 *   - Spike:       _bmad-output/implementation-artifacts/spikes/d2-feasibility-notes.md
 *   - Postmortem:  _bmad-output/postmortems/2026-05-25-dogfood-rollback.md § L1 defect #1
 *   - Memory:      project_mcp_server_silent_disconnect
 */
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "./server.js";
import { registerAllTools } from "./tools/register.js";
import { createLifecycleLog } from "./lib/lifecycle-log.js";
import { getPluginVersion } from "./lib/plugin-version.js";
import { startSocketServer } from "./lib/socket-server.js";
import { SocketServerTransport } from "./lib/socket-transport.js";
// ---------------------------------------------------------------------------
// Lifecycle log: instantiated at module load so crash-resilience handlers can
// use it immediately (before main() runs).
// ---------------------------------------------------------------------------
const lifecycle = createLifecycleLog();
// ---------------------------------------------------------------------------
// Crash-resilience handlers (AC3 of 5.25 — still load-bearing under D2).
// ---------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
    lifecycle.log("uncaughtException", {
        name: err.name,
        message: err.message,
        stack: err.stack,
    });
});
process.on("unhandledRejection", (reason) => {
    lifecycle.log("unhandledRejection", {
        reason: String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
});
// Stdout is no longer used for IPC under D2, but the listener is still
// installed in case any logging accidentally writes to it.
process.stdout.on("error", (err) => {
    lifecycle.log("stdout.error", {
        code: err.code,
        message: err.message,
    });
});
// ---------------------------------------------------------------------------
// Signal handlers — the daemon's only clean-shutdown trigger now that stdio
// is detached. Operators kill the daemon via `kill $(cat ~/.crew/mcp-daemon.pid)`.
// ---------------------------------------------------------------------------
let pidFileWritten = null;
function cleanupPidFile() {
    if (pidFileWritten) {
        try {
            fs.unlinkSync(pidFileWritten);
        }
        catch {
            /* ignore — file may already be gone */
        }
        pidFileWritten = null;
    }
}
process.on("SIGTERM", () => {
    lifecycle.logSync("signal", { name: "SIGTERM" });
    cleanupPidFile();
    process.exit(143); // 128 + 15
});
process.on("SIGINT", () => {
    lifecycle.logSync("signal", { name: "SIGINT" });
    cleanupPidFile();
    process.exit(130); // 128 + 2
});
process.on("SIGHUP", () => {
    lifecycle.logSync("signal", { name: "SIGHUP" });
    cleanupPidFile();
    process.exit(129); // 128 + 1
});
process.on("beforeExit", (code) => {
    lifecycle.log("beforeExit", { code });
});
process.on("exit", (code) => {
    lifecycle.logSync("exit", { code });
    cleanupPidFile();
    lifecycle.close();
});
// ---------------------------------------------------------------------------
// main: boot, bind socket, wire per-connection transport + keepalive.
// ---------------------------------------------------------------------------
async function main() {
    lifecycle.log("boot", {
        version: getPluginVersion(),
        nodeVersion: process.version,
    });
    const server = createServer();
    registerAllTools(server);
    const intervalMs = Number(process.env["CREW_MCP_KEEPALIVE_MS"] ?? 300_000);
    const { sockPath } = await startSocketServer({
        onConnection: (socket) => {
            const transport = new SocketServerTransport(socket);
            transport.onclose = () => {
                lifecycle.log("transport.onclose");
            };
            // Connect server to this transport. Note: SDK Server is single-transport
            // by design; the v1.1 deployment expects at most one active proxy
            // connection at a time (one Claude Code session per user). A second
            // concurrent connection would conflict — acceptable for v1.1 since
            // `~/.crew/` is per-user.
            server.connect(transport).catch((err) => {
                lifecycle.log("transport.connect.error", { message: err.message });
            });
            lifecycle.log("transport.connected");
            // Keepalive — runs while this transport is active.
            if (intervalMs > 0) {
                const pingTimer = setInterval(() => {
                    void (async () => {
                        lifecycle.log("keepalive.sent", { intervalMs });
                        const t0 = Date.now();
                        try {
                            await server.ping();
                            lifecycle.log("keepalive.response", { latencyMs: Date.now() - t0 });
                        }
                        catch (err) {
                            lifecycle.log("keepalive.error", {
                                message: err instanceof Error ? err.message : String(err),
                            });
                        }
                    })();
                }, intervalMs);
                pingTimer.unref();
                transport.onclose = () => {
                    clearInterval(pingTimer);
                    lifecycle.log("transport.onclose");
                };
            }
            else {
                lifecycle.log("keepalive.disabled", { intervalMs });
            }
        },
    });
    // Write the PID file so the proxy shim can detect the running daemon.
    const home = process.env["HOME"] ?? os.homedir();
    const pidPath = path.join(home, ".crew", "mcp-daemon.pid");
    fs.writeFileSync(pidPath, `${process.pid}\n`);
    pidFileWritten = pidPath;
    lifecycle.log("socket.bound", { path: sockPath });
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
