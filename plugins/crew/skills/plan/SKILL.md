---
name: crew:plan
description: "Open a planning conversation. On native repos, spawn the planner subagent to author stories; on BMad repos, point you at BMad's authoring skills."
allowed_tools: [Read, Task]
---

# /crew:plan

# What this skill does

Opens a planning conversation. For `adapter: native` repos, this skill spawns the planner subagent via Claude Code's `Task` tool against the catalogue prompt at `plugins/crew/catalogue/planner.md`; the subagent drives the conversation and writes ULID-named story files under `<target-repo>/.crew/native-stories/`. For `adapter: bmad` repos, this skill points you at BMad's authoring skills (`/bmad-create-story`, `/bmad-edit-prd`) and offers a follow-up `/crew:scan` pass to materialise newly authored stories into execution manifests.

# Prerequisites

A target repo. `.crew/config.yaml` SHOULD be present (auto-detected on first invocation by the workspace resolver — see `docs/README-install.md` checkpoint 5). If absent, the skill calls `getStatus` to trigger the resolver and surfaces any adapter-resolution error verbatim. At least one planning tool must be detectable (BMad stories root or a `.crew/native-stories/` directory) for the resolver to succeed without a config file.

# Steps

1. **Identify the target repo root.** Use the current Claude Code workspace root as `targetRepoRoot`.

2. **Resolve the active adapter.** Call `getStatus({ targetRepoRoot })` to resolve the active adapter. Capture the `adapter` field from the response. If the call fails with a typed error (`NoAdapterMatchedError`, `UnknownAdapterError`, etc.), surface the error verbatim and stop — the failure modes section covers each case.

3. **Branch on the resolved adapter name.**

4. **`adapter: native` branch:** spawn the planner subagent via Claude Code's `Task` tool against the catalogue prompt at `plugins/crew/catalogue/planner.md`. Assemble the `Task` system prompt as follows:
   - Read `readCatalogue({ role: "planner" })` and use its `Prompt` section verbatim as the system prompt.
   - Append an `<initial-context>` block containing:
     - `targetRepoRoot`: the resolved absolute path.
     - `existing_native_stories`: a JSON array of refs already under `<targetRepoRoot>/.crew/native-stories/` (list `.md` files whose names match the ULID pattern; derive refs as `native:<basename-without-extension>`).
     - `existing_manifests`: a JSON array of refs already under `<targetRepoRoot>/.crew/state/to-do/` (list `.yaml` files; derive refs as the basename without extension).
   - The planner subagent runs the four-step planning conversation and calls `writeNativeStory` for each approved story. The skill is a thin orchestrator — do not duplicate the subagent's conversational logic.
   - **Exit condition (native branch):** the planner subagent emits the catalogue's terminal locked phrase: `Handoff to generalist-dev — story <story-id> ready to claim`. When that phrase appears, the skill exits and offers the operator a follow-up `/crew:scan` to materialise the new stories.

5. **`adapter: bmad` branch:** print the following fixed pointer block verbatim, then offer the `/crew:scan` follow-up:

   ```
   BMad adapter detected. The crew plugin does not author BMad stories directly.
   Use BMad's own authoring skills instead:

   - /bmad-create-story  — author the next story in your backlog
   - /bmad-edit-prd      — edit the PRD before story authoring

   Once you have authored your stories, run /crew:scan to materialise them
   into per-story execution manifests under .crew/state/to-do/.
   ```

   Do NOT spawn the planner subagent on this branch.

   **Exit condition (BMad branch):** the operator types `done` or accepts the `/crew:scan` offer. The skill exits after the pointer block if the operator types `done`; it invokes `scanSources` if the operator accepts the scan offer.

6. **Exit.** Both branches end with confirmation of what was written (native) or a pointer to the next step (BMad).

# Failure modes

- **`NoAdapterMatchedError`** (fresh repo without source stories): surface the error message verbatim. Suggest `/crew:hire` first to initialise the team, then add source stories (native: create the `.crew/native-stories/` directory; BMad: run `/bmad-create-story`).
- **`UnknownAdapterError`** (`.crew/config.yaml` names an unregistered adapter): surface the error message verbatim. The operator must edit the `adapter:` key in `.crew/config.yaml`.
- **`WrongAdapterError`** from `writeNativeStory` (programming bug — the routing in Step 3 should prevent this): surface the error for filing. This indicates a logic error in the skill or a race condition between adapter resolution and the write call.
- **`AmbiguousAdapterError`** (two adapters' `detect()` both returned true): surface verbatim. The operator must author `.crew/config.yaml` manually to pick one.
