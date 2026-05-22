---
name: crew:start
description: "Claim the next ready story from the backlog, spawn a clean-context generalist-dev subagent, and drain the queue until empty."
allowed_tools: [getStatus, mintSessionUlid, runDevSession]
---

<!-- Behavioural contract source: _bmad-output/implementation-artifacts/4-2-start-skill-and-per-story-dev-subagent-spawn.md § Behavioural contract -->
<!-- Inner-cycle behavioural contract: _bmad-output/implementation-artifacts/4-3-dev-reviewer-handoff-reviewer-spawn-and-rework-signal.md § Behavioural contract -->

# /crew:start

# What this skill does

Runs the dev-session loop: it picks each claimable story from `.crew/state/to-do/` in alphabetical ref order, calls `claimStory` to atomically move the manifest to `in-progress/`, then spawn the generalist-dev subagent via Claude Code's Task tool with a clean context and the assembled persona system prompt. When the dev subagent finishes, the inner cycle parses the handoff phrase, spawn the generalist-reviewer subagent via Claude Code's Task tool in a clean context, and handles the verdict. When the candidate set is empty and `in-progress/` is also empty, the skill prints the queue-drained line and exits.

One `/crew:start` invocation is one session. The session ULID is minted once at the start and re-used for every `claimStory` call in the session. Each spawned subagent is given a fresh context isolated from the calling session and from sibling spawns.

# Prerequisites

- A target repo with `.crew/config.yaml` resolvable (or auto-detectable by the workspace resolver).
- At least one story scanned into `.crew/state/to-do/` (run `/crew:scan` first if the directory is empty).
- Hired personas at `<targetRepoRoot>/team/generalist-dev/PERSONA.md` and `<targetRepoRoot>/team/generalist-reviewer/PERSONA.md` (run `/crew:hire` or `/crew:skip-hiring` first — the persona files are required for spawn-prompt assembly).

# Steps

1. **Identify `targetRepoRoot`.** Use the current Claude Code workspace root as `targetRepoRoot`.

2. **Resolve the active adapter.** Call `getStatus({ targetRepoRoot })` as the FIRST MCP call in every `/crew:start` invocation. This (i) triggers the workspace resolver if `.crew/config.yaml` is absent, (ii) confirms an active adapter is resolvable, and (iii) lets `NoAdapterMatchedError` surface BEFORE any claim attempt. On any typed error (`NoAdapterMatchedError`, `UnknownAdapterError`, `AmbiguousAdapterError`), surface the error verbatim and stop.

3. **Mint the session ULID.** Call `mintSessionUlid()` exactly once. Store the returned `sessionUlid`. This ULID identifies "this dev session" — it is re-used for every `claimStory` call in this invocation. Each new `/crew:start` invocation gets a new ULID.

4. **Run the session loop.** Call `runDevSession({ targetRepoRoot, sessionUlid })`. The tool internally wires the full outer claim-loop plus the inner dev → reviewer → rework cycle. Surface any thrown typed error verbatim. The tool's return value carries a `chatLog: string[]` — print each entry to the operator in order.

5. **Exit.** The loop exits only when the queue-drained condition is met. The skill terminates normally — no error thrown on queue-drained.

# Inner cycle: dev → reviewer → rework

After a story is claimed and the dev subagent is spawned, the inner cycle manages the handoff → review → verdict loop:

1. The dev subagent implements the story and terminates with the verbatim locked handoff phrase.
2. The `/crew:start` session parses the dev subagent's final-output transcript for the handoff phrase.
3. On a valid handoff parse, the session prints `handoff received — story <story-id> — spawning generalist-reviewer subagent (clean context)` and calls `buildPersonaSpawnPrompt({ role: "generalist-reviewer" })` once, then uses it to spawn the generalist-reviewer subagent via Claude Code's Task tool in a clean context isolated from both the calling session and the dev subagent's context.
4. The reviewer subagent inspects the story and terminates with one of three verdict sentinels.
5. The session parses the reviewer's final-output transcript:
   - `**Verdict: READY FOR MERGE**` → the session returns control to the outer claim-loop.
   - `**Verdict: NEEDS CHANGES**` → the session increments `rework_count` on the in-progress manifest, re-spawns the dev subagent with `rework_iteration: <n>` in its initial context, and re-enters the inner cycle.
   - `**Verdict: BLOCKED**` → the session prints the BLOCKED passthrough line and returns control to the outer claim-loop.

The rework loop is unbounded in v1 — Story 4.12's 30-min dev budget acts as the implicit cap.

# Failure modes

- **`NoAdapterMatchedError`**: Surface the error verbatim. The workspace resolver could not identify an adapter for this repo. Run `/crew:hire` first to establish the team, then add source stories (native: create `.crew/native-stories/`; BMad: run `/bmad-create-story`).

- **`InProgressHandEditError`**: Surface verbatim as `InProgressHandEditError: <message>`. The manifest for the ref being operated on was hand-edited after it was placed in `in-progress/`. v1 does not support mid-flight edits. Wait for the story to land in `done/` or `blocked/`, or discard it via `/crew:plan`.

- **`DependenciesNotReadyError`**: Surface verbatim as `DependenciesNotReadyError: <message>`. The story's `depends_on` refs are not yet in `done/`. The pre-check filter should catch most of these; this error surfaces only on a race between the pre-check and the claim call. Continue to the next candidate.

- **`WrongClaimantError`**: Surface verbatim as `WrongClaimantError: <message>`. A `completeStory` call was made by a session that did not claim the ref. This is a dev-subagent error surfaced by the sub-session; `/crew:start` logs it and continues.

- **`PersonaFileNotFoundError`** (from `buildPersonaSpawnPrompt`): The team copy of the `generalist-dev` or `generalist-reviewer` persona is missing. Run `/crew:hire` or `/crew:skip-hiring` before `/crew:start` to create it.

- **`HandoffGrammarDriftError`** / `blocked_by: handoff-grammar`: The dev subagent terminated without the verbatim locked handoff phrase on its last non-empty output line. The in-progress manifest is stamped with `blocked_by: "handoff-grammar"` (in-place — Story 5.1 will retrofit the atomic move to `blocked/`). The chat surface prints the verbatim AC3 drift line. Recovery: edit the manifest to remove the `blocked_by` key, then re-run `/crew:start`. Note: v1's recovery is to manually delete the in-progress manifest and re-add the source story to `to-do/` if re-scanning is needed.

- **Reviewer grammar drift** / `blocked_by: reviewer-grammar`: The reviewer subagent terminated without a recognised verdict sentinel on its last non-empty output line. The in-progress manifest is stamped with `blocked_by: "reviewer-grammar"`. Recovery follows the same path as handoff grammar drift.

# Termination conditions

The skill terminates normally (no error) when:

- `listClaimableTodos` returns `todos` empty (after filtering to `depsReady: true`) AND `inProgressCount === 0`.

At that point, print exactly:

```
queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.
```

This line is verbatim. Do not paraphrase, reword, add emoji, or add punctuation beyond what is written above.
