/**
 * Thin wrapper around the Anthropic SDK exposing the small surface
 * area the MCP server needs for LLM-using adapters (Story 3.9).
 *
 * The wrapper is intentionally minimal — it does NOT cache, retry,
 * or interpret structured output. Callers (e.g. the BMad LLM-fallback
 * extractor) own those concerns so that each call site can tune
 * retry/cache policy without touching shared code.
 *
 * **Environment:** the client reads `ANTHROPIC_API_KEY` from
 * `process.env`. Callers that want to surface a friendly error when
 * the key is missing should check `hasAnthropicKey()` first.
 *
 * **Seam:** this is the only place in `mcp-server/src/**` that
 * imports `@anthropic-ai/sdk`. Future LLM-using adapters should
 * reuse this wrapper rather than instantiating their own client.
 * Tests should mock `@anthropic-ai/sdk` via `vi.mock`; the wrapper
 * is thin enough that mocking the SDK directly is sufficient.
 */
export type AnthropicMessageContent = {
    type: "text";
    text: string;
} | {
    type: string;
    [key: string]: unknown;
};
export type CreateMessageOptions = {
    model: string;
    /** System prompt; the wrapper passes through unchanged. */
    system?: string;
    /** User message text. */
    userText: string;
    /** Maximum output tokens. */
    maxTokens: number;
    /** Sampling temperature; default 0 for determinism. */
    temperature?: number;
};
export type CreateMessageResult = {
    /** Concatenation of all `text` content blocks in the response. */
    text: string;
    /** Raw stop reason ("end_turn", "max_tokens", "stop_sequence", "tool_use"). */
    stopReason: string | null;
};
export interface AnthropicClient {
    createMessage(opts: CreateMessageOptions): Promise<CreateMessageResult>;
}
/**
 * Returns `true` if `ANTHROPIC_API_KEY` is set in the environment.
 * Callers can use this to short-circuit with a friendly error
 * before instantiating the SDK (which would otherwise throw at
 * first request time).
 */
export declare function hasAnthropicKey(): boolean;
/**
 * Construct the default Anthropic client wrapper. Lazily instantiates
 * the SDK on first call. Reuses the same SDK instance across calls
 * within a single MCP server process.
 *
 * Pass a custom implementation in tests via `vi.mock` against this
 * module, or via dependency injection at the call site.
 */
export declare function getAnthropicClient(): AnthropicClient;
