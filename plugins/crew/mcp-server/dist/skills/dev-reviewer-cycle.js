/**
 * Dev → reviewer inner cycle — Story 4.3 Task 3.
 *
 * Orchestrates the inner loop of the `/crew:start` session:
 *   dev spawn → handoff parse → reviewer spawn → verdict parse →
 *   (rework | continue | blocked)
 *
 * **Behavioural contract source:**
 * `_bmad-output/implementation-artifacts/4-3-dev-reviewer-handoff-reviewer-spawn-and-rework-signal.md § Behavioural contract`
 *
 * Chat output flows through the returned `chatLog: string[]` — no console.*.
 * Errors propagate to the caller; `runStartLoop` surfaces them verbatim.
 *
 * The rework loop is implemented as a `while` loop (not recursion) with no
 * artificial iteration cap — see § does NOT (j) in the story spec.
 *
 * Story 4.3 Task 3.1–3.5.
 */
import { parseHandoff } from "./handoff-parser.js";
import { parseVerdict } from "./verdict-parser.js";
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Run the dev → reviewer inner cycle for a single story ref.
 *
 * The function spawns the dev subagent, parses its handoff phrase, spawns the
 * reviewer, parses the verdict, and handles the three outcome branches:
 * `READY FOR MERGE`, `NEEDS CHANGES` (rework), and `BLOCKED`.
 *
 * If either parser detects grammar drift, the in-progress manifest is stamped
 * with `blocked_by` and the function returns without spawning further.
 */
export async function runDevReviewerCycle(opts) {
    const { targetRepoRoot, sessionUlid, ref, title, manifestPath, deps } = opts;
    const chatLog = [];
    // Track rework count in memory — we sync to disk on each NEEDS CHANGES verdict.
    // Start at 0; the first rework sets it to 1.
    let localReworkCount = 0;
    // Rework loop — while because rework may iterate.
    while (true) {
        // -----------------------------------------------------------------------
        // Step 1: Spawn the dev subagent.
        // -----------------------------------------------------------------------
        const devPrompt = await deps.buildPrompt({
            targetRepoRoot,
            role: "generalist-dev",
        });
        const devInitialContext = {
            ref,
            title,
            sessionUlid,
            targetRepoRoot,
            manifestPath: `.crew/state/in-progress/${ref}.yaml`,
        };
        if (localReworkCount > 0) {
            devInitialContext["rework_iteration"] = localReworkCount;
        }
        const { transcript: devTranscript } = await deps.taskSpawnWithTranscript({
            systemPrompt: devPrompt.systemPrompt,
            subagentType: "general-purpose",
            initialContext: devInitialContext,
        });
        // -----------------------------------------------------------------------
        // Step 2: Parse the handoff phrase.
        // -----------------------------------------------------------------------
        const handoffResult = parseHandoff(devTranscript, ref);
        if (!handoffResult.ok) {
            // Grammar drift — stamp the manifest with blocked_by and return.
            const currentManifest = await deps.readManifest(manifestPath);
            const blockedManifest = {
                ...currentManifest,
                blocked_by: "handoff-grammar",
            };
            await deps.writeManifest(manifestPath, blockedManifest, {
                role: "orchestrator",
            });
            chatLog.push(`handoff grammar drift — story ${ref} blocked. expected verbatim phrase: "Handoff to reviewer — story ${ref} ready for review." Edit the manifest to clear blocked_by and re-run /crew:start.`);
            return { chatLog, finalState: "blocked-handoff-grammar" };
        }
        // -----------------------------------------------------------------------
        // Step 3: Handoff parsed OK — spawn the reviewer subagent.
        // -----------------------------------------------------------------------
        chatLog.push(`handoff received — story ${ref} — spawning generalist-reviewer subagent (clean context)`);
        const reviewerPrompt = await deps.buildPrompt({
            targetRepoRoot,
            role: "generalist-reviewer",
        });
        const reviewerInitialContext = {
            ref,
            title,
            session_ulid: sessionUlid,
            targetRepoRoot,
        };
        const { transcript: reviewerTranscript } = await deps.taskSpawnWithTranscript({
            systemPrompt: reviewerPrompt.systemPrompt,
            subagentType: "general-purpose",
            initialContext: reviewerInitialContext,
        });
        // -----------------------------------------------------------------------
        // Step 4: Parse the reviewer's verdict.
        // -----------------------------------------------------------------------
        const verdictResult = parseVerdict(reviewerTranscript);
        if (!verdictResult.ok) {
            // Reviewer grammar drift — stamp and return.
            const currentManifest = await deps.readManifest(manifestPath);
            const blockedManifest = {
                ...currentManifest,
                blocked_by: "reviewer-grammar",
            };
            await deps.writeManifest(manifestPath, blockedManifest, {
                role: "orchestrator",
            });
            chatLog.push(`reviewer grammar drift — story ${ref} blocked. expected verbatim final line: "**Verdict: <SENTINEL>**" where SENTINEL is one of READY FOR MERGE | NEEDS CHANGES | BLOCKED.`);
            return { chatLog, finalState: "blocked-reviewer-grammar" };
        }
        const { sentinel } = verdictResult;
        // -----------------------------------------------------------------------
        // Step 5: Handle the verdict.
        // -----------------------------------------------------------------------
        if (sentinel === "READY FOR MERGE") {
            chatLog.push(`reviewer verdict: READY FOR MERGE — story ${ref} ready for merge gate`);
            return { chatLog, finalState: "ready-for-merge" };
        }
        if (sentinel === "BLOCKED") {
            chatLog.push(`reviewer verdict: BLOCKED — story ${ref} awaiting human`);
            return { chatLog, finalState: "blocked-reviewer-verdict" };
        }
        // NEEDS CHANGES — increment rework_count and re-spawn the dev.
        const currentManifest = await deps.readManifest(manifestPath);
        localReworkCount = (currentManifest.rework_count ?? 0) + 1;
        const reworkManifest = {
            ...currentManifest,
            rework_count: localReworkCount,
        };
        // Write BEFORE re-spawning — the new value must be visible on-disk immediately.
        await deps.writeManifest(manifestPath, reworkManifest, {
            role: "orchestrator",
        });
        chatLog.push(`reviewer verdict: NEEDS CHANGES — re-spawning generalist-dev subagent (rework iteration ${localReworkCount})`);
        // Loop continues — re-spawning the dev with `rework_iteration` in context.
    }
}
