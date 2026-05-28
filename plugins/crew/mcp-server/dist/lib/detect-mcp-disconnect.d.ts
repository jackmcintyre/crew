/**
 * Detect whether an unknown error came from the MCP SDK's "child disconnected"
 * surface. Used by the prose-layer wrapper in `/crew:start`'s inner cycle to
 * decide whether to re-raise as `McpDisconnectedError` (Story 5.30).
 *
 * The SDK does not export a dedicated typed error for the "MCP server has
 * disconnected" condition — the contract is the message string. We match on
 * the small set of phrases observed in practice (and documented in the SDK
 * source). Adding new phrases here as the SDK evolves is the maintenance
 * cost; the trade-off is a deterministic, searchable seam without a hard
 * SDK-internals dependency.
 *
 * References:
 *   - Story 5.30 spec: _bmad-output/implementation-artifacts/5-30-mcp-cascade-halt-seam-and-lifecycle-diagnostics.md
 *   - Project memory: project_mcp_cascade_sigterm
 *   - SDK surface: @modelcontextprotocol/sdk transport errors
 */
/**
 * Return true if `err` carries a message matching any known MCP-disconnect
 * surface from the SDK. Tolerant to any error shape — extracts a string
 * message defensively and lowercases it before matching.
 *
 * Negative: regular DomainError instances and bare Errors with unrelated
 * messages return false.
 */
export declare function isMcpDisconnectError(err: unknown): boolean;
