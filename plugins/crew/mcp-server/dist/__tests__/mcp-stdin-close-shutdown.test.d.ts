/**
 * Integration test suite for MCP child stdin-close behaviour (Story 5.25, AC5).
 *
 * These tests spawn the REAL dist/index.js as a child process and exercise the
 * new contract: on stdin close, the child exits CLEANLY (exit code 0) within
 * 5 seconds. Story 5.12's "survive stdin close" contract is inverted here
 * because Story 5.25 removed the zombie-keeping keep-alive in favour of the
 * spec-aligned approach (keepalive pings prevent the trigger; clean exit when
 * shutdown happens).
 *
 * AC coverage (Story 5.25):
 *   - AC5  / new-4a: on stdin close, child exits cleanly within 5 seconds (exit code 0)
 *   - AC4c (preserved): SIGTERM still terminates the child
 *   - AC4d (preserved): no premature exit during healthy steady-state (5-second window)
 *   - AC4e (preserved): no regression in tool dispatch (getStatus round-trip)
 *   - AC4f (preserved): tests run against dist/index.js (the shipped artefact), not src/
 *
 * NOT preserved from Story 5.12:
 *   - Old AC1/AC4a: "child survives stdin close" — inverted; clean exit is now the contract
 *   - Old AC2/AC4b: "stdout open after stdin close" — no longer a meaningful invariant
 *
 * Timeouts: individual tests declare explicit { timeout: ... } values.
 */
export {};
