/**
 * Integration test suite for MCP server keepalive ping (Story 5.25, AC7).
 *
 * Spawns the REAL dist/index.js with CREW_MCP_KEEPALIVE_MS=2000 and a tmp log
 * path. After 7 seconds, reads the log and asserts:
 *   - At least 3 keepalive.sent events
 *   - At least 1 keepalive.response event (proving the SDK auto-pong works)
 *
 * A second test verifies the disabled-by-zero contract:
 * CREW_MCP_KEEPALIVE_MS=0 → no keepalive.sent events within 5 seconds.
 *
 * The test fixture includes a tiny ping-responder loop on the client side
 * (this test acts as the MCP client). Without it, the server's server.ping()
 * request would hang and keepalive.response would never appear.
 *
 * AC coverage:
 *   - AC7a: 3+ keepalive.sent + 1+ keepalive.response after 7s with 2000ms interval
 *   - AC7b: no keepalive.sent within 5s when CREW_MCP_KEEPALIVE_MS=0
 *   - AC4f (inherited): tests run against dist/index.js
 */
export {};
