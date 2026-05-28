/**
 * Integration test suite for MCP crash-resilience handlers (Story 5.25, AC3).
 *
 * Verifies that the three process-level resilience handlers installed by index.ts
 * log the event but do NOT crash the server:
 *
 *   - uncaughtException  → server survives and continues serving tool calls
 *   - unhandledRejection → server survives and continues serving tool calls
 *   - stdout 'error'     → tested indirectly: EPIPE on stdout does not kill server
 *
 * Also verifies that:
 *   - SIGTERM handler logs the signal event then exits with code 143 (AC3 + AC1)
 *   - SIGINT  handler logs the signal event then exits with code 130 (AC3 + AC1)
 *   - SIGHUP  handler logs the signal event then exits with code 129 (AC3 + AC1)
 *   - main().catch is preserved: server exits with code 1 on fatal main() rejection
 *
 * Tests run against the REAL dist/index.js (AC4f).
 *
 * AC coverage:
 *   - AC3a: uncaughtException handler logs and does NOT exit
 *   - AC3b: unhandledRejection handler logs and does NOT exit
 *   - AC3c: SIGTERM/SIGINT/SIGHUP handlers log then exit with conventional codes
 *   - AC3d: main().catch(err => process.exit(1)) is preserved
 */
export {};
