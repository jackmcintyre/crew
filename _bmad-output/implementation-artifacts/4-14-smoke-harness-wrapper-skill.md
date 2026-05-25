# Story 4.14: Smoke-harness wrapper skill

story_shape: substrate

Status: ready-for-dev

## Story

As a plugin maintainer running operator-smokes for user-surface stories,
I want a single skill that chains scratch-repo setup → `/crew:skip-hiring` → `/crew:plan` → `/crew:scan` → `/crew:start` with tool-layer assertion checkpoints between steps,
So that a smoke failure surfaces at the step that broke, and per-story smoke-setup drift stops costing trials.

**Context:** mid-epic-4 retro ([epic-4-retro-2026-05-25.md](epic-4-retro-2026-05-25.md), carry-forward #1). Story 4.6 burned 7 smoke trials before clean signal — every failure a different missing piece of operator state (persona frontmatter, `hired_at`/`catalogue_version`, missing H2s, no PR URL, no remote, missing `standards.md`, locked-phrase grammar drift). Story 4.8 hit the same friction again. Memory entry `project_smoke_harness_wrapper` has flagged this as "overdue" twice. This story removes the tax for every remaining user-surface smoke in Epic 4 and beyond.

## Acceptance Criteria

> AC1 covers the new MCP tool that builds the scratch repo. AC2 covers the new skill file that chains the journey with checkpoints. AC3 is the integration test. There is no user-surface chat line — the value is removing trials, not adding surface. Story shape: substrate.

**AC1 (substrate):**
**Given** a parent directory (default: `os.tmpdir()`) and a session label,
**When** the `createSmokeScratchRepo({ parentDir?: string; label: string }): Promise<{ scratchRoot: string; cleanup: () => Promise<void> }>` tool is called,
**Then** it creates a directory under `<parentDir>/crew-smoke-<label>-<ulid>/`, runs `git init` + an initial empty commit (so the planner doesn't emit `git rev-parse failed: HEAD`), writes a minimal `.crew/config.yaml` selecting the native adapter, copies the plugin's shipped `standards.md` template to `.crew/standards.md`, and returns the path plus a cleanup closure.

**AC2 (substrate):**
**Given** the operator invokes `/crew:smoke-setup <label>` from a Claude Code session launched with `--plugin-dir <crew>/plugins/crew`,
**When** the skill runs,
**Then** it executes the following steps in order, calling the listed MCP tool as a checkpoint **before** advancing to the next step, and emitting a single line per checkpoint of the form `[smoke-setup] step N (<name>): ok` (or `[smoke-setup] step N (<name>): FAILED — <reason>` and halt):

  1. **scratch-repo** — call `createSmokeScratchRepo({ label })`. Checkpoint: the returned path exists and contains `.crew/config.yaml` + `.crew/standards.md`.
  2. **skip-hiring** — invoke `/crew:skip-hiring` against the scratch repo. Checkpoint: `getTeamSnapshot({ targetRepoRoot })` returns ≥1 role with `hired_at` and `catalogue_version` populated. (This is the exact frontmatter that bit 4.6.)
  3. **plan** — invoke `/crew:plan` and exit the planner with a minimal authored backlog (1 trivial story). Checkpoint: `readBacklogInventory({ targetRepoRoot })` returns ≥1 source story.
  4. **scan** — invoke `/crew:scan`. Checkpoint: `listClaimableTodos({ targetRepoRoot })` returns ≥1 manifest in `to-do/`.
  5. **start** — return control to the operator with a printed `Ready. Run /crew:start in this scratch repo.` line. Do NOT auto-invoke `/crew:start` — the smoke is exactly what the operator is here to observe.

**AC3 (integration):**
**Given** AC1 and AC2 are implemented,
**When** `pnpm test` runs from `plugins/crew/mcp-server`,
**Then** vitest exercises `createSmokeScratchRepo` end-to-end against a real `os.tmpdir()` scratch (initial commit succeeds, files written, cleanup closure removes the tree) AND a structural-anchor test (mirroring `start-skill-content.test.ts`) asserts the five step labels and their checkpoint MCP-tool names are present in `SKILL.md`.

## Tasks / Subtasks

- [ ] **Task 1: New MCP tool `createSmokeScratchRepo`** in `plugins/crew/mcp-server/src/tools/create-smoke-scratch-repo.ts`. Register on the server alongside the existing tools. Shape: takes `{ parentDir?, label }`, returns `{ scratchRoot, cleanup }`. Implementation uses `fs.mkdtemp`, then shells `git init && git commit --allow-empty -m "smoke init"` via the same `execa` shape used by `runDevTerminalAction`. Writes `.crew/config.yaml` (native adapter) and `.crew/standards.md` (template copied from `plugins/crew/templates/standards.md` — confirm path on inspection).

- [ ] **Task 2: Skill scaffold.** Create `plugins/crew/skills/smoke-setup/SKILL.md` following the layout of `plugins/crew/skills/scan/SKILL.md` (frontmatter: `name: crew:smoke-setup`, `description:` one-line, `allowed_tools: [Read, Bash]`). The skill body lists the five steps and their checkpoint tools (per AC2 above). Prose is parser-friendly — each step line carries the literal step name and MCP-tool name so the structural-anchor test can assert them.

- [ ] **Task 3: Structural-anchor test** in `plugins/crew/mcp-server/src/__tests__/smoke-setup-skill-content.test.ts`. Mirror the shape of `start-skill-content.test.ts` (Story 4.2 / 4.6 lineage). Assert presence of: each step label, each checkpoint MCP-tool name, the `Ready. Run /crew:start in this scratch repo.` line.

- [ ] **Task 4: Integration test for `createSmokeScratchRepo`** in `plugins/crew/mcp-server/src/tools/__tests__/create-smoke-scratch-repo.integration.test.ts`. Uses real `os.tmpdir()`, no stubs. Asserts: scratch path exists, `.crew/config.yaml` + `.crew/standards.md` written, `git log --oneline | wc -l` returns 1, cleanup removes the tree. Pattern: copy the `claim-complete-loop.integration.test.ts` setup/teardown shape.

- [ ] **Task 5: Plugin marketplace registration.** Add `crew:smoke-setup` to the skill list in the plugin's marketplace manifest (search for where `crew:scan` is listed and mirror).

- [ ] **Task 6: Update `epic-4-retro-2026-05-25.md`'s carry-forward table** — strike-through item #1 (smoke-harness wrapper) and add the PR number once shipped. Do this in the PR that closes the story.

- [ ] **Task 7: Build + suite green.** `pnpm -w build && pnpm -w test --run`. Commit `plugins/crew/mcp-server/dist/` per CLAUDE.md's build-artefacts rule.

## Implementation strategy

The whole story is "one new MCP tool + one new skill file + one structural-anchor test + one integration test". The deterministic-seam discipline matters here: every checkpoint reads state via an existing MCP tool (`getTeamSnapshot`, `readBacklogInventory`, `listClaimableTodos`) rather than parsing prose or eyeballing UI. The chain is itself a deterministic seam — if step 2 says `ok`, step 3 can assume the team is real.

Two design calls made up-front:

- **Why no auto `/crew:start`?** The smoke exists to observe `/crew:start` running. Auto-invoking it would hide the very thing the operator is here to see.
- **Why a tool + a skill, not just a skill?** The scratch-repo work involves shelling `git init` and writing files — that's MCP-tool territory by the existing convention (compare `scanSources`, `runDevTerminalAction`). Skills orchestrate; tools mutate.

## Locked files (do not modify)

- `plugins/crew/skills/start/SKILL.md` — the smoke target. Touching it during this story biases the smoke.
- `plugins/crew/skills/scan/SKILL.md`, `plan/SKILL.md`, `skip-hiring/SKILL.md` — same reason.
- Any existing MCP tool source under `plugins/crew/mcp-server/src/tools/` — additive only (the new `create-smoke-scratch-repo.ts` is the only new file in that directory).

## Dev Notes

**Why this story exists in Epic 4 (not Epic 5 / 6):** every remaining Epic 4 story (4-10b, 4-11, 4-12, 4-13) and every user-surface story through Epic 7 will run smokes. Each smoke that drifts on setup costs ~1 trial of pure setup tax before testing the thing under test. Story 4.6's 7-trial run is the worst case; the average across this epic was ~3 trials with ~2 of those being setup-drift. ROI compounds across ~30+ future smokes.

**Why this is substrate, not user-surface:** there is no `/crew:start` chat line emitted by this story. The operator runs `/crew:smoke-setup` interactively. The `[smoke-setup] step N (<name>): ok` lines are skill-emitted operator feedback, not part of the dev/review loop's chat surface per `plugins/crew/docs/user-surface-acs.md`. AC verification is automated (vitest + structural anchors), per the user-surface AC rubric's strict-membership rule.

**Template file resolution:** `plugins/crew/templates/standards.md` may not exist by that exact name. On inspection, find the shipped standards template referenced by the workspace resolver / hire skill (Story 1.3 wired this) and use that path. If absent, the dev agent should add the literal contents inline in `createSmokeScratchRepo` — `.crew/standards.md` only needs the H2 anchors the standards-doc parser expects.

**Native adapter config shape:**
```yaml
# .crew/config.yaml
plugin:
  active_adapter: native
```
Confirm against the workspace resolver's expected schema (Story 1.2 / 1.2b / 3.3b region). The native adapter is the right default for smokes because it's the minimal-friction planner path.

**Locked-phrase parser safety:** the `[smoke-setup] step N (<name>): ok` line MUST NOT collide with any existing locked phrase parsed by `runDevSession` / `runReviewerSession`. Search `plugins/crew/mcp-server/src/lib/` for current parser patterns (handoff phrase, verdict footer, gh-error-map keys) and confirm no overlap. If a collision exists, alter the smoke-setup line's grammar (e.g. prefix with `;;` or similar) before shipping.

**Testing standards:** vitest, suite green from `plugins/crew/mcp-server`. Integration test uses real `os.tmpdir()` (no stubs) — follows the precedent set by `claim-complete-loop.integration.test.ts`, `mark-withdrawn.integration.test.ts`, and `hand-edit-allowance.integration.test.ts`. Structural-anchor test mirrors `start-skill-content.test.ts`.

**Previous-story intelligence:**
- Story 4.6 retro (PR #109) is the canonical case for what setup drift costs. Read the retro notes in that PR if behaviour is unclear.
- Story 3.4 retro established `claude --plugin-dir <worktree>/plugins/crew` as the operator-facing dev-loop pattern. The smoke-setup skill assumes this — its prose tells the operator to launch Claude Code this way; it does not attempt to install the plugin.
- Story 1.3 wired the standards-doc parser. The template lives where Story 1.3 placed it.

**Cleanup discipline:** the scratch repo lives under `os.tmpdir()` and is intentionally NOT cleaned up automatically — the operator may want to inspect a failed smoke. The `cleanup` closure returned by `createSmokeScratchRepo` is exposed for the integration test and any future explicit-cleanup MCP tool; the skill does not call it.

**Out of scope for v1:**
- A `crew:smoke-teardown` companion skill that nukes old scratch dirs. Deferred — operators can `rm -rf` for now.
- Pre-populating the scratch repo with a specific story fixture (e.g. for replaying a known-bad input). Deferred to Epic 5/6 when smoke-as-regression-suite becomes a thing.
- Driving `/crew:plan` non-interactively (today the planner is conversational; smokes will still need the operator at the keyboard for step 3). Acceptable for v1 because the value is removing the *other four* steps' drift.

## Previous story intelligence

PR #109 (Story 4.6) retro is the primary source. Specifically, the rev-2 architecture addendum and the trial-by-trial log of what each setup failure looked like. Cross-reference the PR comment thread.

PR #112 (Story 4.6b), PR #116 (Story 4.7), PR #119 (Story 4.8), PR #122 (Story 4.8b) — all hit smaller versions of the same friction. Each of those PRs' retro comments names one or more pieces of operator state that the wrapper skill must establish.

## Project context reference

- Memory entries (load via auto memory): `project_smoke_harness_wrapper` (the spec for this story in shorthand), `project_operator_smokes_via_plan` (canonical journey), `feedback_default_to_deterministic_seams` (architectural bar), `project_dev_loop_plugin_dir` (`--plugin-dir` workflow).
- `_bmad-output/implementation-artifacts/epic-4-retro-2026-05-25.md` carry-forward #1.
- `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md` — parent epic; this story is added under "Retro Amendments" near the foot of the file.
- `plugins/crew/docs/user-surface-acs.md` — confirms this story is substrate (no chat-surface contribution to `/crew:start`).
- `CLAUDE.md` § Plugin build output — `dist/` must be committed.

## Story completion status

Ready for dev. One new MCP tool, one new skill file, two new tests, one marketplace-manifest line. Existing patterns (scratch-tmpdir integration tests, structural-anchor SKILL.md tests, native-adapter `.crew/config.yaml`) all in repo and grounded above.

## Dev Agent Record

_(Populated by the dev agent during implementation.)_

### Agent model used

### Debug log references

### Completion notes

### File list

### Change log
