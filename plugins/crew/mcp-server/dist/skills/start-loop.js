/**
 * `runStartLoop` — Story 4.2 Task 8.
 *
 * The claim-spawn-terminate loop that the `/crew:start` SKILL.md skill prose
 * maps to. This function is plain TypeScript — no `console.log`, no LLM-side
 * state. Chat output flows through the returned `chatLog: string[]` array so
 * vitest integration tests can assert verbatim line presence without a Claude
 * Code harness.
 *
 * **Test seam:** production callers wire `listTodos`, `claim`, `buildPrompt`,
 * and `taskSpawn` to the real MCP tools and the real Claude Code `Task` tool.
 * Integration tests pass fakes for each dependency so the loop body can be
 * driven deterministically without a running Claude Code process.
 *
 * **Behavioural contract (from Story 4.2 § Behavioural contract):**
 * - Prints the session header BEFORE any loop iteration.
 * - MUST call `buildPrompt` once per spawn (never cache across spawns).
 * - MUST print the queue-drained line verbatim on the drain path.
 * - MUST NOT call `buildPrompt` or `claim` on the drain path.
 * - Surfaces typed errors verbatim as `<ErrorName>: <message>`.
 * - Iterates candidates in the stable ref-alphabetical order returned by
 *   `listTodos`.
 * - On each loop pass, skips refs where `depsReady: false` silently.
 * - Loops until both `todos` (depsReady=true) and `inProgressCount` are empty.
 *
 * Story 4.2 Task 8.1–8.4.
 */
/** Verbatim queue-drained line from AC3 / AC5(iv) — do not paraphrase. */
export const QUEUE_DRAINED_LINE = "queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.";
/**
 * Run the `/crew:start` claim-spawn-terminate loop.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.sessionUlid - ULID minted once at invocation time; re-used for
 *   every `claimStory` call in this session.
 * @param opts.deps - Injectable dependencies (production or test fakes).
 * @returns `{ chatLog }` — ordered list of lines printed to chat. Callers
 *   (production) emit these to the operator. Tests assert against them.
 */
export async function runStartLoop(opts) {
    const { targetRepoRoot, sessionUlid, deps } = opts;
    const chatLog = [];
    // Print session header.
    chatLog.push(`dev session — workspace: ${targetRepoRoot} — session: ${sessionUlid}`);
    // Loop until the queue is drained.
    while (true) {
        const { todos, inProgressCount } = await deps.listTodos({ targetRepoRoot });
        // Filter to candidates that are deps-ready.
        const eligible = todos.filter((c) => c.depsReady);
        // Queue-drained check: no eligible candidates AND no in-progress.
        if (eligible.length === 0 && inProgressCount === 0) {
            chatLog.push(QUEUE_DRAINED_LINE);
            break;
        }
        // If there are no eligible todos but inProgress > 0, the session cannot
        // progress further (all remaining todos are deps-blocked on in-progress
        // work). Terminate without printing the queue-drained anchor — the
        // in-progress stories are still running, so the queue is NOT drained.
        if (eligible.length === 0) {
            // Deps-blocked with active in-progress work — cannot progress further this session.
            chatLog.push("waiting on in-progress work — no claimable todos this pass. Stop here or wait for in-progress stories to complete.");
            break;
        }
        // Iterate eligible candidates in ref-alphabetical order (order preserved from listTodos).
        for (const candidate of eligible) {
            await processCandidate(candidate, { targetRepoRoot, sessionUlid, deps, chatLog });
        }
    }
    return { chatLog };
}
async function processCandidate(candidate, opts) {
    const { targetRepoRoot, sessionUlid, deps, chatLog } = opts;
    const { ref, title } = candidate;
    const displayTitle = title ?? "<title-unavailable>";
    // Print claiming line BEFORE claim call.
    chatLog.push(`claiming ${ref} — ${displayTitle}`);
    // Call claimStory. On any typed error, surface verbatim and continue.
    try {
        await deps.claim({
            targetRepoRoot,
            ref,
            sessionUlid,
            role: "orchestrator",
        });
    }
    catch (err) {
        const name = err instanceof Error ? err.constructor.name : "Error";
        const message = err instanceof Error ? err.message : String(err);
        chatLog.push(`${name}: ${message}`);
        return;
    }
    // Claim succeeded — build the persona prompt (one read per spawn).
    let promptResult;
    try {
        promptResult = await deps.buildPrompt({
            targetRepoRoot,
            role: "generalist-dev",
        });
    }
    catch (err) {
        const name = err instanceof Error ? err.constructor.name : "Error";
        const message = err instanceof Error ? err.message : String(err);
        chatLog.push(`${name}: ${message}`);
        return;
    }
    // Print spawning line BEFORE Task invocation.
    chatLog.push("spawning generalist-dev subagent (clean context)");
    // Derive manifest path (relative).
    const manifestPath = `.crew/state/in-progress/${ref}.yaml`;
    // Invoke the Task tool. Awaiting means we wait for the subagent to finish
    // before moving to the next candidate — per Story 4.2 spec ("When the Task
    // spawn returns, continue the loop").
    try {
        await deps.taskSpawn({
            systemPrompt: promptResult.systemPrompt,
            subagentType: "general-purpose",
            initialContext: {
                ref,
                title: displayTitle,
                sessionUlid,
                targetRepoRoot,
                manifestPath,
            },
        });
    }
    catch (err) {
        const name = err instanceof Error ? err.constructor.name : "Error";
        const message = err instanceof Error ? err.message : String(err);
        chatLog.push(`${name}: ${message}`);
        // Don't rethrow — subagent errors should not abort the loop.
    }
}
