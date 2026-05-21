---
name: crew:start
description: "Claim the next ready story from the backlog, spawn a clean-context generalist-dev subagent, and drain the queue until empty."
allowed_tools: [Task, buildPersonaSpawnPrompt, claimStory, getStatus, mintSessionUlid, listClaimableTodos]
---

<!-- Behavioural contract source: _bmad-output/implementation-artifacts/4-2-start-skill-and-per-story-dev-subagent-spawn.md § Behavioural contract -->

# /crew:start

# What this skill does

Runs the dev-session loop: it picks each claimable story from `.crew/state/to-do/` in alphabetical ref order, calls `claimStory` to atomically move the manifest to `in-progress/`, then spawn the generalist-dev subagent via Claude Code's Task tool with a clean context and the assembled persona system prompt. When the candidate set is empty and `in-progress/` is also empty, the skill prints the queue-drained line and exits.

One `/crew:start` invocation is one session. The session ULID is minted once at the start and re-used for every `claimStory` call in the session. Each spawned dev subagent is given a fresh context isolated from the calling session and from sibling spawns.

# Prerequisites

- A target repo with `.crew/config.yaml` resolvable (or auto-detectable by the workspace resolver).
- At least one story scanned into `.crew/state/to-do/` (run `/crew:scan` first if the directory is empty).
- A hired `generalist-dev` persona at `<targetRepoRoot>/team/generalist-dev/PERSONA.md` (run `/crew:hire` or `/crew:skip-hiring` first — the persona file is required for spawn-prompt assembly).

# Steps

1. **Identify `targetRepoRoot`.** Use the current Claude Code workspace root as `targetRepoRoot`.

2. **Resolve the active adapter.** Call `getStatus({ targetRepoRoot })` as the FIRST MCP call in every `/crew:start` invocation. This (i) triggers the workspace resolver if `.crew/config.yaml` is absent, (ii) confirms an active adapter is resolvable, and (iii) lets `NoAdapterMatchedError` surface BEFORE any claim attempt. On any typed error (`NoAdapterMatchedError`, `UnknownAdapterError`, `AmbiguousAdapterError`), surface the error verbatim and stop.

3. **Mint the session ULID.** Call `mintSessionUlid()` exactly once. Store the returned `sessionUlid`. This ULID identifies "this dev session" — it is re-used for every `claimStory` call in this invocation. Each new `/crew:start` invocation gets a new ULID.

4. **Print the session header.** Print exactly:
   ```
   dev session — workspace: <targetRepoRoot> — session: <sessionUlid>
   ```

5. **Loop — drain the queue.** Repeat until the queue is empty:

   a. **Pre-scan the candidate set.** Call `listClaimableTodos({ targetRepoRoot })` to get `{ todos, inProgressCount }`. `todos` is already filtered by `isClaimable` (withdrawn=false, status=to-do) and sorted alphabetically by ref. Only entries with `depsReady: true` are eligible in this loop pass — skip entries where `depsReady: false` silently (their dependencies have not landed yet).

   b. **Queue-drained check.** If `todos` (after filtering to `depsReady: true`) is empty AND `inProgressCount === 0`, print the queue-drained line verbatim and exit:
      ```
      queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.
      ```
      Do NOT call `buildPersonaSpawnPrompt`, do NOT call `claimStory`, do NOT spawn a Task before printing this line. Exit cleanly.

   c. **For each candidate ref (in the alphabetical order returned by `listClaimableTodos`):**

      i. Print: `claiming <ref> — <title>` (use `<title-unavailable>` if the title field is absent).

      ii. Call `claimStory({ targetRepoRoot, ref, sessionUlid, role: "orchestrator" })`. On any typed error other than `DependenciesNotReadyError`, surface it verbatim as `<ErrorName>: <message>` and continue to the next candidate. On `DependenciesNotReadyError` (race: a dep landed between pre-check and claim), surface verbatim and continue.

      iii. On claim success: call `buildPersonaSpawnPrompt({ targetRepoRoot, role: "generalist-dev" })` to obtain the assembled system prompt. The tool reads the persona file exactly once per call.

      iv. Print: `spawning generalist-dev subagent (clean context)`.

      v. spawn the generalist-dev subagent via Claude Code's Task tool. Pass the assembled system prompt as the `prompt` field and `"general-purpose"` as the `subagent_type` field. Include an `<initial-context>` block in the task description containing:
         - `ref`: the story ref just claimed.
         - `title`: the story title.
         - `sessionUlid`: the session ULID.
         - `targetRepoRoot`: the resolved absolute path.
         - `manifestPath`: the relative path to the in-progress manifest (`.crew/state/in-progress/<ref>.yaml`).

      vi. When the Task spawn returns, continue the loop.

   d. After iterating all candidates, go back to step 5a for another pass (in case completed spawns have freed up previously-blocked dependencies).

6. **Exit.** The loop exits only when the queue-drained condition is met. The skill terminates normally — no error thrown on queue-drained.

# Failure modes

- **`NoAdapterMatchedError`**: Surface the error verbatim. The workspace resolver could not identify an adapter for this repo. Run `/crew:hire` first to establish the team, then add source stories (native: create `.crew/native-stories/`; BMad: run `/bmad-create-story`).

- **`InProgressHandEditError`**: Surface verbatim as `InProgressHandEditError: <message>`. The manifest for the ref being operated on was hand-edited after it was placed in `in-progress/`. v1 does not support mid-flight edits. Wait for the story to land in `done/` or `blocked/`, or discard it via `/crew:plan`.

- **`DependenciesNotReadyError`**: Surface verbatim as `DependenciesNotReadyError: <message>`. The story's `depends_on` refs are not yet in `done/`. The pre-check filter should catch most of these; this error surfaces only on a race between the pre-check and the claim call. Continue to the next candidate.

- **`WrongClaimantError`**: Surface verbatim as `WrongClaimantError: <message>`. A `completeStory` call was made by a session that did not claim the ref. This is a dev-subagent error surfaced by the sub-session; `/crew:start` logs it and continues.

- **`PersonaFileNotFoundError`** (from `buildPersonaSpawnPrompt`): The team copy of the `generalist-dev` persona is missing. Run `/crew:hire` or `/crew:skip-hiring` before `/crew:start` to create it.

# Termination conditions

The skill terminates normally (no error) when:

- `listClaimableTodos` returns `todos` empty (after filtering to `depsReady: true`) AND `inProgressCount === 0`.

At that point, print exactly:

```
queue drained — to-do/ and in-progress/ are both empty. Stop here, or run /crew:plan to add work.
```

This line is verbatim. Do not paraphrase, reword, add emoji, or add punctuation beyond what is written above.
