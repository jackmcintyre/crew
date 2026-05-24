/**
 * `processDevTranscript` MCP tool — Story 4.3b Task 2; extended by Story 4.5.
 *
 * Pure transcript-in / verdict-out function: receives the dev subagent's final
 * transcript (captured by the SKILL.md prose after the `Task` tool returns),
 * first checks for the locked recoverable-error marker line (Story 4.5), then
 * parses the handoff phrase (Story 4.3b), mutates the in-progress manifest on
 * grammar drift or recoverable error, and returns the next step for the prose layer.
 *
 * **Behavioural contract sources:**
 * - Story 4.3b: `_bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract`
 * - Story 4.5: `_bmad-output/implementation-artifacts/4-5-gh-error-map-yaml-and-recoverable-error-classification.md § Behavioural contract`
 *
 * This tool MUST NOT spawn anything. The MCP server runs over JSON-RPC stdio
 * and has no access to Claude Code's `Task` tool. Spawn responsibility belongs
 * exclusively to the SKILL.md prose layer.
 *
 * Chat lines flow through the returned `chatLog: string[]` — no console.*.
 * Errors propagate as typed `DomainError`s; `register.ts` wraps them.
 *
 * Story 4.3b Task 2.1–2.5; Story 4.5 Task 4.1–4.5.
 */

import * as path from "node:path";
import { parseHandoff } from "../skills/handoff-parser.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { readManifest, writeManifest } from "../lib/manifest-io.js";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ProcessDevTranscriptResult =
  | { next: "spawn-reviewer"; reviewerPrompt: string; chatLog: string[] }
  | { next: "done-blocked-handoff-grammar"; chatLog: string[] }
  | { next: "done-handoff-but-no-review-yet"; chatLog: string[] } // v1: unreachable; declared for ABI stability
  | { next: "done-blocked-gh-defer"; chatLog: string[] }
  | { next: "done-blocked-gh-retry"; chatLog: string[] }
  | { next: "done-blocked-gh-needs-human"; chatLog: string[] };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ProcessDevTranscriptOptions {
  targetRepoRoot: string;
  sessionUlid: string;
  ref: string;
  devTranscript: string;
}

// ---------------------------------------------------------------------------
// Recoverable-error locked phrase regex
// (Story 4.5 AC2e / Task 4.1)
// ---------------------------------------------------------------------------

const RECOVERABLE_ERROR_RE =
  /^gh-recoverable: class=(defer|retry|needs-human) subcommand=([a-z0-9-]+) exit=(\d+)/m;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Process the dev subagent's final transcript.
 *
 * 1. Checks for the locked recoverable-error marker line BEFORE calling `parseHandoff`.
 *    On match: stamps `blocked_by: gh-<class>` on the in-progress manifest and returns
 *    one of the three new `done-blocked-gh-<class>` result variants. (Story 4.5 AC2d)
 *
 * 2. Falls through to `parseHandoff` when no recoverable-error marker is present.
 *    On grammar drift: stamps `blocked_by: "handoff-grammar"` on the in-progress manifest.
 *    On success: calls `buildPersonaSpawnPrompt` for the reviewer and returns the prompt.
 *
 * The SKILL.md prose MUST pass `devTranscript` verbatim — no summarisation,
 * no editing, no extraction. The full final-message string is the contract.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.devTranscript - The dev subagent's complete final message, verbatim.
 */
export async function processDevTranscript(
  opts: ProcessDevTranscriptOptions,
): Promise<ProcessDevTranscriptResult> {
  const { targetRepoRoot, ref, devTranscript } = opts;
  const chatLog: string[] = [];

  const manifestPath = path.resolve(
    targetRepoRoot,
    ".crew",
    "state",
    "in-progress",
    `${ref}.yaml`,
  );

  // ---------------------------------------------------------------------------
  // Step 1: Check for the locked recoverable-error marker line FIRST.
  // (Story 4.5 AC2d / Task 4.1)
  // ---------------------------------------------------------------------------

  const recoverableMatch = RECOVERABLE_ERROR_RE.exec(devTranscript);

  if (recoverableMatch !== null) {
    const errorClass = recoverableMatch[1] as "defer" | "retry" | "needs-human";

    // Stamp blocked_by: gh-<class> on the in-progress manifest.
    // Overwrites any existing blocked_by value (most-recent failure wins per AC2h).
    const currentManifest = await readManifest(manifestPath);
    await writeManifest(manifestPath, {
      ...currentManifest,
      blocked_by: `gh-${errorClass}`,
    });

    // Build the verbatim chat line per AC2f.
    const actionHint = buildActionHint(errorClass);
    chatLog.push(
      `gh recoverable error (class=${errorClass}) — story ${ref} blocked. blocked_by stamped to gh-${errorClass}. Operator action: ${actionHint}`,
    );

    const next =
      errorClass === "defer"
        ? "done-blocked-gh-defer"
        : errorClass === "retry"
          ? "done-blocked-gh-retry"
          : "done-blocked-gh-needs-human";

    return { next, chatLog } as ProcessDevTranscriptResult;
  }

  // ---------------------------------------------------------------------------
  // Step 2: Parse the handoff phrase (existing path — unchanged from Story 4.3b).
  // ---------------------------------------------------------------------------

  const handoffResult = parseHandoff(devTranscript, ref);

  if (!handoffResult.ok) {
    // Grammar drift (or empty transcript) — stamp the manifest with blocked_by.
    const currentManifest = await readManifest(manifestPath);
    await writeManifest(manifestPath, {
      ...currentManifest,
      blocked_by: "handoff-grammar",
    });

    chatLog.push(
      `handoff grammar drift — story ${ref} blocked. expected verbatim phrase: "Handoff to reviewer — story ${ref} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`,
    );

    return { next: "done-blocked-handoff-grammar", chatLog };
  }

  // Handoff parsed OK — compute the reviewer spawn prompt.
  const { systemPrompt: reviewerPrompt } = await buildPersonaSpawnPrompt({
    targetRepoRoot,
    role: "generalist-reviewer",
  });

  chatLog.push(
    `handoff received — story ${ref} — spawning generalist-reviewer subagent (clean context)`,
  );

  return { next: "spawn-reviewer", reviewerPrompt, chatLog };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildActionHint(errorClass: "defer" | "retry" | "needs-human"): string {
  switch (errorClass) {
    case "defer":
      return "wait and re-run /crew:start";
    case "retry":
      return "transient network error; re-run /crew:start (v2 will auto-retry)";
    case "needs-human":
      return "run `gh auth login` then re-run /crew:start";
  }
}
