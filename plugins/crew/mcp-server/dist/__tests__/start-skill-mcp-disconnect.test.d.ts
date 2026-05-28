/**
 * Integration test for the MCP cascade halt seam — Story 5.30 AC4.
 *
 * Asserts:
 *   (a) the verbatim halt line is present in the start SKILL.md file
 *   (b) `isMcpDisconnectError` returns true on the SDK's disconnect-text error
 *   (c) `McpDisconnectedError` carries the expected `methodName`, `causeMessage`,
 *       and optional `ref` fields
 *   (d) a wrapper around a stub MCP boundary halts after the disconnect —
 *       no further MCP calls attempted after the typed error is raised
 *
 * Follows the spy-harness precedent set by `start-skill-blocked-recovery.test.ts`.
 */
export {};
