/**
 * MCP-tool-boundary tests for `computeAgreement` (Story 4.10 AC4k).
 *
 * Drives the tool through the registered MCP server with an in-memory
 * transport. Asserts:
 *   - Input validation rejects non-positive / wrong-type `lastNVerdicts`.
 *   - Valid input returns the helper's output as JSON.stringify text.
 *   - The `null` branch is rendered as the literal text "null".
 *   - The registered tool name is exactly `computeAgreement`.
 */
export {};
