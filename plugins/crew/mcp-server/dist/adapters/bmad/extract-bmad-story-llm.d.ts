import { type AnthropicClient } from "../../lib/anthropic-client.js";
import type { SourceStory } from "../adapter.js";
/**
 * LLM fallback for `parseBmadStory` (Story 3.9).
 *
 * Invoked from the scan-sources loop when the deterministic regex
 * parser throws `MalformedBmadStoryError`. The fallback issues a
 * deterministic (temperature: 0) Claude request asking the model
 * to extract the structured `SourceStory` shape from arbitrary
 * BMad-flavoured Markdown.
 *
 * **Deterministic-first:** this path is the safety net, not the
 * default. The regex parser handles the common case (clean stories)
 * at microsecond cost; the LLM fallback handles drift at second-scale
 * cost. The codebase principle is "deterministic seams first,
 * LLM second" (see `feedback_default_to_deterministic_seams.md`).
 *
 * **Model strategy:** Haiku 4.5 first (cheap, fast). If the Haiku
 * response fails JSON parsing or schema validation, retry once
 * against Sonnet 4.6 (sturdier on weird inputs).
 *
 * **Cache:** keyed by `source_hash` (sha256 of file bytes). The
 * cache lives under `.crew/state/extraction-cache/<hash>.json`.
 * A cache hit short-circuits the model call. The cache survives
 * across scans, so re-scanning an unchanged drifted story costs
 * zero tokens.
 *
 * **Token-budget guard:** the caller (scan-sources) tracks the
 * number of fallback invocations per scan and emits a warning at
 * 10 invocations. The extractor itself has no per-scan budget —
 * that policy lives at the orchestration layer.
 */
export declare const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export declare const SONNET_MODEL = "claude-sonnet-4-6";
export type ExtractBmadStoryOptions = {
    /** Workspace root, used to locate the on-disk extraction cache. */
    targetRepoRoot: string;
    /** Anthropic client; defaults to the shared lazy SDK wrapper. */
    client?: AnthropicClient;
    /** Override the primary model. Defaults to Haiku 4.5. */
    primaryModel?: string;
    /** Override the retry model. Defaults to Sonnet 4.6. */
    retryModel?: string;
};
/**
 * Extract a `SourceStory` from drifted BMad Markdown via an LLM
 * round-trip. Pure async function (no globals besides the lazy SDK).
 *
 * Throws `BmadLlmExtractionError` when both the primary and retry
 * model calls fail to produce a schema-valid `SourceStory`.
 */
export declare function extractBmadStoryViaLlm(absPath: string, fileContents: string, opts: ExtractBmadStoryOptions): Promise<SourceStory>;
