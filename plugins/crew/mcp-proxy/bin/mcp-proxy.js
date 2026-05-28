#!/usr/bin/env node
/**
 * Story 5.32 — Detached MCP proxy shim entry point.
 *
 * This is the executable the Claude Code host spawns when the plugin
 * manifest's `mcpServers.crew.command` points at it. The shim does three
 * things:
 *
 *   1. Acquires a connection to a per-user MCP daemon — spawning a new daemon
 *      in its own process group (`detached: true, stdio: 'ignore'`) if none is
 *      already running. The spike's Q2 evidence confirmed this puts the daemon
 *      in a pgid that the host's cascade SIGTERM cannot reach.
 *   2. Byte-forwards JSON-RPC frames between its own stdio (where the host
 *      listens) and the daemon's unix socket. Per Q3 the framing is opaque to
 *      the shim — both endpoints speak line-delimited JSON; Node's `pipe()`
 *      preserves byte order and the ReadBuffer on each end reassembles.
 *   3. Exits cleanly on stdin close (the host's normal-shutdown signal), on
 *      SIGTERM (the host's cascade signal), or on SIGINT. None of these
 *      propagate to the daemon — the daemon is detached on purpose.
 *
 * The daemon binary is resolved relative to this script's own location:
 *   `<plugin-root>/mcp-proxy/bin/mcp-proxy.js` →
 *   `<plugin-root>/mcp-server/dist/index.js`.
 *
 * No external deps; pure node builtins (child_process, net, fs, process).
 */
import { spawn } from "node:child_process";
import { connect as netConnect } from "node:net";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireDaemon } from "./acquire-daemon.js";
import { resolveDaemonPaths } from "./daemon-paths.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve the daemon binary relative to the proxy's location. Layout:
//   plugins/crew/mcp-proxy/bin/mcp-proxy.js  ← __dirname
//   plugins/crew/mcp-server/dist/index.js    ← daemon
const DEFAULT_DAEMON_PATH = path.resolve(__dirname, "..", "..", "mcp-server", "dist", "index.js");
async function main() {
    const daemonCommand = process.execPath; // node
    const daemonScript = process.env["CREW_DAEMON_PATH"] ?? DEFAULT_DAEMON_PATH;
    const daemonArgs = [daemonScript];
    const paths = resolveDaemonPaths();
    const { socket } = await acquireDaemon({
        sockPath: paths.sockPath,
        pidPath: paths.pidPath,
        lockPath: paths.lockPath,
        crewDir: paths.crewDir,
        daemonCommand,
        daemonArgs,
        daemonEnv: process.env,
        spawn,
        kill: (pid, sig) => process.kill(pid, sig),
        connect: (sockPath) => netConnect(sockPath),
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
    });
    // Byte-forward: stdin → socket; socket → stdout. The framing is opaque to
    // the proxy; ReadBuffer on each endpoint handles \n delimitation.
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
    // Socket teardown → exit. The host will see stdout close and treat as
    // disconnect; Story 5.30's halt seam will surface the McpDisconnectedError.
    const onSocketEnd = () => {
        process.exitCode = 0;
        process.exit(0);
    };
    socket.on("close", onSocketEnd);
    socket.on("end", onSocketEnd);
    socket.on("error", (err) => {
        process.stderr.write(`mcp-proxy: socket error: ${err.message}\n`);
        process.exit(1);
    });
    // Host signals only kill the shim, not the daemon. SIGTERM = cascade
    // (clean exit 0); SIGINT = operator Ctrl-C (130). Stdin 'end' = normal
    // host shutdown.
    process.on("SIGTERM", () => {
        try {
            socket.destroy();
        }
        catch {
            /* ignore */
        }
        process.exit(0);
    });
    process.on("SIGINT", () => {
        try {
            socket.destroy();
        }
        catch {
            /* ignore */
        }
        process.exit(130);
    });
    process.stdin.on("end", () => {
        try {
            socket.destroy();
        }
        catch {
            /* ignore */
        }
        process.exit(0);
    });
}
main().catch((err) => {
    process.stderr.write(`mcp-proxy: fatal: ${err.message}\n`);
    process.exit(1);
});
