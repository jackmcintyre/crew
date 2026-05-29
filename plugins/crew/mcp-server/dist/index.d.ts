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
export {};
