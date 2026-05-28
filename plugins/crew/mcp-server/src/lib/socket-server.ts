/**
 * Story 5.32 — Daemon-side unix-socket listener.
 *
 * The MCP daemon (previously `StdioServerTransport`) now listens on a
 * per-user unix socket at `~/.crew/mcp-daemon.sock`. The proxy shim
 * (`@crew/mcp-proxy`) connects to this socket and byte-forwards JSON-RPC
 * frames between Claude Code (stdio) and the daemon.
 *
 * Security model (Q5 of the 5.31 spike, verdict
 * `socket-auth: filesystem-permission-only`):
 *   - `~/.crew/` directory is created/forced to mode 0700
 *   - Socket file is chmod'd to 0600 after bind
 *   - A no-op `verifyPeerEuid` connection listener is wired so a follow-up
 *     story can swap in the real `getsockopt(LOCAL_PEEREUID)` call without
 *     touching the transport contract. AC6 asserts the wiring exists, not
 *     the behaviour.
 *
 * Stale-socket handling: bind() on an existing socket file returns EADDRINUSE.
 * If we encounter that and no other daemon is alive (the proxy is responsible
 * for that check), unlink and retry once.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import os from "node:os";
import path from "node:path";

export interface SocketServerOptions {
  /**
   * Overrides $HOME for path resolution. Used by tests so they never touch
   * the operator's real ~/.crew/.
   */
  home?: string;
  /**
   * Called for each accepted connection. The daemon wires this to a
   * SocketServerTransport that the MCP Server connects to.
   */
  onConnection?: (socket: net.Socket) => void;
}

export interface SocketServerHandles {
  server: net.Server;
  sockPath: string;
  crewDir: string;
}

/**
 * Defence-in-depth peer-EUID check. macOS exposes LOCAL_PEEREUID via
 * `getsockopt(2)`; Node's net.Socket does not expose getsockopt directly, so
 * the check is wired as a no-op for v1.1. A follow-up story can land the
 * real call (the AC asserts the wiring, not the behaviour — Q5 verdict).
 */
export function verifyPeerEuid(_socket: net.Socket): boolean {
  // TODO: implement via getsockopt(SOL_LOCAL, LOCAL_PEEREUID, ...) — needs a
  // native binding (no first-party Node API). Until then, return true; the
  // primary access control is the 0600 mode on the socket file + 0700 on the
  // parent directory.
  return true;
}

export async function startSocketServer(
  opts: SocketServerOptions = {},
): Promise<SocketServerHandles> {
  const home = opts.home ?? process.env["HOME"] ?? os.homedir();
  const crewDir = path.join(home, ".crew");
  const sockPath = path.join(crewDir, "mcp-daemon.sock");

  // 1. Ensure ~/.crew/ exists with 0700.
  fs.mkdirSync(crewDir, { recursive: true, mode: 0o700 });
  // belt-and-braces: tighten perms if directory existed with wider mode.
  try {
    fs.chmodSync(crewDir, 0o700);
  } catch {
    /* ignore — best effort */
  }

  // 2. Unlink any stale socket file before bind. bind() on an existing socket
  // returns EADDRINUSE; the proxy owns the "is a real daemon running?" check
  // so by the time we reach here, any leftover socket file is genuinely stale.
  try {
    fs.unlinkSync(sockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // 3. Create + listen. We chmod to 0600 immediately after bind. Using umask
  // is racier (process-wide setting); explicit chmod is cleaner.
  const server = net.createServer();

  // Wire the per-connection verify hook (AC6: the listener must exist).
  server.on("connection", (socket: net.Socket) => {
    if (!verifyPeerEuid(socket)) {
      socket.destroy();
      return;
    }
    if (opts.onConnection) opts.onConnection(socket);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(sockPath);
  });

  // chmod the socket itself to 0600 (the AC6 assertion).
  fs.chmodSync(sockPath, 0o600);

  return { server, sockPath, crewDir };
}
