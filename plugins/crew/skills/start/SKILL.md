---
name: crew:start
description: "Claim the next ready story from the backlog, spawn a clean-context generalist-dev subagent, and drain the queue until empty."
allowed_tools: [getStatus, mintSessionUlid, claimNextStory, processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt, runReviewerSession, Task]
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

4. **Outer loop: claim the next story.** Call `claimNextStory({ targetRepoRoot, sessionUlid })`. Switch on the `next` field:
   - `queue-drained` or `waiting-on-in-progress` → surface every entry of the returned `chatLog` to the operator in order; exit the loop.
   - `spawn-dev` → surface every entry of the returned `chatLog` in order; store `ref`, `title`, `manifestPath`; continue to the inner cycle (step 5).

5. **Inner cycle.** Run the inner cycle for the claimed story (see `# Inner cycle: dev → reviewer → rework` section below). After the inner cycle returns its terminal verdict, loop back to step 4.

6. **Exit.** The loop exits only when `claimNextStory` returns `queue-drained` or `waiting-on-in-progress`. The skill terminates normally — no error thrown on queue-drained.

# Inner cycle: dev → reviewer → rework

After a story is claimed, the inner cycle manages the dev spawn → handoff parse → reviewer spawn → verdict parse loop. The SKILL.md prose owns the `Task` tool invocations; the MCP tools own the parsing and manifest mutations.

**Invariant: The SKILL.md prose MUST pass the transcript verbatim — no summarisation, no editing.**
Both `devTranscript` (passed to `processDevTranscript`) and `reviewerTranscript` (passed to `processReviewerTranscript`) MUST be the full final-message string returned by the `Task` tool — no extraction, no trimming.

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

9. When the `Task` tool returns, capture the reviewer subagent's final message as `reviewerTranscript`.

10. pass the captured reviewerTranscript to processReviewerTranscript({ targetRepoRoot, sessionUlid, ref, manifestPath, reviewerTranscript }).

11. Surface every entry of the returned `chatLog` to the operator in order, before any subsequent call.

12. Switch on the `next` field:
    - `done-ready-for-merge` →
      1. Confirm `completed: true` is present on the returned object. This flag signals that `processReviewerTranscript` has already called `completeStory` internally and moved the manifest from `in-progress/<ref>.yaml` to `done/<ref>.yaml` before returning.
      2. emit the verbatim chat-surface line `story <ref> moved to done — claiming next` (with `<ref>` substituted at runtime).
      3. return to outer loop step 4 (`claimNextStory`).
    - `done-blocked-reviewer-verdict` → return to outer loop (step 4).
    - `done-blocked-reviewer-grammar` → return to outer loop (step 4).
    - `rework-dev` → store `devPrompt` and `reworkIteration`; loop back to step 3 (dev spawn), using the `devPrompt` returned by `processReviewerTranscript` in place of the initial dev prompt, and adding `rework_iteration: <reworkIteration>` to the `initial_context`.

**Invariant: MUST NOT invoke completeStory directly — processReviewerTranscript performs the move internally on the done-ready-for-merge branch.** The prose layer is not in the `completeStory` call path; `completeStory` is not in `allowed_tools`. **MUST NOT call completeStory on the done-blocked-reviewer-verdict or done-blocked-reviewer-grammar branch.** On either blocked branch the manifest stays in `in-progress/` with `blocked_by` already stamped by `processReviewerTranscript`. The prose surfaces the verbatim blocked line from `chatLog` and returns to the outer loop. If `processReviewerTranscript` raises any error on the green branch (propagated from `completeStory`), surface the error verbatim and exit — the outer loop MUST NOT proceed to the next `claimNextStory` call when a `completeStory` error propagated through `processReviewerTranscript`.

The rework loop is unbounded in v1 — Story 4.12's 30-min dev budget acts as the implicit cap.

# Failure modes

- **`NoAdapterMatchedError`**: Surface the error verbatim. The workspace resolver could not identify an adapter for this repo. Run `/crew:hire` first to establish the team, then add source stories (native: create `.crew/native-stories/`; BMad: run `/bmad-create-story`).

- **`InProgressHandEditError`**: Surface verbatim as `InProgressHandEditError: <message>`. The manifest for the ref being operated on was hand-edited after it was placed in `in-progress/`. v1 does not support mid-flight edits. Wait for the story to land in `done/` or `blocked/`, or discard it via `/crew:plan`.

- **`DependenciesNotReadyError`**: Surface verbatim as `DependenciesNotReadyError: <message>`. The story's `depends_on` refs are not yet in `done/`. The pre-check filter should catch most of these; this error surfaces only on a race between the pre-check and the claim call. Continue to the next candidate.

- **`WrongClaimantError`**: Surface verbatim as `WrongClaimantError: <message>`. A `completeStory` call was made by a session that did not claim the ref. This is a dev-subagent error surfaced by the sub-session; `/crew:start` logs it and continues.

- **`PersonaFileNotFoundError`** (from `buildPersonaSpawnPrompt`): The team copy of the `generalist-dev` or `generalist-reviewer` persona is missing. Run `/crew:hire` or `/crew:skip-hiring` before `/crew:start` to create it.

- **`HandoffGrammarDriftError`** / `blocked_by: handoff-grammar`: The dev subagent terminated without the verbatim locked handoff phrase on its last non-empty output line. The in-progress manifest is stamped with `blocked_by: "handoff-grammar"` (in-place — Story 5.1 will retrofit the atomic move to `blocked/`). The chat surface prints the verbatim drift line (emitted by `processDevTranscript`). Recovery: edit the manifest to remove the `blocked_by` key, then re-run `/crew:start`. Note: v1's recovery is to manually delete the in-progress manifest and re-add the source story to `to-do/` if re-scanning is needed.

- **`ReviewerGrammarDriftError`** / `blocked_by: reviewer-grammar`: The reviewer subagent terminated without a recognised verdict sentinel on its last non-empty output line. The in-progress manifest is stamped with `blocked_by: "reviewer-grammar"` (emitted by `processReviewerTranscript`). Recovery follows the same path as handoff grammar drift.

- **`completeStory` raising `WrongClaimantError` or `InProgressHandEditError`**: On the `READY FOR MERGE` branch, `processReviewerTranscript` calls `completeStory` internally. If the in-progress manifest has been hand-edited since claim (FR14a) OR the session ULID does not match `claimed_by` (FR19), `completeStory` raises `InProgressHandEditError` or `WrongClaimantError` respectively. These errors propagate verbatim THROUGH `processReviewerTranscript` to the prose layer, which surfaces them and exits — the outer loop does NOT advance to the next `claimNextStory` call. Recovery is operator inspection of the in-progress manifest plus a fresh `/crew:start` invocation.

Note: `runDevSession` is no longer used. The SKILL.md prose now drives the inner cycle directly via `Task` tool invocations, with `processDevTranscript` and `processReviewerTranscript` handling the parsing and manifest mutations.

# Termination conditions

The skill terminates normally (no error) when:

- `claimNextStory` returns `next: "queue-drained"` (both `to-do/` empty after filtering to `depsReady: true` and `in-progress/` empty).

At that point, print exactly:

```
queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.
```

This line is verbatim. Do not paraphrase, reword, add emoji, or add punctuation beyond what is written above.
