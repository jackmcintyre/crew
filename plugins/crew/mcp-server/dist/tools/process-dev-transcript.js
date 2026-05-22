/**
 * `processDevTranscript` MCP tool — Story 4.3b Task 2.
 *
 * Pure transcript-in / verdict-out function: receives the dev subagent's final
 * transcript (captured by the SKILL.md prose after the `Task` tool returns),
 * parses the handoff phrase, mutates the in-progress manifest on grammar drift,
 * and returns the next step for the prose layer.
 *
 * **Behavioural contract source:**
 * `_bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract`
 *
 * This tool MUST NOT spawn anything. The MCP server runs over JSON-RPC stdio
 * and has no access to Claude Code's `Task` tool. Spawn responsibility belongs
 * exclusively to the SKILL.md prose layer.
 *
 * Chat lines flow through the returned `chatLog: string[]` — no console.*.
 * Errors propagate as typed `DomainError`s; `register.ts` wraps them.
 *
 * Story 4.3b Task 2.1–2.5.
 */
import * as path from "node:path";
import { parseHandoff } from "../skills/handoff-parser.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { readManifest, writeManifest } from "../lib/manifest-io.js";
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Process the dev subagent's final transcript.
 *
 * Calls `parseHandoff` exactly once. On grammar drift: stamps `blocked_by:
 * "handoff-grammar"` on the in-progress manifest. On success: calls
 * `buildPersonaSpawnPrompt` for the reviewer and returns the prompt.
 *
 * The SKILL.md prose MUST pass `devTranscript` verbatim — no summarisation,
 * no editing, no extraction. The full final-message string is the contract.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.devTranscript - The dev subagent's complete final message, verbatim.
 */
export async function processDevTranscript(opts) {
    const { targetRepoRoot, ref, devTranscript } = opts;
    const chatLog = [];
    // Parse the handoff phrase exactly once.
    const handoffResult = parseHandoff(devTranscript, ref);
    if (!handoffResult.ok) {
        // Grammar drift (or empty transcript) — stamp the manifest with blocked_by.
        const manifestPath = path.resolve(targetRepoRoot, ".crew", "state", "in-progress", `${ref}.yaml`);
        const currentManifest = await readManifest(manifestPath);
        await writeManifest(manifestPath, {
            ...currentManifest,
            blocked_by: "handoff-grammar",
        });
        chatLog.push(`handoff grammar drift — story ${ref} blocked. expected verbatim phrase: "Handoff to reviewer — story ${ref} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`);
        return { next: "done-blocked-handoff-grammar", chatLog };
    }
    // Handoff parsed OK — compute the reviewer spawn prompt.
    const { systemPrompt: reviewerPrompt } = await buildPersonaSpawnPrompt({
        targetRepoRoot,
        role: "generalist-reviewer",
    });
    chatLog.push(`handoff received — story ${ref} — spawning generalist-reviewer subagent (clean context)`);
    return { next: "spawn-reviewer", reviewerPrompt, chatLog };
}
