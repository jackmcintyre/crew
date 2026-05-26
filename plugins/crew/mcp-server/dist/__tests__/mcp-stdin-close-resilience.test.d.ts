/**
 * Integration test suite for MCP child stdin-close resilience (Story 5.12).
 *
 * These tests spawn the REAL dist/index.js as a child process and exercise the
 * process-level keep-alive fix. They do NOT use the SDK client; raw
 * line-delimited JSON-RPC 2.0 over stdio is sufficient and more representative
 * of what Claude Code actually sends.
 *
 * AC coverage:
 *   - AC1  / AC4a: child survives stdin close (spawn-and-survive)
 *   - AC2  / AC4b: stdout is still open after stdin close
 *   - AC3  / AC4c: SIGTERM still terminates the child after survival
 *   - AC4d: no premature exit on healthy steady-state (sanity check)
 *   - AC4e: no regression in tool dispatch (getStatus round-trip before any
 *           stdin manipulation)
 *   - AC4f: tests run against dist/index.js (the shipped artefact), not src/
 *
 * NOT covered here (out-of-scope for Story 5.12):
 *   - Re-attach after stdin re-open (deferred work)
 *   - New CallTool request succeeding AFTER stdin close (requires re-attach)
 *
 * Timeouts: individual tests that wait for the keep-alive window declare an
 * explicit { timeout: 30000 } to override vitest's 5-second default.
 */
export {};
