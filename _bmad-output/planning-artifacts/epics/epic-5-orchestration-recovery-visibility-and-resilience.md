# Epic 5: Orchestration & Recovery — Visibility and Resilience

A user leaves the dev loop running and trusts nothing fails silently. Stuck / stale / blocked / source-drift / routing-failure surface as one-line lines; sessions recover from death.

## Story 5.1: `block-story` MCP tool and `blocked_by` taxonomy

As a plugin maintainer,
I want a `block-story` MCP tool that atomically moves a manifest to `blocked/` with a typed `blocked_by` reason,
So that downstream surfaces (orchestration, retros) can route by reason.

**Acceptance Criteria:**

**Given** a story in `in-progress/`,
**When** `block-story(ref, blocked_by)` is called,
**Then** the manifest is atomically moved to `blocked/` with `blocked_by` set to one of `source-drift | planning-discipline | routing-failure | gh-defer | gh-retry | gh-needs-human | dep-not-built | reviewer-grammar-error | user`. _(FR20)_

**Given** a story blocked,
**When** the dev session picks the next available story,
**Then** it claims from `to-do/` without waiting for the blocker to resolve. _(FR21)_

**AC3 (integration):** vitest covers all `blocked_by` reasons and asserts dev keeps picking.

## Story 5.2: Heartbeat-based session liveness

As a plugin maintainer,
I want each session to write a heartbeat file at a configurable interval and stale-claim detection to use `2× interval` as its threshold,
So that orchestration can distinguish a session that died from a session that's working.

**Acceptance Criteria:**

**Given** any session (planning, dev, orchestration),
**When** it starts,
**Then** it writes `<target-repo>/.crew/sessions/<session-id>.json` and refreshes it every N seconds (default 30, configurable).

**Given** a session writing heartbeats, **When** the process exits cleanly, **Then** the heartbeat file is removed; on crash it remains stale.

**Given** a `claimed_by` referencing a session whose heartbeat is older than `2× interval` (or missing), **When** the stale-claim helper inspects, **Then** the claim is reported as stale. _(FR51)_

**AC4 (integration):** vitest covers heartbeat write/refresh/clean-exit/stale-detection across simulated session lifecycles.

## Story 5.3: `/watch` skill and orchestration polling loop

As a plugin operator,
I want `/<plugin>:watch` to run an orchestration session that polls `in-progress/` and `blocked/` on a configurable interval,
So that I see what needs my attention without breaking the dev loop.

**Acceptance Criteria:**

**Given** a target repo,
**When** I run `/<plugin>:watch`,
**Then** the orchestration session boots and polls `in-progress/` and `blocked/` every N seconds (default 120, configurable). _(FR16, FR49)_

**Given** the orchestration loop, **When** a polling pass runs, **Then** it completes within 30 seconds under normal load (NFR4 target). _(NFR4)_

**Given** the orchestration session, **When** it inspects the dev loop's state, **Then** it can only read manifests + heartbeats + telemetry; it cannot mutate dev-loop state directly (except moving a user-resolved blocker back to `to-do/`). _(FR54)_

**AC4 (integration):** vitest runs orchestration against a fixture with 5 stories in mixed states and asserts the loop reads but never writes to `in-progress/`.

## Story 5.4: Stuck-story and stale-claim detection

As a plugin operator,
I want orchestration to detect stories whose dev subagent has stalled and stories whose claims are orphaned,
So that I notice work that needs unblocking without polling files myself.

**Acceptance Criteria:**

**Given** a story in `in-progress/` whose `agent.invoke` (for the current claim) shows wall-clock beyond the per-story dev budget,
**When** orchestration polls,
**Then** the story is surfaced as `[stuck] <ref> — dev subagent exceeded budget (<elapsed> min)`. _(FR50, NFR3)_

**Given** a story whose `claimed_by` references a stale session (per Story 5.2),
**When** orchestration polls,
**Then** the story is surfaced as `[stale-claim] <ref> — session <session-id> not alive`. _(FR51)_

**AC3 (integration):** vitest seeds fixtures for each condition and asserts the surface lines.

## Story 5.4b: Paused-for-human surface

As a plugin operator,
I want orchestration to surface PRs awaiting human action after a configurable threshold,
So that paused PRs don't sit invisibly in `in-progress/` while I assume the loop is still running.

**Acceptance Criteria:**

**Given** a story in `in-progress/` whose PR carries the `needs-human` label,
**When** orchestration polls and the PR has had no state change (no new comment, no label change, no review) for ≥ `plugin.paused_for_human_threshold_hours` (default 4, configurable),
**Then** the story is surfaced as `[paused-for-human] <ref> — awaiting your action since <ts>`.

**Given** a paused PR the user has just commented on or merged,
**When** orchestration polls,
**Then** the surface line disappears (PR state change is the silence-breaker).

**Given** the surface taxonomy,
**When** I look at Story 5.5's stable prefix tags,
**Then** `[paused-for-human]` is included alongside `[blocked] / [stuck] / [stale-claim] / [source-drift] / [routing-failure]`.

**AC4 (integration):** vitest seeds a `needs-human`-labelled PR with a timestamp beyond threshold and asserts the surface line appears; advances PR state and asserts the line disappears on next poll.

## Story 5.5: One-line terminal surface and user-resolved blocker move-back

As a plugin operator,
I want orchestration to print one line per surfaced item and to move a story back to `to-do/` once I've cleared the blocker,
So that I can resolve a backlog of blockers in a single sitting.

**Acceptance Criteria:**

**Given** blockers, stuck stories, stale claims, source-drift cases, and routing-failures,
**When** orchestration produces its surface,
**Then** each item is rendered as exactly one terminal line with a stable prefix tag (`[blocked]`, `[stuck]`, `[stale-claim]`, `[source-drift]`, `[routing-failure]`). _(FR52)_

**Given** a user-edited manifest in `blocked/` where `blocked_by` has been cleared, **When** orchestration polls, **Then** the manifest is atomically moved back to `to-do/`. _(FR53)_

**AC3 (integration):** vitest seeds three blocked stories with different `blocked_by` values, clears two, runs one orchestration pass, and asserts move-back behaviour.

## Story 5.6: Fault-injection vitest harness and session-death recovery

As a plugin maintainer,
I want fault-injection tests that kill sessions at three checkpoints and assert clean re-launch with no state corruption,
So that NFR7's measurement contract is enforced in CI.

**Acceptance Criteria:**

**Given** the vitest fault-injection harness, **When** it kills a session mid-claim (after manifest move, before claim record), **Then** re-launching the dev skill detects the orphaned claim, recovers, and produces no duplicate PR or duplicate verdict. _(NFR7 checkpoint 1)_

**Given** the harness, **When** it kills a session mid-dev (after dev subagent spawn, before handoff), **Then** re-launch resumes from filesystem state with no story observed in two state directories simultaneously. _(NFR7 checkpoint 2, NFR9)_

**Given** the harness, **When** it kills a session post-handoff-pre-review, **Then** re-launch resumes the reviewer step without re-running the dev subagent. _(NFR7 checkpoint 3)_

**Given** any fault injection on dev or reviewer, **When** the failure occurs, **Then** the story's state directory is unchanged from the pre-fault snapshot OR the story is in exactly one of `to-do/`, `in-progress/`, `blocked/`, `done/` — never observed as done-then-failed or failed-then-done. _(NFR9)_

**AC5 (integration):** the harness above runs in CI and gates merges.

## Story 5.7: Back-to-back idempotency integration test

As a plugin maintainer,
I want every `/<plugin>:*` skill exercised twice back-to-back from the same workspace state,
So that NFR10's idempotency measurement contract is enforced in CI.

**Acceptance Criteria:**

**Given** any skill in the plugin's `skills/` directory,
**When** the integration test invokes the skill twice back-to-back from the same fixture state,
**Then** (a) no new story manifests are created on the second run, (b) no new PRs or duplicate comments are posted, (c) no persona file gains a duplicate Knowledge entry, (d) the second run's terminal output explicitly states the no-op or resume condition. _(NFR10)_

**AC2 (integration):** the test above runs in CI for every skill and gates merges.

## Story 5.8: No-silent-failures CI pairing assertion

As a plugin maintainer,
I want CI to fail when any JSONL invocation entry lacks a paired artifact at its declared sink,
So that NFR6's measurement contract is enforced and silent failures are structurally prevented.

**Acceptance Criteria:**

**Given** the JSONL telemetry log and the declared sink for each event type (PR comment, story frontmatter field, orchestration surface line, or `failure-log/` entry),
**When** the pairing assertion runs in CI,
**Then** every recorded invocation has a paired artifact OR a recorded failure event explaining why no artifact was produced. _(NFR6)_

**Given** an agent invocation that produces no artifact and no failure event,
**When** the assertion runs,
**Then** CI fails with the offending event id and the missing sink.

**Given** the catch-all failure path,
**When** an agent crashes without producing a verdict/blocker/surface,
**Then** a `failure-log/<ts>-<ref>.md` entry is written with stack trace + diagnostic context.

**AC4 (integration):** vitest covers the three branches (artifact present / artifact absent → CI fails / failure-log catches uncaught crash).

## Story 5.9: Telemetry-as-files and session-death recovery guide

As a plugin operator,
I want all telemetry readable as local files and a one-page guide for when a session dies,
So that I can debug and recover without consulting a remote service or running diagnostics.

**Acceptance Criteria:**

**Given** the telemetry directory, **When** I open any file with a text editor, **Then** I can read the events as plain JSONL lines without needing the plugin running. _(FR70)_

**Given** the README, **When** I navigate to the "what to do if a session dies" page, **Then** it tells me (a) check `<target-repo>/.crew/sessions/` for stale heartbeats, (b) re-run the launching skill, (c) inspect the latest `failure-log/` entry if anything's amiss; the page fits on one screen. _(FR75)_

## Story 5.10: Persist dev transcript to disk before any MCP call

> Added 2026-05-25 as post-mortem follow-up from the dogfood rollback.
> Source: `_bmad-output/postmortems/2026-05-25-dogfood-rollback.md` § L1 (defect #3).

As a plugin maintainer,
I want the dev subagent's final message captured to a durable on-disk artefact the instant the subagent returns — before `processDevTranscript` or any other MCP call runs,
So that an MCP reap mid-cycle does not lose the transcript that carries the handoff phrase and PR URL.

**Acceptance Criteria:**

**Given** a `/crew:start` outer loop with a dev subagent that has just returned,
**When** the parent receives the subagent's final message,
**Then** the raw transcript is written to `<target-repo>/.crew/state/transcripts/<session-ulid>.txt` (or equivalent durable path) **before** any MCP tool call is attempted.

**Given** a transcript on disk, **When** MCP is later restarted (e.g. via `/reload-plugins` or a fresh Claude Code session), **Then** the transcript remains readable from the same path with the same content.

**Given** a dev subagent that returned but whose `processDevTranscript` call failed (MCP disconnect, crash, or any error), **When** the operator inspects the workspace, **Then** the persisted transcript is locatable by session ULID alongside the still-in-progress manifest.

**AC4 (integration):** vitest covers (a) transcript write happens before the tool-call attempt, (b) transcript survives a simulated MCP restart, (c) write is atomic (no partial files on crash).

## Story 5.11: Orphan-recovery branch in `/crew:start`

> Added 2026-05-25 as post-mortem follow-up from the dogfood rollback.
> Source: `_bmad-output/postmortems/2026-05-25-dogfood-rollback.md` § L1 (defect #2).
> Depends on Story 5.10.

As a plugin operator,
I want `/crew:start` to detect an orphaned in-progress manifest (one whose `claimed_by` references a session that's no longer alive) and offer to replay its persisted transcript instead of silently moving on to the next claimable story,
So that a mid-cycle MCP reap does not strand a real PR in `in-progress/` with no path to verdict.

**Acceptance Criteria:**

**Given** an in-progress manifest whose `claimed_by` session ULID is not the current session's ULID (and whose heartbeat — per Story 5.2 — is stale or absent),
**When** the outer loop of `/crew:start` begins a new claim cycle,
**Then** the loop surfaces the orphan with a one-line `[orphan] <ref> — claimed_by <stale-ulid>` and asks the operator whether to reattach or skip.

**Given** the operator chooses to reattach **AND** a persisted transcript from Story 5.10 exists for the stale session ULID,
**When** the loop proceeds,
**Then** it replays `processDevTranscript` from the persisted transcript and resumes the inner cycle from the handoff step (reviewer spawn) — not from the dev step.

**Given** the operator chooses to reattach **AND** no persisted transcript exists,
**When** the loop proceeds,
**Then** it routes the manifest to `blocked/` with `blocked_by: orphan-no-transcript` rather than silently dropping the work.

**Given** the operator chooses to skip,
**When** the loop proceeds,
**Then** the orphan is left in `in-progress/` (operator's responsibility) and the loop alphabetically picks the next claimable story.

**AC5 (integration):** vitest seeds an orphaned manifest with and without a persisted transcript and asserts (a) reattach-with-transcript replays the reviewer step exactly once, (b) reattach-without-transcript moves to `blocked/` with the typed reason, (c) skip preserves orphan state.

## Story 5.12: MCP child resilient to parent stdin-close (or confirm host-side knob)

> Added 2026-05-25 as post-mortem follow-up from the dogfood rollback.
> Source: `_bmad-output/postmortems/2026-05-25-dogfood-rollback.md` § L1 (defect #1).
> Independent of 5.10 / 5.11.

As a plugin maintainer,
I want the crew MCP server child to survive Claude Code's parent stdin-close, OR — if that's structurally a host responsibility — confirmation that the host's idle-reap threshold is operator-configurable,
So that long subagent runs (>10 min) do not trigger an MCP reap mid-cycle.

**Acceptance Criteria:**

**Given** the crew MCP server running as a stdio child of Claude Code, **When** the parent closes the child's stdin after an idle threshold (~10 min observed on 2026-05-25), **Then** at least one of:

- (a) **client-side fix:** the MCP server child remains alive and responsive to new tool calls after stdin close, OR
- (b) **host-side knob:** documented confirmation (linked from `plugins/crew/docs/`) that the host's idle threshold is configurable in `~/.claude/settings.json` and a recommended setting for crew users is published, OR
- (c) **escalation artefact:** a written request to Anthropic with the reproduction (diag log from 2026-05-25 + minimal SDK repro) and a tracked response.

**Given** the chosen path (a/b/c), **When** an operator runs `/crew:start` with a single subagent that takes 15+ min, **Then** the MCP server is still responsive on subagent return and `processDevTranscript` succeeds without `/reload-plugins`.

**AC3 (integration):** if path (a) was taken, vitest covers an idle-survival test (kill parent stdin, assert server still answers a follow-up tool call). If path (b) or (c) was taken, the documented artefact is committed under `plugins/crew/docs/` and linked from the resilience guide (Story 5.9).

**Note:** path (a) is preferred for durability. Paths (b)/(c) are acceptable fallbacks if Anthropic's host architecture makes (a) impossible. The diagnostic instrumentation that produced today's evidence is captured in the postmortem § L7 follow-up #5.

## Story 5.13: Planner-validator — prose vs manifest deps at scan time (+ typed `blocked_by`)

> Added 2026-05-27 from the pre-Epic-5 enhancement plan.
> Source: postmortem § L4 + Epic 4 retro § Carry-forward remediation (typed `blocked_by`).
> Independent of 5.10 / 5.11 / 5.12. Closes the last functional pre-dogfood gap.

As a plugin operator,
I want `/crew:scan` to refuse to write a `to-do/` manifest whose `depends_on` set drifts from the dependencies declared in the spec's prose, AND I want `blocked_by` reasons to be a typed enum rather than a free-string sink,
So that planner-author mistakes are caught before claim time and `blocked/` manifests can be programmatically routed instead of inscrutably re-surfaced to the operator.

**Acceptance Criteria:**

**AC1:** `scanSources` extracts dep references from the spec body (well-defined patterns: explicit `Depends on:` lines, `[[story-key]]` cross-references, etc. — exact patterns TBD by spec author). When the extracted set drifts from the manifest's `depends_on`, the scan refuses to write and surfaces `[deps-drift] <ref> — prose: {...}, manifest: {...}` on stderr.

**AC2:** `blocked_by` is a typed enum, not a free string. Initial members: `handoff-grammar | deps-drift | quota-exhausted | worktree-leak | reviewer-verdict-needs-changes | reviewer-verdict-blocked | reviewer-no-session-result | gh-defer | gh-needs-human | orphan-no-transcript` (the last entry rides on 5.11's existing `blockOrphanNoTranscript` path). Zod-enforced at the boundary; existing writes migrate to typed values.

**AC3:** `/crew:start`'s blocked-recovery surface (per memory `project_blocked_recovery_prose_lies`) uses the typed reason to render a per-case operator hint, not the current generic "clear blocked_by and re-run" prose.

**AC4 (integration):** vitest covers (a) a synthetic spec whose prose declares a dep the manifest omits → scan refuses with `[deps-drift]`; (b) a `blocked_by` write with an unknown enum value → Zod rejects at the boundary; (c) `/crew:start` surfaces the typed-reason hint for each enum member.

**AC5 (integration):** existing `blocked/` fixtures in tests are migrated to typed values; no test references a free-string `blocked_by`.

---

## Story 5.15: Fix `gh pr view --json baseRepository` non-field in 3 reviewer/auto-merge tools

> Added 2026-05-27 from the first dogfood canary against `jackmcintyre/scratch` (PR #1).
> Source: canary halt at `/crew:start` reviewer step. Diagnosis in `/tmp/handoff-2026-05-27-canary-baseRepository-fix.md`.
> Blocks dogfood resumption. Substrate.

As a plugin operator,
I want `/crew:start`'s reviewer and auto-merge tools to query a valid `gh` field for the base repo identity,
So that the reviewer step doesn't halt every story with `Unknown JSON field: "baseRepository"`.

**Background:** Three tools call `gh pr view <n> --json baseRepository`, but `baseRepository` is not a real `gh pr view` JSON field (confirmed against gh 2.92.0; real fields include `baseRefName, baseRefOid, headRepository, headRepositoryOwner, isCrossRepository`). Tests pass because `run-auto-merge-gate.test.ts:54` mocks a synthetic `baseRepository: { name, owner: { login } }` shape that never gets validated against the real `gh` schema — classic stub-vs-real gap. Every canary `/crew:start` halts the inner cycle at `apply-reviewer-labels` and `postReviewerComments`.

**Acceptance Criteria:**

**AC1:** All three call sites stop referencing `baseRepository` from `gh pr view --json`. Replacement source for the base-repo `{owner, name}` is `gh repo view --json owner,name` (the base repo for a PR opened against the current repo IS the current repo). Spec author MAY pick `git config --get remote.origin.url` parsing instead if it's strictly simpler; pick one and apply uniformly. `artifact: plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts, plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts, plugins/crew/mcp-server/src/tools/run-auto-merge-gate.ts`

**AC2:** A real-gh integration test exercises the new code path against actual `gh repo view --json owner,name` output, skipped (not failed) when `gh` is unavailable on the host. The test asserts that the returned shape matches what the three tools consume. `vitest: plugins/crew/mcp-server/src/tools/__tests__/gh-base-repo.integration.test.ts`

**AC3:** A cheap guard test fails if any file under `plugins/crew/mcp-server/src/` contains the string `baseRepository` in a `gh pr view --json` context (grep-based; assertion text names the offending file:line). Prevents regression. `vitest: plugins/crew/mcp-server/src/tools/__tests__/no-base-repository-field.test.ts`

**AC4:** The existing mock in `run-auto-merge-gate.test.ts:54` is updated to match the new real shape (or removed if no longer needed). Other affected tests are migrated in the same change. `vitest: plugins/crew/mcp-server/src/tools/__tests__/run-auto-merge-gate.test.ts`

**AC5 (manual canary):** After merge, re-running `/crew:start` against scratch repo `jackmcintyre/scratch` (orphan in-progress manifest preserved from today's canary) advances past the reviewer step without the `Unknown JSON field` halt. Documented in retro notes; not a CI gate.

---
