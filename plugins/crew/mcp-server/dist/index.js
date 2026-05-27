import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { registerAllTools } from "./tools/register.js";
/**
 * Stdio entrypoint referenced by `.claude-plugin/plugin.json#mcpServers`.
 *
 * Kept thin: instantiate the server, register the plugin's tools, then
 * connect a stdio transport. `registerAllTools` lives outside
 * `createServer` so the Story 1.1 smoke test can still assert that a
 * bare `createServer()` registers zero tools.
 */
// ---------------------------------------------------------------------------
// Client-side keep-alive fix (Story 5.12)
//
// Root cause: Claude Code closes the MCP child's stdin after ~10 min idle
// (observed 2026-05-25, documented in
//   _bmad-output/postmortems/2026-05-25-dogfood-rollback.md § L1 defect #1).
// The SDK's StdioServerTransport subscribes to process.stdin's 'end'/'close'
// events. When those fire, the transport tears down and no live event-loop
// ref remains — Node exits with code 0 (natural drain, NOT an explicit
// process.exit() call; confirmed by the diag log "beforeExit" → "exit").
//
// Fix: the load-bearing mechanism is the module-level setInterval handle
// (period ≈ 12 days) holding an independent event-loop ref the SDK cannot
// collect or unref — preventing the natural drain that fires
// 'beforeExit' → 'exit' when the SDK's transport removes its ref on
// stdin close. The stdin 'end'/'close' handlers below are NOT part of
// the survival mechanism — they only emit a diagnostic line when
// CREW_MCP_DIAG is set, so the postmortem trail is non-mysterious if
// idle-reap behaviour ever changes again. They do not "swallow" or
// suppress propagation; removing them would not affect survival, only
// observability. Cite: memory project_mcp_server_silent_disconnect.
//
// SIGTERM / SIGINT are intentionally NOT handled here — Node's default
// termination on those signals continues to apply (AC3 / story spec § What
// this story does NOT → (n)).
//
// References:
//   - Story spec: _bmad-output/implementation-artifacts/5-12-mcp-child-resilient-to-parent-stdin-close.md
//   - Project memory: project_mcp_server_silent_disconnect
//   - Postmortem: _bmad-output/postmortems/2026-05-25-dogfood-rollback.md § L1 defect #1
// ---------------------------------------------------------------------------
/**
 * Keep-alive timer: a no-op interval with a period of 2^30 ms (~12 days).
 * Holding a ref on the event loop independently of stdin prevents the
 * natural event-loop drain that fires 'beforeExit' → 'exit' when the SDK's
 * transport removes its ref on stdin close.
 *
 * The handle is kept module-level so the GC cannot collect it.
 * `unref()` is intentionally NOT called — the whole point is to hold the ref.
 */
const _keepAliveHandle = setInterval(() => {
    /* intentional no-op: keep the event loop alive */
}, 1 << 30);
/**
 * Swallow stdin 'end' and 'close' events before the SDK's transport
 * can react to them. Registered here (before server.connect) so our
 * handler runs in the listener queue ahead of the SDK's.
 */
function swallowStdinEnd() {
    if (process.env["CREW_MCP_DIAG"]) {
        // eslint-disable-next-line no-console
        process.stderr.write(JSON.stringify({ event: "stdin.end.swallowed", pid: process.pid }) + "\n");
    }
}
function swallowStdinClose() {
    if (process.env["CREW_MCP_DIAG"]) {
        // eslint-disable-next-line no-console
        process.stderr.write(JSON.stringify({ event: "stdin.close.swallowed", pid: process.pid }) + "\n");
    }
}
async function main() {
    // Install stdin-end swallowers BEFORE connecting the transport so our
    // listeners precede the SDK's in the event-listener queue.
    process.stdin.on("end", swallowStdinEnd);
    process.stdin.on("close", swallowStdinClose);
    // Resume stdin so the 'end'/'close' events actually fire when the parent
    // closes its end (Node's process.stdin starts paused by default in some
    // contexts; reading it puts it in flowing mode which is needed for EOF).
    process.stdin.resume();
    const server = createServer();
    registerAllTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
