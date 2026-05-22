/**
 * `processReviewerTranscript` MCP tool — Story 4.3b Task 3.
 *
 * Pure transcript-in / verdict-out function: receives the reviewer subagent's
 * final transcript (captured by the SKILL.md prose after the `Task` tool
 * returns), parses the verdict sentinel, mutates the in-progress manifest on
 * rework or grammar drift, and returns the next step for the prose layer.
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
 * Story 4.3b Task 3.1–3.5.
 */
import { parseVerdict } from "../skills/verdict-parser.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { readManifest, writeManifest } from "../lib/manifest-io.js";
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Process the reviewer subagent's final transcript.
 *
 * Calls `parseVerdict` exactly once. On grammar drift: stamps
 * `blocked_by: "reviewer-grammar"` on the in-progress manifest. On
 * `NEEDS CHANGES`: increments `rework_count`, writes to disk BEFORE composing
 * the dev re-spawn prompt, then returns the next dev prompt. On `READY FOR
 * MERGE` or `BLOCKED`: pass-through (no manifest mutation).
 *
 * The SKILL.md prose MUST pass `reviewerTranscript` verbatim — no
 * summarisation, no editing. The full final-message string is the contract.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID of the calling dev session.
 * @param opts.ref - Story ref (e.g. `"native:01HZ..."`).
 * @param opts.manifestPath - Absolute path to the in-progress manifest.
 * @param opts.reviewerTranscript - The reviewer subagent's complete final message, verbatim.
 */
export async function processReviewerTranscript(opts) {
    const { targetRepoRoot, ref, manifestPath, reviewerTranscript } = opts;
    const chatLog = [];
    // Parse the reviewer verdict exactly once.
    const verdictResult = parseVerdict(reviewerTranscript);
    if (!verdictResult.ok) {
        // Grammar drift (drift, empty, or unknown-sentinel) — stamp the manifest.
        const currentManifest = await readManifest(manifestPath);
        await writeManifest(manifestPath, {
            ...currentManifest,
            blocked_by: "reviewer-grammar",
        });
        chatLog.push(`reviewer grammar drift — story ${ref} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`);
        return { next: "done-blocked-reviewer-grammar", chatLog };
    }
    const { sentinel } = verdictResult;
    if (sentinel === "READY FOR MERGE") {
        // Pass-through — no manifest mutation.
        chatLog.push(`reviewer verdict: READY FOR MERGE — story ${ref} ready for merge gate`);
        return { next: "done-ready-for-merge", chatLog };
    }
    if (sentinel === "BLOCKED") {
        // Pass-through — no manifest mutation.
        chatLog.push(`reviewer verdict: BLOCKED — story ${ref} awaiting human`);
        return { next: "done-blocked-reviewer-verdict", chatLog };
    }
    // NEEDS CHANGES — increment rework_count, write BEFORE composing dev prompt.
    const currentManifest = await readManifest(manifestPath);
    const newReworkCount = (currentManifest.rework_count ?? 0) + 1;
    await writeManifest(manifestPath, {
        ...currentManifest,
        rework_count: newReworkCount,
    });
    // Compute the dev re-spawn prompt.
    const { systemPrompt: devPrompt } = await buildPersonaSpawnPrompt({
        targetRepoRoot,
        role: "generalist-dev",
    });
    chatLog.push(`reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration ${newReworkCount})`);
    return {
        next: "rework-dev",
        devPrompt,
        reworkIteration: newReworkCount,
        chatLog,
    };
}
