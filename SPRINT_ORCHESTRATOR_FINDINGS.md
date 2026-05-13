# Sprint-orchestrator dry-run findings

**Date:** 2026-05-13
**Test repo:** `/Users/jackmcintyre/projects/sprint-test`
**Orchestrator source:** `/Users/jackmcintyre/projects/claude-dev-loop` @ `plan-orchestrator-polish-sprint`
**Scope completed:** smoke-test of each unique orchestrator behavior. Stopped at 3/11 stories — happy-path on 1.1, two attempts at 3.3 (first invalid honeypot, second a real rework-cap exercise). The remaining 8 stories were not implemented; `/loop` cron wrapping, `/bmad-retrospective`, `force_release_stale`, and PR #12 README quickstart were not exercised.

---

## ✅ Confirmed working

| Behaviour | Evidence |
|---|---|
| MCP server reachable, full PR #12 surface | `ping`, `getOrInitConfig`, `getSprintStatus`, `getReadyStories`, `claimStory`, `validateAcceptanceCriteria`, `commitStoryArtefacts`, `markStoryComplete`, `markStoryNeedsRework`, `markStoryFailed`, `getSprintReport`, `releaseStaleClaims` all responded |
| BMad v6 layout auto-detection | `getOrInitConfig` returned `layout: bmad-v6, needsSetup: false` without prompting |
| `getSprintReport` shape | Returns `{ counts, stories, rendered }` exactly as spec'd |
| Happy path | Story 1.1: `claim → dev → reviewer → done` in one round; metadata (`completed_at`, `summary`, `artefacts: [git:<sha>]`) populated |
| `commitStoryArtefacts` | Auto-created `feat(1.1): ...` and `feat(3.3): ...` commits |
| Rework loop + cap | Three reviewer rounds on 3.3 produced `rework_count=1` → `rework_count=2, capReached=true` → `markStoryFailed`. Sub-loop terminated on its own per skill rules |
| Lifecycle JSONL log | `.sprint-orchestrator/run.log` captured `story_start` / `story_end` with `outcome: needs_rework \| failed` |
| Auto-mode classifier escape hatch | Reviewer surfaced an apparent prompt-injection (honeypot story title) rather than silently complying |

---

## 🚩 Issues to feed back

Ordered by severity / actually-bit-me first.

### 1. `commitStoryArtefacts` couples state and source artefacts in one commit
**Severity: high — actually bit me.**

`commitStoryArtefacts` stages both the dev's code changes AND the resulting `sprint-status.yaml` state mutations in a single git commit (e.g. commits `9382e5a` for story 1.1 and `55b0bf8` for story 3.3).

I `git revert`'d the bogus 3.3 artefact commit to drop the file the dev shouldn't have created. The revert also rolled back orchestrator state: `1.1.status: done → in_progress`, `3.3.rework_count: 1 → 0`, claim metadata, `last_review_feedback`, etc. The state machine became inconsistent with reality and I had to hand-patch the YAML to restore it (commit `1bbf346`).

**Suggested fix:** either (a) `commitStoryArtefacts` makes two commits (one for `sprint-status.yaml`, one for code artefacts), or (b) state lives outside git in `.sprint-orchestrator/state.json`. Both untangle the dependency.

### 2. BMad ↔ orchestrator schema mismatch
**Severity: high — blocks anyone using the documented planning pipeline.**

`bmad-sprint-planning` emits this shape:

```yaml
development_status:
  epic-1: backlog
  1-1-user-authentication: ready-for-dev
  1-2-account-management: backlog
```

The orchestrator's `SprintStatus` zod schema requires:

```yaml
sprint_id: string
stories:
  - id: string
    title: string
    status: backlog | ready | in_progress | done | blocked
    depends_on: string[]
    acceptance_criteria:
      checks: [{ type: shell|file_exists|regex, ... }]
    orchestrator: {}
```

These are not the same shape, and the BMad output is missing both the `acceptance_criteria.checks` payload and the dependency graph that the orchestrator's `getReadyStories` needs.

Even the status enums differ: BMad uses `ready-for-dev`, orchestrator uses `ready`. The orchestrator also expects machine-checkable acceptance criteria, which BMad's "Given/When/Then" prose does not produce.

**Suggested fix (pick one):**
- BMad's `sprint-planning` skill emits orchestrator-shaped YAML directly
- The orchestrator ships a BMad importer (`importBmadEpics` MCP tool) that walks `epics.md` + `sprint-status.yaml`, extracts ACs, and writes the orchestrator shape
- Document the conversion explicitly in the README and stop claiming "auto-detected BMad v6 layout" (currently it auto-detects the *config layout* but cannot actually read BMad's status format)

### 3. No automatic `backlog → ready` promotion on dep satisfaction
**Severity: medium.**

`getReadyStories` returns only stories whose status is already `ready` AND all `depends_on` are `done`. It does not promote a story from `backlog` to `ready` when its deps complete.

After 1.1 finished, 1.2 had a satisfied dep but stayed in `backlog` indefinitely. The `process-backlog` skill would have run out of ready stories after 3.3 was exhausted and stopped — never claiming 1.2.

**Suggested fix:** in `getReadyStories` (or in `markStoryComplete`), promote any `backlog` story whose deps are now all `done` to `ready`. Alternatively, document that authors must mark *all* stories as `ready` upfront and rely solely on `depends_on` to gate execution.

### 4. User-global `CLAUDE.md` directives leak into orchestrator subagents
**Severity: medium.**

My `~/.claude/CLAUDE.md` contains: *"Never tell me that something is done. Ask me to verify, then I'll tell you if it's done."*

The reviewer subagent picked this up and refused to call `markStoryComplete` on story 3.3 (first attempt — when the literal-grep AC was satisfied by the dev creating the honeypot file). It surfaced this verbatim in its return: *"the classifier... flagging the AC token name as a prompt-injection honeypot and noting your CLAUDE.md rule against declaring things done."*

The orchestrator's correctness depends on the reviewer being willing to mutate state. A user-level prose rule like "don't say done" silently breaks it.

**Suggested fix:** the reviewer agent's system prompt should explicitly note that calling `markStoryComplete` is a *state-machine action*, not a human-facing claim of completion, and override any user-level "do not say done" preferences for that specific tool call. Or: scope user CLAUDE.md out of subagent context entirely.

### 5. `markStoryFailed` lands as status `blocked`, but lifecycle log says `outcome: failed`
**Severity: low — naming inconsistency.**

The status enum is `[backlog, ready, in_progress, done, blocked]` — no `failed`. `markStoryFailed` sets the status to `blocked` with a `lastFailure` reason. But:
- Run.log writes `outcome: "failed"`
- PR #12 spec ("Things I want to verify") says *outcome: complete | failed | needs_rework*
- Skill docs say "the reviewer will escalate to `markStoryFailed`"
- `getSprintReport` rendered output groups it under `[blocked]`

Pick one vocabulary. Currently the consumer has to know the mapping.

### 6. Subagent string returns can drift from state
**Severity: low — observability.**

Reviewer subagents return one-line strings like `done: 1.1` or `rework: 3.3 — <reason>`. There is no machine-checkable assertion that the state mutation actually landed. The orchestrator skill trusts the return string verbatim.

During debugging I momentarily thought the reviewer had lied because the YAML showed 1.1 still `in_progress` — it had actually written `done`, but I'd just reverted the commit. A subagent return that included the tool call result (`done: 1.1 (markStoryComplete returned { status: "done", completed_at: "..." })`) would have made the divergence between "agent says" and "state is" obvious.

### 7. Out-of-band state mutations bypass run.log
**Severity: low.**

When I hand-patched `sprint-status.yaml` to restore 1.1's state after the bad revert, no `story_end` event was emitted to `.sprint-orchestrator/run.log`. Run.log only logs events that originate from MCP tool calls.

**Suggested fix:** either (a) the orchestrator watches `sprint-status.yaml` for direct edits and emits a `state_edit` event, or (b) document clearly that hand-edits break observability.

### 8. AC design fragility — literal grep is not "unsatisfiable"
**Severity: very low — author error, not orchestrator bug.**

My first attempt at a rework-cap test used `grep -q INTENTIONALLY_UNREACHABLE_TOKEN_DO_NOT_ADD apps/server/src/index.ts`. The token *name* signals intent, but the AC is a literal grep, so a dev agent that ignores the naming convention can satisfy it trivially. Use `shell: "false"` for truly impossible ACs (which the rework-cap test then exercised correctly).

This isn't an orchestrator issue, but it suggests acceptance criteria should ideally be more than a single grep — defence-in-depth, or AC validation that rejects trivially-satisfiable patterns.

---

## What was NOT tested

- Implementation of stories 1.2 through 3.2 (8 stories — real Hono/SQLite/Vite/React/Playwright work)
- `/loop 5m /sprint-orchestrator:process-backlog` cron wrapping
- `/bmad-retrospective`
- `force_release_stale` config option
- PR #12 README quickstart accuracy
- Multi-agent concurrency / claim conflicts (only one orchestrator running)
- Crash recovery via `releaseStaleClaims`
- Story file refresh — what happens if `epics.md` changes mid-sprint

---

## Test repo state

Branch: `main`
HEAD: `1bbf346`

```
1bbf346 fix(sprint): restore state after bad revert; redesign 3.3 as truly impossible
761eddb Revert "feat(3.3): DELIBERATELY UNSATISFIABLE — exercises the rework cap"
55b0bf8 feat(3.3): DELIBERATELY UNSATISFIABLE — exercises the rework cap
9382e5a feat(1.1): pnpm workspace + root verify script
e93e8f4 fix(sprint): rewrite sprint-status.yaml to orchestrator schema
7193ba8 plan: complete BMad planning artifacts for Tinytodo  ← revert here for clean re-run
c606263 scaffold: BMad-ready checkpoint for sprint-orchestrator test
c701a82 init
```

Current sprint state: 1.1 done, 1.2 ready, 1.3–3.2 backlog, 3.3 blocked.

Revert to `7193ba8` for a fresh orchestrator run once the schema mismatch (#2) and state-coupling bug (#1) are addressed upstream.

---

## Recommended fix priority

1. **#1 (state/artefact coupling)** — actually bit me, easy to land
2. **#2 (BMad schema bridge)** — blocks the documented happy path
3. **#3 (auto-promotion)** — silently truncates real runs
4. **#4 (CLAUDE.md leak)** — silently breaks state mutations
5. **#5 (failed vs blocked naming)** — cosmetic but confusing
6. **#7, #6 (observability)** — quality-of-life
7. **#8 (AC fragility guidance)** — docs only
