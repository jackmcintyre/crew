/**
 * Integration test suite for MCP lifecycle log (Story 5.25, AC6).
 *
 * Spawns the REAL dist/index.js with CREW_MCP_LIFECYCLE_LOG set to a tmp path,
 * drives a tools/list call, sends SIGTERM, and asserts the log file contains
 * the expected event sequence (boot → transport.connected → tool.call → signal → exit).
 *
 * A second test asserts that an unwritable log path does not crash the server
 * (server still answers tool calls; log writes silently noop).
 *
 * AC coverage:
 *   - AC6a: event sequence in log file after tools/list + SIGTERM
 *   - AC6b: unwritable log path does not crash the server
 *   - AC4f (inherited): tests run against dist/index.js
 */
export {};
