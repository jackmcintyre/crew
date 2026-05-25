---
name: crew:smoke-setup
description: Stand up a clean smoke-harness scratch repo and chain skip-hiring → plan → scan with assertion checkpoints so smokes start from a known-good state.
allowed_tools: [createSmokeScratchRepo, getTeamSnapshot, readBacklogInventory, listClaimableTodos]
---

<!-- Behavioural contract source: _bmad-output/implementation-artifacts/4-14-smoke-harness-wrapper-skill.md § Acceptance criteria -->

# /crew:smoke-setup

# What this skill does

Chains the operator-smoke pre-roll — scratch-repo creation, default-roster hire, planner-authored backlog, and source-story scan — into a single skill with a tool-layer assertion checkpoint between every step. Per-story smokes have repeatedly burned 1-3 trials on setup drift (missing persona frontmatter, missing standards.md, planner failing on a no-commit repo); this skill removes that tax so a smoke failure surfaces at the step that broke, not at "step 0: I forgot to copy standards.md".

The skill stops before `/crew:start`. The whole point of the smoke is for the operator to observe `/crew:start`; this skill only stands up its prerequisites.

# Prerequisites

- Claude Code launched with `--plugin-dir <crew>/plugins/crew` so the plugin's MCP tools are bound to this session (see `plugins/crew/docs/README-install.md` § Dev loop). The skill does NOT attempt to install the plugin.
- A label argument identifying the smoke run (e.g. `4-6-rev2`, `4-10b-am-gate`). Used only as the human-readable component of the scratch directory name.

# Steps

The skill executes the five steps below in order. Each step's checkpoint is enforced by an MCP tool call against the scratch repo — the skill MUST call the listed tool BEFORE advancing to the next step. On checkpoint success the skill prints `[smoke-setup] step N (<name>): ok`. On checkpoint failure the skill prints `[smoke-setup] step N (<name>): FAILED — <reason>` and halts.

1. **scratch-repo** — call `createSmokeScratchRepo({ label })`. Capture `scratchRoot` from the result. Checkpoint: confirm the returned path exists and contains both `.crew/config.yaml` and `.crew/standards.md`. On success print `[smoke-setup] step 1 (scratch-repo): ok` followed by `scratch_root: <scratchRoot>` so the operator can paste it into a sibling terminal. On failure print `[smoke-setup] step 1 (scratch-repo): FAILED — <reason>` and halt.

2. **skip-hiring** — invoke `/crew:skip-hiring` against the scratch repo (the operator launches this in a sibling Claude Code session rooted at `scratch_root`, or the skill spawns it via Task if running in an LLM that can target a sub-workspace). Checkpoint: call `getTeamSnapshot({ targetRepoRoot: scratchRoot })` and assert the returned roster has ≥1 role whose frontmatter populates both `hired_at` and `catalogue_version`. (This is the exact frontmatter that bit Story 4.6 — verify it here, fail fast if drift returns.) On success print `[smoke-setup] step 2 (skip-hiring): ok`. On failure print `[smoke-setup] step 2 (skip-hiring): FAILED — <reason>` and halt.

3. **plan** — invoke `/crew:plan` against the scratch repo and exit the planner conversation with a minimal authored backlog (1 trivial story is enough). Checkpoint: call `readBacklogInventory({ targetRepoRoot: scratchRoot })` and assert ≥1 source story is now present. On success print `[smoke-setup] step 3 (plan): ok`. On failure print `[smoke-setup] step 3 (plan): FAILED — <reason>` and halt.

4. **scan** — invoke `/crew:scan` against the scratch repo. Checkpoint: call `listClaimableTodos({ targetRepoRoot: scratchRoot })` and assert ≥1 manifest is now present in `.crew/state/to-do/`. On success print `[smoke-setup] step 4 (scan): ok`. On failure print `[smoke-setup] step 4 (scan): FAILED — <reason>` and halt.

5. **start** — print `[smoke-setup] step 5 (start): ok` followed by `Ready. Run /crew:start in this scratch repo.` and return control to the operator. Do NOT auto-invoke `/crew:start` — the smoke is exactly what the operator is here to observe, and chaining it through the skill would defeat the purpose.

# Failure modes

- **Scratch-repo creation failed:** `createSmokeScratchRepo` propagates filesystem errors verbatim (e.g. `EACCES` on `parentDir`, missing standards-doc template). Surface the error and halt — the rest of the chain cannot run without a scratch root.
- **`hired_at` / `catalogue_version` missing from persona frontmatter:** step-2 checkpoint trips. This is the Story 4.6 regression signal — re-check `instantiatePersona`'s frontmatter writer before continuing.
- **Planner exits without authoring any source story:** step-3 checkpoint trips. The planner conversation was cancelled or produced no output. Re-run `/crew:plan` against the printed `scratch_root`.
- **`/crew:scan` produced zero claimable manifests:** step-4 checkpoint trips. Most often a source-story shape defect — the scanner silently skips malformed names (see memory entry `project_native_scan_silent_skip`). Inspect `.crew/state/to-do/` and re-author the source story if empty.
- **Operator forgot `--plugin-dir`:** the skill cannot detect this directly, but every MCP-tool call will fail with `tool not found`. If step 1's MCP call errors with no such tool, the operator launched Claude Code without `--plugin-dir <crew>/plugins/crew`. Re-launch and retry.

# Out of scope (deferred)

- A `crew:smoke-teardown` companion skill that nukes old scratch dirs. v1: operators `rm -rf <scratch_root>` by hand.
- Pre-populating the scratch repo with a specific story fixture (e.g. for replaying a known-bad input). Deferred to Epic 5/6 when smoke-as-regression-suite becomes a thing.
- Driving `/crew:plan` non-interactively. v1: the planner is conversational; the operator stays at the keyboard for step 3.
