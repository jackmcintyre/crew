import Anthropic from "@anthropic-ai/sdk";
let cachedClient;
function getSdkClient() {
    if (!cachedClient) {
        cachedClient = new Anthropic({});
    }
    return cachedClient;
}
/**
 * Returns `true` if `ANTHROPIC_API_KEY` is set in the environment.
 * Callers can use this to short-circuit with a friendly error
 * before instantiating the SDK (which would otherwise throw at
 * first request time).
 */
export function hasAnthropicKey() {
    const key = process.env["ANTHROPIC_API_KEY"];
    return typeof key === "string" && key.length > 0;
}
/**
 * Construct the default Anthropic client wrapper. Lazily instantiates
 * the SDK on first call. Reuses the same SDK instance across calls
 * within a single MCP server process.
 *
 * Pass a custom implementation in tests via `vi.mock` against this
 * module, or via dependency injection at the call site.
 */
export function getAnthropicClient() {
    return {
        async createMessage(opts) {
            const sdk = getSdkClient();
            const resp = await sdk.messages.create({
                model: opts.model,
                max_tokens: opts.maxTokens,
                temperature: opts.temperature ?? 0,
                ...(opts.system !== undefined ? { system: opts.system } : {}),
                messages: [{ role: "user", content: opts.userText }],
            });
            const text = (resp.content ?? [])
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("");
            return { text, stopReason: resp.stop_reason ?? null };
        },
    };
}
