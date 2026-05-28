---
name: crew:start
description: "Claim the next ready story from the backlog, spawn a clean-context generalist-dev subagent, and drain the queue until empty."
allowed_tools: [getStatus, mintSessionUlid, claimNextStory, processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt, runReviewerSession, postReviewerComments, applyReviewerLabels, runAutoMergeGate, scanOrphanedInProgress, reattachOrphan, blockOrphanNoTranscript, Task, Write, Read]
---

<!-- Behavioural contract source: _bmad-output/implementation-artifacts/4-2-start-skill-and-per-story-dev-subagent-spawn.md § Behavioural contract -->
<!-- Inner-cycle behavioural contract: _bmad-output/implementation-artifacts/4-3b-harness-task-spawn-seam-for-rundevsession.md § Behavioural contract -->
<!-- Completion seam (revised): _bmad-output/implementation-artifacts/4-3c-call-completestory-after-ready-for-merge.md § Behavioural contract -->

# /crew:start

# What this skill does

Runs the dev-session loop: it picks each claimable story from `.crew/state/to-do/` in alphabetical ref order, calls `claimNextStory` to atomically move the manifest to `in-progress/`, then spawns the generalist-dev subagent via Claude Code's built-in `Task` tool with a clean context and the assembled persona system prompt. When the dev subagent finishes, the inner cycle parses the handoff phrase, spawns the generalist-reviewer subagent via Claude Code's `Task` tool in a clean context, and handles the verdict. When the candidate set is empty and `in-progress/` is also empty, the skill prints the queue-drained line and exits.

One `/crew:start` invocation is one session. The session ULID is minted once at the start and re-used for every `claimNextStory` call in the session. Each spawned subagent is given a fresh context isolated from the calling session and from sibling spawns.

# Prerequisites

- A target repo with `.crew/config.yaml` resolvable (or auto-detectable by the workspace resolver).
- At least one story scanned into `.crew/state/to-do/` (run `/crew:scan` first if the directory is empty).
- Hired personas at `<targetRepoRoot>/team/generalist-dev/PERSONA.md` and `<targetRepoRoot>/team/generalist-reviewer/PERSONA.md` (run `/crew:hire` or `/crew:skip-hiring` first — the persona files are required for spawn-prompt assembly).

# Steps

1. **Identify `targetRepoRoot`.** Use the current Claude Code workspace root as `targetRepoRoot`.

2. **Resolve the active adapter.** Call `getStatus({ targetRepoRoot })` as the FIRST MCP call in every `/crew:start` invocation. This (i) triggers the workspace resolver if `.crew/config.yaml` is absent, (ii) confirms an active adapter is resolvable, and (iii) lets `NoAdapterMatchedError` surface BEFORE any claim attempt. On any typed error (`NoAdapterMatchedError`, `UnknownAdapterError`, `AmbiguousAdapterError`), surface the error verbatim and stop.

3. **Mint the session ULID.** Call `mintSessionUlid()` exactly once. Store the returned `sessionUlid`. This ULID identifies "this dev session" — it is re-used for every `claimNextStory` call in this invocation. Each new `/crew:start` invocation gets a new ULID.

3.5. **Orphan-recovery branch (runs before every `claimNextStory` call, including the first).**

Before invoking `claimNextStory`, call `scanOrphanedInProgress({ targetRepoRoot, sessionUlid })`. The returned `orphans` array is alphabetically sorted by ref. For each orphan in order:

1. Surface the verbatim chat line: `[orphan] <ref> — claimed_by <staleUlid>` (substituting the orphan's `ref` and `staleUlid`).
2. Surface the verbatim prompt line: `reattach or skip? (reattach replays the persisted transcript; skip leaves the manifest in place)`.
3. Await operator input. The operator types `reattach` or `skip` exactly. Any other input is rejected with the verbatim chat line `unrecognised choice — type "reattach" or "skip"` and the prompt is re-rendered.
4. On `skip`: surface the verbatim chat line `skipped <ref> — manifest left in in-progress/ (will resurface on next /crew:start)` and advance to the next orphan in the array.
5. On `reattach` AND `orphan.hasTranscript === true`:
   a. Call `reattachOrphan({ targetRepoRoot, ref, currentSessionUlid: sessionUlid })`. Surface every entry of the returned `chatLog` in order.
   b. Read the persisted transcript file bytes via the built-in `Read` tool: `Read({ file_path: <targetRepoRoot>/.crew/state/sessions/<staleUlid>/dev-transcript.txt })`. The bytes are stored as the local variable `devTranscript`.
   c. Call `processDevTranscript({ targetRepoRoot, sessionUlid, ref, devTranscript })` — pass the bytes verbatim. The dev subagent is NOT spawned; the transcript is the dev subagent's already-captured output.
   d. Surface every entry of the returned `chatLog` in order.
   e. Switch on the `next` field exactly as in step 7 of the inner cycle (`spawn-reviewer` → continue to reviewer spawn at step 8; any `done-blocked-*` → advance to the next orphan or fall through to `claimNextStory`).
6. On `reattach` AND `orphan.hasTranscript === false` AND `orphan.hasOpenPR === true` (Story 5.20 — dev already shipped, reviewer died):
   a. Call `reattachOrphan({ targetRepoRoot, ref, currentSessionUlid: sessionUlid })`. Surface every entry of the returned `chatLog` in order.
   b. Surface the verbatim chat line: `[orphan-reviewer-respawn] <ref> — PR is open, skipping dev replay; spawning reviewer only` (with `<ref>` substituted at runtime).
   c. Build the reviewer prompt via `buildPersonaSpawnPrompt({ targetRepoRoot, role: "generalist-reviewer" })`.
   d. The `prNumber` for the reviewer spawn is NOT available from the orphan manifest — surface the verbatim prompt line: `enter PR number for <ref>:` and await operator input. Store as `prNumber`.
   e. Invoke the `Task` tool for the reviewer spawn (Step 8 of the inner cycle) using `prNumber` from the operator input. Proceed from Step 9 onward as normal.
   f. After the reviewer inner cycle completes, advance to the next orphan in the array.

7. On `reattach` AND `orphan.hasTranscript === false` AND `orphan.hasOpenPR === false`:
   a. Call `blockOrphanNoTranscript({ targetRepoRoot, ref, staleUlid })`. Surface every entry of the returned `chatLog` in order.
   b. Advance to the next orphan in the array.

After all orphans in the array have been resolved (each either reattached-and-completed, blocked, or skipped), proceed to step 4 (`claimNextStory`).

4. **Outer loop: claim the next story.** Call `claimNextStory({ targetRepoRoot, sessionUlid })`. Switch on the `next` field:
   - `queue-drained` or `waiting-on-in-progress` → surface every entry of the returned `chatLog` to the operator in order; exit the loop.
   - `spawn-dev` → surface every entry of the returned `chatLog` in order; store `ref`, `title`, `manifestPath`; continue to the inner cycle (step 5).

5. **Inner cycle.** Run the inner cycle for the claimed story (see `# Inner cycle: dev → reviewer → rework` section below). After the inner cycle returns its terminal verdict, loop back to step 4.

6. **Exit.** The loop exits only when `claimNextStory` returns `queue-drained` or `waiting-on-in-progress`. The skill terminates normally — no error thrown on queue-drained.

# Inner cycle: dev → reviewer → rework

After a story is claimed, the inner cycle manages the dev spawn → handoff parse → reviewer spawn → verdict parse loop. The SKILL.md prose owns the `Task` tool invocations; the MCP tools own the parsing and manifest mutations.

**Invariant: Every MCP call inside the inner cycle MUST be wrapped to surface `McpDisconnectedError` on disconnect.**
When `isMcpDisconnectError(err)` returns true for any error raised from an MCP call between step 5 (`processDevTranscript`) and step 12 (`runAutoMergeGate`), the wrapper MUST throw `McpDisconnectedError`. The catch-site surfaces the verbatim `[mcp-cascade-halted] …` line (see Failure modes) and stops — no further MCP calls, no retry. The deterministic-seam principle (memory `feedback_default_to_deterministic_seams`) applies: the typed error class is the contract, not the prose mandate. Step 4.5 (the `Write` tool persisting the dev transcript) is NOT in scope — Write is not an MCP call and survives the cascade. (Story 5.30)

**Invariant: The SKILL.md prose MUST pass the transcript verbatim — no summarisation, no editing.**
`devTranscript` (passed to `processDevTranscript`) MUST be the full final-message string returned by the `Task` tool — no extraction, no trimming. The reviewer's chat transcript is NOT passed to `processReviewerTranscript`; the verdict transport is the `reviewer-result.json` file written by `runReviewerSession` (Story 4.6 revision 2). `runReviewerSession` is the reviewer's only valid verdict-path; `processReviewerTranscript` reads the file, not the chat.

**Invariant: Orphan-recovery MUST NOT spawn a dev subagent.**
On `reattach` with a persisted transcript, the dev subagent's work has already been captured. The orphan branch reads the transcript file and feeds it verbatim into `processDevTranscript` — the next `Task` invocation (if any) is the reviewer spawn at step 8, never a dev spawn.

**Invariant: Orphan-recovery MUST run before every `claimNextStory` call.**
A new orphan may appear between outer-loop iterations (e.g., a concurrent session died). The scan runs at the top of every iteration — not once per `/crew:start` invocation.

**Invariant: The transcript MUST be persisted to disk before any MCP call.**
The persistence write in step 4.5 happens between `Task` return (step 4) and `processDevTranscript` (step 5). It is the prose layer's responsibility — there is no MCP tool that can be called here without defeating the durability guarantee (MCP may have died during the Task run).

## Dev spawn

1. Call `buildPersonaSpawnPrompt({ targetRepoRoot, role: "generalist-dev" })` to get the initial `devPrompt`.

2. Surface the verbatim line `spawning generalist-dev subagent (clean context)` to the operator.

3. invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt, with an `initial_context` block carrying:
   ```
   ref: <ref>
   title: <title>
   sessionUlid: <sessionUlid>
   targetRepoRoot: <targetRepoRoot>
   manifestPath: <manifestPath>
   ```
   If this is a rework iteration, also include `rework_iteration: <n>`.

4. When the `Task` tool returns, capture the dev subagent's final message as `devTranscript`.

4.5. Persist `devTranscript` to disk **before any MCP call**. Invoke the built-in `Write` tool with:
   - `file_path`: `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/dev-transcript.txt`
   - `content`: the verbatim `devTranscript` string (no trimming, no JSON-wrapping, no normalisation)

   Surface the verbatim chat line:

   ```
   dev transcript persisted — .crew/state/sessions/<sessionUlid>/dev-transcript.txt
   ```

   with `<sessionUlid>` substituted at runtime. The path in the chat line is relative to `targetRepoRoot` (omit the absolute prefix).

   **Why this happens before step 5:** if the MCP child has been idle-reaped during the long `Task` run, step 5 will throw "MCP server has disconnected" and the transcript will be lost. The write here uses Claude Code's built-in `Write` tool, which is independent of the MCP server and remains available after a reap. Story 5.11 reads this file to drive orphan recovery in a later session.

   **On `Write` failure:** surface the error verbatim and halt the inner cycle. Do NOT call `processDevTranscript`. The in-progress manifest is left in place — Story 5.11's orphan-recovery branch will surface it on the next `/crew:start` run.

5. pass the captured devTranscript to processDevTranscript({ targetRepoRoot, sessionUlid, ref, devTranscript }).

6. Surface every entry of the returned `chatLog` to the operator in order, before any subsequent call.

7. Switch on the `next` field:
   - `done-blocked-handoff-grammar` → return to outer loop (step 4).
   - `done-blocked-gh-defer` → surface the chatLog and return to outer loop (step 4).
   - `done-blocked-gh-retry` → surface the chatLog and return to outer loop (step 4).
   - `done-blocked-gh-needs-human` → surface the chatLog and return to outer loop (step 4).
   - `spawn-reviewer` → store `reviewerPrompt` AND `prNumber`; continue to reviewer spawn.

## Reviewer spawn

8. invoke the Task tool with the reviewerPrompt returned by processDevTranscript, with an `initial_context` block carrying:
   ```
   ref: <ref>
   title: <title>
   sessionUlid: <sessionUlid>
   targetRepoRoot: <targetRepoRoot>
   prNumber: <prNumber>
   ```

9. When the `Task` tool returns, the reviewer subagent's session result is already persisted to `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json` by `runReviewerSession`. No transcript capture is needed — the verdict transport is the file, not the chat.

9a. invoke postReviewerComments({ targetRepoRoot, sessionUlid }). This tool reads `reviewer-result.json` and posts a PR review with a deterministic summary body and inline comments via `gh api`. Switch on the `next` field:
   - `skipped-no-session-result` → log the chat line `post-reviewer-comments skipped — no reviewer-result.json (the missing-file case will be handled by processReviewerTranscript next)` and proceed to step 10.
   - `posted` AND `wasEdit === true` → log a chat line `reviewer-comments updated in place on PR #${prNumber}` and proceed to step 10.
   - `posted` AND `wasEdit === false` → log a chat line `posted PR review ${postedReviewId} — ${inlineCommentCount} inline comment(s), verdict: ${verdictLine}` and proceed to step 10.
   - If `postReviewerComments` throws (`GhRecoverableError`, `GhApiResponseShapeError`, `ReviewerResultFileMalformedError`, or any other error):
     - Best-effort: call `applyReviewerLabels({ targetRepoRoot, sessionUlid, verdictOverride: "reviewer-failure" })` in its own try/catch. If this label call also fails, log `apply-reviewer-labels failed in error handler: <secondaryError.message>` but do NOT let it replace the original error.
     - Surface the original error verbatim and halt the inner cycle. Do NOT proceed to step 10.

10. invoke processReviewerTranscript({ targetRepoRoot, sessionUlid, ref, manifestPath }). The tool reads `reviewer-result.json` and switches on its `recommendedVerdict` field to drive all manifest mutations.
   - If `processReviewerTranscript` throws (`ReviewerResultFileMalformedError`, `WrongClaimantError`, `InProgressHandEditError`, or any other error):
     - Best-effort: call `applyReviewerLabels({ targetRepoRoot, sessionUlid, verdictOverride: "reviewer-failure" })` in its own try/catch. If this label call also fails, log `apply-reviewer-labels failed in error handler: <secondaryError.message>` but do NOT let it replace the original error.
     - Surface the original error verbatim and halt the inner cycle. Do NOT proceed to step 10a.

10a. invoke applyReviewerLabels({ targetRepoRoot, sessionUlid }). This call is best-effort: wrap it in a try/catch. Switch on the `next` field:
   - `skipped-no-session-result` → log the chat line `apply-reviewer-labels skipped — no reviewer-result.json` and proceed to step 11.
   - `applied` → log the chat line `reviewer labels applied: ${result.labelsApplied.join(", ")} on PR #${prNumber}` and proceed to step 11.
   - If `applyReviewerLabels` throws: log `apply-reviewer-labels failed after processReviewerTranscript: <error.message>` but do NOT halt. The manifest has already been mutated by `processReviewerTranscript`; halting here would leave the operator without a clear recovery path. Labels are best-effort; proceed to step 11.

11. Surface every entry of the returned `chatLog` to the operator in order, before any subsequent call.

12. Switch on the `next` field:
    - `done-ready-for-merge` →
      1. Confirm `completed: true` is present on the returned object. This flag signals that `processReviewerTranscript` has already called `completeStory` internally and moved the manifest from `in-progress/<ref>.yaml` to `done/<ref>.yaml` before returning.
      2. emit the verbatim chat-surface line `story <ref> moved to done — claiming next` (with `<ref>` substituted at runtime).
      12.1. invoke runAutoMergeGate({ targetRepoRoot, prNumber, ref, sessionUlid }). Switch on the `decision` field:
         - `auto-merge` → log every entry of the returned `chatLog` to the operator, then return to outer loop step 4.
         - `pause-needs-human` → log every entry of the returned `chatLog` to the operator. The PR now carries the `needs-human` label; do NOT loop into rework — the story is already in `done/`. Return to outer loop step 4.
         - If `runAutoMergeGate` throws `GhRecoverableError`: log the error verbatim AND a follow-up line `auto-merge gate deferred — operator should re-run /crew:start or merge manually`. The manifest is already in `done/`; the story is closed from the plugin's POV. Return to outer loop step 4.
         - If `runAutoMergeGate` throws `AutoMergeGateThresholdInvalidError` or any other typed error: log the error verbatim and halt the inner cycle. The manifest is in `done/`; the operator needs to fix `.crew/config.yaml` before continuing.
      3. return to outer loop step 4 (`claimNextStory`).
    - `done-blocked-reviewer-needs-changes` → emit the verbatim chat line `reviewer verdict: NEEDS CHANGES — story <ref> needs dev rework` (with `<ref>` substituted). The manifest stays in `in-progress/` with `blocked_by: reviewer-verdict-needs-changes` (stamped by `processReviewerTranscript`). Loop back to step 3 (dev spawn) for rework — use the original `devPrompt` from `buildPersonaSpawnPrompt` and include `rework_iteration: <n>` in the `initial_context`.
    - `done-blocked-reviewer-blocked` → emit the verbatim chat line `reviewer verdict: BLOCKED — story <ref> awaiting human`. The manifest stays in `in-progress/` with `blocked_by: reviewer-verdict-blocked`. Do NOT loop — operator must intervene. Return to outer loop step 4.
    - `ReviewerFirstCallSkippedError` (thrown, caught by the step 10 `else` error handler) → the reviewer subagent terminated without ever calling `runReviewerSession`; the file-absent branch in `processReviewerTranscript` now throws instead of returning a discriminant. The error propagates to the step 10 error handler, which stamps `blocked_by` and surfaces the error verbatim. Do NOT loop — operator must inspect the reviewer transcript. Return to outer loop step 4.

**Invariant: MUST NOT invoke completeStory directly — processReviewerTranscript performs the move internally on the done-ready-for-merge branch.** The prose layer is not in the `completeStory` call path; `completeStory` is not in `allowed_tools`. **MUST NOT call completeStory on the done-blocked-reviewer-needs-changes or done-blocked-reviewer-blocked branch.** On any blocked branch the manifest stays in `in-progress/` with `blocked_by` already stamped by `processReviewerTranscript`. The prose surfaces the verbatim blocked line from `chatLog` and returns to the outer loop. If `processReviewerTranscript` raises any error on the green branch (propagated from `completeStory`), surface the error verbatim and exit — the outer loop MUST NOT proceed to the next `claimNextStory` call when a `completeStory` error propagated through `processReviewerTranscript`.

The rework loop is unbounded in v1 — Story 4.12's 30-min dev budget acts as the implicit cap.

# Failure modes

- **`NoAdapterMatchedError`**: Surface the error verbatim. The workspace resolver could not identify an adapter for this repo. Run `/crew:hire` first to establish the team, then add source stories (native: create `.crew/native-stories/`; BMad: run `/bmad-create-story`).

- **`InProgressHandEditError`**: Surface verbatim as `InProgressHandEditError: <message>`. The manifest for the ref being operated on was hand-edited after it was placed in `in-progress/`. v1 does not support mid-flight edits. Wait for the story to land in `done/` or `blocked/`, or discard it via `/crew:plan`.

- **`DependenciesNotReadyError`**: Surface verbatim as `DependenciesNotReadyError: <message>`. The story's `depends_on` refs are not yet in `done/`. The pre-check filter should catch most of these; this error surfaces only on a race between the pre-check and the claim call. Continue to the next candidate.

- **`WrongClaimantError`**: Surface verbatim as `WrongClaimantError: <message>`. A `completeStory` call was made by a session that did not claim the ref. This is a dev-subagent error surfaced by the sub-session; `/crew:start` logs it and continues.

- **`PersonaFileNotFoundError`** (from `buildPersonaSpawnPrompt`): The team copy of the `generalist-dev` or `generalist-reviewer` persona is missing. Run `/crew:hire` or `/crew:skip-hiring` before `/crew:start` to create it.

- **`HandoffGrammarDriftError`** / `blocked_by: handoff-grammar`: The dev subagent terminated without the verbatim locked handoff phrase on its last non-empty output line. The in-progress manifest is stamped with `blocked_by: "handoff-grammar"` (in-place — Story 5.1 will retrofit the atomic move to `blocked/`). The chat surface prints the verbatim drift line (emitted by `processDevTranscript`). Recovery hint: see `BLOCKED_BY_HINTS["handoff-grammar"]` in `mcp-server/src/lib/blocked-by-hints.ts`.

- **`done-blocked-reviewer-needs-changes`** / `blocked_by: reviewer-verdict-needs-changes`: `runReviewerSession` found one or more failing ACs (`status: "fail"`); `recommendedVerdict` is `"NEEDS CHANGES"`. The in-progress manifest is stamped with `blocked_by: "reviewer-verdict-needs-changes"` by `processReviewerTranscript`. The inner cycle loops back to spawn a new dev subagent for rework. Recovery hint: see `BLOCKED_BY_HINTS["reviewer-verdict-needs-changes"]` in `mcp-server/src/lib/blocked-by-hints.ts`.

- **`done-blocked-reviewer-blocked`** / `blocked_by: reviewer-verdict-blocked`: `runReviewerSession` returned `recommendedVerdict: "BLOCKED"` (empty ACs or manual-check-required ACs present). The in-progress manifest is stamped with `blocked_by: "reviewer-verdict-blocked"`. Human operator must intervene before the story can proceed. Recovery hint: see `BLOCKED_BY_HINTS["reviewer-verdict-blocked"]` in `mcp-server/src/lib/blocked-by-hints.ts`.

- **`ReviewerFirstCallSkippedError`** / `blocked_by: reviewer-no-session-result`: The reviewer subagent ran but did not call `runReviewerSession`; `reviewer-result.json` was not persisted. `processReviewerTranscript` throws `ReviewerFirstCallSkippedError` (Story 5.21 deterministic seam — file-absent branch now throws instead of returning a discriminant). The in-progress manifest is stamped by the error handler. Operator must inspect the reviewer's transcript to understand why the mandatory tool invocation was skipped. Recovery hint: see `BLOCKED_BY_HINTS["reviewer-no-session-result"]` in `mcp-server/src/lib/blocked-by-hints.ts`.

- **`ReviewerResultFileMalformedError`**: `reviewer-result.json` exists but fails JSON parse or shape validation (missing/invalid `recommendedVerdict` field). This is a bug in `runReviewerSession`; the file should always be schema-valid when present. Surface the error verbatim and stop.

- **`GhApiResponseShapeError`** (from `postReviewerComments`): `gh api` or `gh pr view` returned a response that could not be parsed as the expected JSON shape. Surface the error verbatim and halt the inner cycle. Do NOT proceed to `processReviewerTranscript`.

- **`GhApiResponseShapeError` or `GhRecoverableError`** (from `applyReviewerLabels` at step 10a): the label-posting `gh api` call failed after a successful `processReviewerTranscript`. This is best-effort: log the failure and proceed to step 11 — do NOT halt. If `applyReviewerLabels` fails in the step-10 or step-9a error handlers (as a secondary best-effort call), log the secondary failure and surface the original error unchanged.

- **`postReviewerComments` raising `GhRecoverableError`**: The `gh pr diff` or `gh api` call within `postReviewerComments` failed with a recoverable class (rate-limit, auth, network). Surface the error verbatim and halt the inner cycle — a posting failure indicates an environmental problem worth pausing for. Do NOT proceed to `processReviewerTranscript`.

- **`completeStory` raising `WrongClaimantError` or `InProgressHandEditError`**: On the `READY FOR MERGE` branch, `processReviewerTranscript` calls `completeStory` internally. If the in-progress manifest has been hand-edited since claim (FR14a) OR the session ULID does not match `claimed_by` (FR19), `completeStory` raises `InProgressHandEditError` or `WrongClaimantError` respectively. These errors propagate verbatim THROUGH `processReviewerTranscript` to the prose layer, which surfaces them and exits — the outer loop does NOT advance to the next `claimNextStory` call. Recovery is operator inspection of the in-progress manifest plus a fresh `/crew:start` invocation.

- **`Write` failure persisting dev transcript** (step 4.5): The built-in `Write` tool threw a filesystem error (disk full, permission denied, EROFS). The inner cycle halts; `processDevTranscript` is NOT called; the in-progress manifest is untouched. Operator recovery: inspect filesystem permissions and free space under `<targetRepoRoot>/.crew/state/sessions/`, then re-run `/crew:start`. Once Story 5.11 ships, the next `/crew:start` will surface this manifest as `[orphan]` and route it through the orphan-recovery branch.

- **`McpDisconnectedError`** (any MCP call inside the inner cycle, steps 5–12): The MCP child has been killed mid-cycle by Claude Code's SIGTERM cascade on subagent `Task` return (RCA: 8/8 paired SIGTERMs across 4 incidents; see project memory `project_mcp_cascade_sigterm`). The wrapper raises `McpDisconnectedError` carrying `methodName`, `causeMessage`, and optional `ref`. The catch-site MUST emit the following verbatim halt line and stop — no further MCP calls; the manifest is left in `in-progress/` for Story 5.20's orphan-recovery branch on the next restart:

  ```
  [mcp-cascade-halted] MCP child killed by subagent Task termination — restart Claude Code and re-run /crew:start. The in-progress manifest will surface as an orphan; choose "reattach" to resume without losing work.
  ```

  Recovery (operator): restart Claude Code, re-run `/crew:start`, choose `reattach` on the orphan that surfaces. Story 5.10's transcript-persistence invariant guarantees no completed work is lost; only the in-flight reviewer cycle is replayed. The cascade fix surface lives outside the plugin — v1 accepts the limitation and halts cleanly. See project memory `project_mcp_cascade_sigterm` for the RCA and Path D2 (the v1.1 candidate fix).

- **`NotAnOrphanError`** (from `reattachOrphan` in step 3.5.5.a): The manifest's `claimed_by` matched the current `sessionUlid` at the moment of the rewrite — a race where the orphan was claimed by another concurrent step between the scan and the rewrite. Surface verbatim and advance to the next orphan (the scan will re-run on the next outer-loop iteration).

- **Operator types an unrecognised choice at the orphan prompt:** Re-render the prompt with the rejection line `unrecognised choice — type "reattach" or "skip"`. Do NOT advance until a valid choice is received. Do NOT auto-default to `skip`.

- **`Read` failure for the transcript file (step 3.5.5.b)**: The file was present at scan time but vanished or became unreadable before the read. Surface the error verbatim, fall through to the no-transcript path (call `blockOrphanNoTranscript`) for the same orphan. Operator inspection captures the disappeared transcript.

- **`AutoMergeGateThresholdInvalidError`** (from `runAutoMergeGate` at step 12.1): The `plugin.agreement_threshold` value in `.crew/config.yaml` (or a caller-supplied `thresholdOverride`) is outside the valid range `[0, 1]`, is `NaN`, or is non-finite. The manifest is already in `done/` (the story completed successfully). Fix the `plugin.agreement_threshold` value in `.crew/config.yaml` and re-run `/crew:start`, or merge the PR manually.

# Blocked-manifest recovery hints

When `/crew:start` encounters a manifest in `blocked/` during the outer loop (or a manifest in `in-progress/` with a `blocked_by` value stamped by the inner cycle), the per-case recovery hint is keyed off the `blocked_by` typed value. The hint text lives in `mcp-server/src/lib/blocked-by-hints.ts` as `BLOCKED_BY_HINTS[<member>]` — the prose layer surfaces the tool-written artefact's return shape verbatim (per project memory `feedback_default_to_deterministic_seams`; per Story 5.13 AC3).

Each hint has the form `[<blocked-by-member>] <ref> — <operator action>` and contains a concrete next step rather than the generic `clear blocked_by and re-run` phrase.

Call `renderBlockedRecoveryHint(blockedBy, ref)` (exported from `mcp-server/src/lib/blocked-by-hints.ts`) to produce the rendered hint for any `blocked_by` value. The skill MUST surface this rendered string verbatim in the operator's chat output.

- **`auto-merge-gate-deferred`** (`GhRecoverableError` from `runAutoMergeGate` at step 12.1): The `gh pr merge` or `gh api` call failed with a recoverable class (rate-limit, auth, network). The manifest is already in `done/`; the story is closed from the plugin's POV. The PR was NOT merged and the `needs-human` label was NOT applied (the gh call failed before the label). Operator action: re-run `/crew:start` to retry the gate, or merge the PR manually.

Note: `runDevSession` is no longer used. The SKILL.md prose now drives the inner cycle directly via `Task` tool invocations, with `processDevTranscript` and `processReviewerTranscript` handling the parsing and manifest mutations.

# Termination conditions

The skill terminates normally (no error) when:

- `claimNextStory` returns `next: "queue-drained"` (both `to-do/` empty after filtering to `depsReady: true` and `in-progress/` empty).

At that point, print exactly:

```
queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.
```

This line is verbatim. Do not paraphrase, reword, add emoji, or add punctuation beyond what is written above.
