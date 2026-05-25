import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { BmadLlmExtractionError } from "../../errors.js";
import { writeManagedFile } from "../../lib/managed-fs.js";
import {
  getAnthropicClient,
  hasAnthropicKey,
  type AnthropicClient,
} from "../../lib/anthropic-client.js";
import type { AC, SourceStory } from "../adapter.js";

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

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";

const ACSchema = z.object({
  text: z.string(),
  kind: z.enum(["integration", "unit"]),
});

const ExtractedStorySchema = z.object({
  ref: z.string(),
  title: z.string(),
  narrative: z.string(),
  acceptance_criteria: z.array(ACSchema),
  depends_on: z.array(z.string()),
  implementation_notes: z.string().optional(),
});

const SYSTEM_PROMPT = [
  "You are a structured-data extractor for BMad-flavoured Markdown story specs.",
  "Your only job is to read the file the user pastes and return ONE JSON object",
  "matching the schema below — no prose, no markdown fences, no commentary.",
  "",
  "Schema (TypeScript-ish):",
  "{",
  "  ref: string,                       // 'bmad:<epic>.<story>' where story may be like '8' or '8b'",
  "  title: string,                     // the H1 title without the 'Story N.M:' prefix",
  "  narrative: string,                 // the prose under '## Story' before any sub-heading",
  "  acceptance_criteria: Array<{",
  "    text: string,                    // the body of one AC block",
  "    kind: 'integration' | 'unit',    // 'integration' if the AC heading is tagged (integration) or (user-surface), else 'unit'",
  "  }>,",
  "  depends_on: string[],              // refs from a '## Dependencies' section, normalised as 'bmad:<epic>.<story>'",
  "  implementation_notes?: string,     // contents of '## Dev Notes' (or '## Implementation Notes') as a single string; omit if absent",
  "}",
  "",
  "Rules:",
  "- The ref is derived from the file's epic/story numbering. The filename will be in the user message; use it.",
  "- Preserve letter suffixes on story numbers (e.g. '4-8b-...' → ref 'bmad:4.8b').",
  "- ACs may be headed in many shapes ('**AC1:**', '**AC1 — title:**', '**AC2 (integration):**', '### AC3', etc.). Recover them all.",
  "- If you cannot find any acceptance criteria, return an empty array — do NOT invent.",
  "- Return ONLY the JSON object. No prose. No backticks.",
].join("\n");

function buildUserMessage(filename: string, fileContents: string): string {
  return [
    `Filename: ${filename}`,
    "",
    "File contents:",
    "----",
    fileContents,
    "----",
    "",
    "Return the JSON object now.",
  ].join("\n");
}

/**
 * Stable cache directory under the workspace.
 */
function cacheDir(targetRepoRoot: string): string {
  return path.join(targetRepoRoot, ".crew", "state", "extraction-cache");
}

function cachePath(targetRepoRoot: string, sourceHash: string): string {
  return path.join(cacheDir(targetRepoRoot), `${sourceHash}.json`);
}

async function readCache(
  targetRepoRoot: string,
  sourceHash: string,
): Promise<SourceStory | null> {
  try {
    const raw = await fs.readFile(cachePath(targetRepoRoot, sourceHash), "utf8");
    const parsed = JSON.parse(raw) as SourceStory;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(
  targetRepoRoot: string,
  sourceHash: string,
  story: SourceStory,
): Promise<void> {
  await writeManagedFile({
    absPath: cachePath(targetRepoRoot, sourceHash),
    contents: JSON.stringify(story, null, 2),
    targetRepoRoot,
    mcpToolContext: { toolName: "extractBmadStoryLlm", role: "operator" },
  });
}

function stripCodeFences(text: string): string {
  // Some models occasionally wrap their reply in ```json fences despite the prompt.
  // Strip a single leading fence-line and a trailing fence-line if present.
  return text
    .replace(/^\s*```(?:json)?\s*\n/i, "")
    .replace(/\n```\s*$/i, "")
    .trim();
}

function parseModelJson(raw: string): unknown {
  // Find the first '{' and last '}' to tolerate stray characters.
  const stripped = stripCodeFences(raw);
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new SyntaxError("no JSON object found in model output");
  }
  const slice = stripped.slice(firstBrace, lastBrace + 1);
  return JSON.parse(slice);
}

async function callModel(
  client: AnthropicClient,
  model: string,
  filename: string,
  fileContents: string,
): Promise<string> {
  const resp = await client.createMessage({
    model,
    system: SYSTEM_PROMPT,
    userText: buildUserMessage(filename, fileContents),
    maxTokens: 4096,
    temperature: 0,
  });
  return resp.text;
}

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
export async function extractBmadStoryViaLlm(
  absPath: string,
  fileContents: string,
  opts: ExtractBmadStoryOptions,
): Promise<SourceStory> {
  const sourceHash = createHash("sha256").update(fileContents).digest("hex");

  // Cache hit short-circuits the model call.
  const cached = await readCache(opts.targetRepoRoot, sourceHash);
  if (cached) {
    // Defensive: rewrite the absolute path in case the cache was produced
    // under a different worktree layout, then return.
    return { ...cached, raw_path: absPath, source_hash: sourceHash };
  }

  if (!hasAnthropicKey()) {
    throw new BmadLlmExtractionError({
      path: absPath,
      reason: "ANTHROPIC_API_KEY is not set in the environment; cannot run the LLM fallback extractor",
    });
  }

  const client = opts.client ?? getAnthropicClient();
  const primaryModel = opts.primaryModel ?? HAIKU_MODEL;
  const retryModel = opts.retryModel ?? SONNET_MODEL;
  const filename = path.basename(absPath);

  const tryExtract = async (model: string): Promise<SourceStory> => {
    let rawText: string;
    try {
      rawText = await callModel(client, model, filename, fileContents);
    } catch (err) {
      throw new BmadLlmExtractionError({
        path: absPath,
        reason: `model '${model}' call failed`,
        underlying: err instanceof Error ? err.message : String(err),
      });
    }
    let parsedJson: unknown;
    try {
      parsedJson = parseModelJson(rawText);
    } catch (err) {
      throw new BmadLlmExtractionError({
        path: absPath,
        reason: `model '${model}' returned non-JSON output`,
        underlying: err instanceof Error ? err.message : String(err),
      });
    }
    const validated = ExtractedStorySchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new BmadLlmExtractionError({
        path: absPath,
        reason: `model '${model}' output failed schema validation`,
        underlying: validated.error.message,
      });
    }
    const v = validated.data;
    const story: SourceStory = {
      ref: v.ref,
      title: v.title,
      narrative: v.narrative,
      acceptance_criteria: v.acceptance_criteria as AC[],
      depends_on: v.depends_on,
      ...(v.implementation_notes !== undefined
        ? { implementation_notes: v.implementation_notes }
        : {}),
      raw_path: absPath,
      raw_frontmatter: {
        // Best-effort: status defaults to "backlog" so downstream routing
        // treats the recovered story as ingestable. The extractor does
        // NOT attempt to recover Status — drifted stories use the same
        // default as missing-Status stories (Story 3.8 Task 2).
        status: "backlog",
        // Mark provenance so downstream consumers can audit fallback usage.
        extracted_by_llm: true,
      },
      source_hash: sourceHash,
    };
    return story;
  };

  let primaryErr: BmadLlmExtractionError | undefined;
  try {
    const story = await tryExtract(primaryModel);
    await writeCache(opts.targetRepoRoot, sourceHash, story);
    return story;
  } catch (err) {
    if (err instanceof BmadLlmExtractionError) primaryErr = err;
    else throw err;
  }

  // Retry once on Sonnet.
  try {
    const story = await tryExtract(retryModel);
    await writeCache(opts.targetRepoRoot, sourceHash, story);
    return story;
  } catch (err) {
    if (err instanceof BmadLlmExtractionError) {
      throw new BmadLlmExtractionError({
        path: absPath,
        reason:
          `both primary (${primaryModel}) and retry (${retryModel}) extraction attempts failed`,
        underlying: `${primaryErr?.reason ?? "?"} | ${err.reason}`,
      });
    }
    throw err;
  }
}
