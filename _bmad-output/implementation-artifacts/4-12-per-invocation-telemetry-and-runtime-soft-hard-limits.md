# Story 4.12: Per-invocation telemetry and runtime soft/hard limits

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin maintainer**,
I want **every dev/reviewer subagent spawn to write an `agent.invoke` event, every reviewer summary comment to write a `reviewer.verdict` event, every reviewer that exceeds 8 minutes wall-clock to be replaced with a `needs-human`-labelled failure comment, and every dev spawn that exceeds the 30-minute per-story budget to be detectable by the next orchestration poll**,
so that **the agreement metric (Story 4.10), outcome stats (Story 6.x), and skill-effectiveness reports have authoritative per-invocation data — and runaway reviewer/dev spawns cannot silently waste an entire session's compute without surfacing to the operator**.

### What this story is, in one sentence

Wire `logTelemetryEvent` calls into the existing `processDevTranscript`, `processReviewerTranscript`, and `postReviewerComments` tool-layer seams (NOT into SKILL.md prose); add a hard 8-minute reviewer-runtime guard to `postReviewerComments` that substitutes the verdict body with a `needs-human` failure comment when exceeded; stamp `claimed_at` on the in-progress manifest in `claimStory` and add a `findStuckDevClaims` helper (plus a thin MCP tool wrapper) that any future poll (Story 5.4) can call to surface in-progress claims exceeding the configurable 30-min budget.

### What this story does (and why it needs its own story)

Stories 1.5 (`logger.ts` writer) and 4.10 (`ReviewerVerdictEventSchema` schema widening) shipped the telemetry substrate. Story 2.6 (`team-stats.ts`) shipped the first reader. Story 4.10 shipped the second reader (`computeAgreement`). This story is the **writer** that fills both readers' input buckets with the event types that have so far been absent on disk — `agent.invoke` (per-spawn) and `reviewer.verdict` (per-posted-verdict). Without it, `team-stats.ts` returns zeros for everything and `computeAgreement` returns `null` forever.

Three reasons this is one story rather than four:

1. **Single architectural concern.** FR65, FR66, NFR2, and NFR3 all sit under § Telemetry & Observability / § Runtime Budgets in the PRD. The four ACs share the same code paths (`postReviewerComments` for both reviewer.verdict and the 8-min substitution; `processDevTranscript`/`processReviewerTranscript` for agent.invoke runtime stamps; `claimStory` + new helper for the 30-min budget). Splitting would force two stories to touch the same files in lockstep — and the load-bearing-tool-layer rule (see [[feedback_default_to_deterministic_seams]] and [[feedback_prose_mut_steps_need_seam]]) is easier to enforce in one PR than four.

2. **Same TODO blocks.** Three existing files carry `TODO(4.12)` markers: `run-reviewer-session.ts` (line 29), `post-reviewer-comments.ts` (line 26), `apply-reviewer-labels.ts` (line 23). Resolving them coherently — including the schema-extraction work for "what does a reviewer.verdict event payload look like at the writer side" — belongs in one story so the writer's contract matches the reader's expectations exactly.

3. **The 8-min hard limit and the verdict writer share a code path.** `postReviewerComments` is the natural seam for both: the timeout-substitution check happens BEFORE the normal verdict body composition, and the `reviewer.verdict` emission happens AFTER a successful post. Splitting them would mean two consecutive stories touching the same function body.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Implement the watch-skill or orchestration polling loop itself. Story 5.3 owns the polling cadence and surface; Story 5.4 owns stuck-story and stale-claim detection. This story ships the SUBSTRATE (the `findStuckDevClaims` helper + a `getStuckDevClaims` MCP tool) that Story 5.4 will call. AC4 below requires that an integration test demonstrate the helper returns the right set; it does NOT require a running poll loop.
- (c) Backfill `eventual_merge_action` on resolved PRs. This story writes `reviewer.verdict` events with `eventual_merge_action: null` at verdict-post time. The backfill (`gh pr list --state closed --search "label:reviewed-by-agent"` poll that rewrites the JSONL line in place) is deferred — see § Deferred work. `computeAgreement` (Story 4.10) already excludes unresolved events from its window, so the helper degrades gracefully until the backfill ships.
- (d) Add a separate `reviewer.comments_posted` or `reviewer.labels_applied` event type. The TODO comments in `post-reviewer-comments.ts` and `apply-reviewer-labels.ts` reference those event types speculatively; the PRD only requires `reviewer.verdict` (FR66). This story emits `reviewer.verdict` from `postReviewerComments` on a successful post; the `comments_posted`/`labels_applied` events are NOT shipped and the TODO comments are removed once `reviewer.verdict` is wired. A future story can re-introduce them if a reader needs them.
- (e) Add token-count fields (`tokens_in`, `tokens_out`) to `agent.invoke` events. The schema declares them as optional (Story 1.5); the writer in this story does NOT populate them. Claude Code's `Task` tool does not surface per-spawn token counts to the parent prose layer in v1, and inferring them from transcript bytes would be wrong. A future story (or a future Claude Code feature) can populate the fields when the data is available; the schema already accommodates them.
- (f) Modify the existing `agent.invoke` event schema. The schema was finalised in Story 1.5; the field set (`runtime_ms` required, `tokens_in`/`tokens_out` optional) is the contract. This story USES the schema; it does NOT touch `schemas/telemetry-events.ts`.
- (g) Re-shape the `reviewer.verdict` event schema. The schema was added by Story 4.10 (additive widening of `TelemetryEventSchema`). This story USES it verbatim; it does NOT modify the schema or the discriminated union. (If 4.10 has not landed when this story enters dev, see § Schema dependency notes below — the dev agent must STOP and surface the dependency rather than re-author the schema here.)
- (h) Change the SKILL.md prose to write telemetry. The prose layer captures `Date.now()` at spawn time and passes it into the tool-layer call as a parameter; the WRITE happens in the tool. This matches the locked feedback that "prose-level mutating steps need a tool seam" (see [[feedback_prose_mut_steps_need_seam]]) — verified-skipped under load in prior smokes.
- (i) Change the reviewer subagent's permission YAML. The reviewer does not call `logTelemetryEvent` directly; the parent dev session's tool layer writes events. No new tool is added to `permissions/generalist-reviewer.yaml`.
- (j) Change the dev subagent's permission YAML. Same logic — the dev subagent does not write telemetry directly; the parent session writes after the Task returns.
- (k) Introduce a per-session "wall-clock cap" outside the per-spawn budgets. The 8-min reviewer cap (NFR2) and the 30-min dev cap (NFR3) are per-invocation; a per-session cap is not in the PRD and is deferred.
- (l) Persist runtime metrics to any file other than `.crew/telemetry/<YYYY-MM>.jsonl`. No new `<root>/.crew/state/...` file is created by this story for telemetry purposes. (The `claimed_at` field added to in-progress manifests is the only on-disk state change beyond telemetry.)
- (m) Surface the 30-min budget surfacing inside `claimNextStory` or `getStatus`. Per (b), the surfacing belongs to Story 5.3/5.4; this story ships the helper and an MCP-tool wrapper for it. Wiring it into a poll surface is explicitly out of scope to keep this story focused.
- (n) Change `runReviewerSession`'s internal logic. The TODO at `run-reviewer-session.ts:29` is removed as part of this story (no `agent.invoke` is written from inside `runReviewerSession`; the parent session writes it from `processReviewerTranscript`). The reviewer's verdict-derivation logic (Story 4.6 revision 2) is untouched.
- (o) Change the dev agent persona file or the reviewer persona file. No persona-prose change.
- (p) Add a CLI command for the new MCP tool (`getStuckDevClaims`). Same rationale as Story 4.10's deferred CLI wrapper — no v1 caller types it from a shell; Story 5.4 will call it programmatically. CLI surface deferred.
- (q) Cache `findStuckDevClaims` results across calls. The function re-reads all in-progress manifests on every call. The in-progress set is small (v1 deployments will rarely have more than a handful concurrent) and the function runs at most once per poll. No caching.
- (r) Validate the schema of in-progress manifests beyond what `parseExecutionManifest` already does. The new `claimed_at` field is added to `ExecutionManifestSchema` additively (nullable for backward compatibility with existing in-progress manifests that pre-date this story); `parseExecutionManifest` enforces it like every other field.
- (s) Hand-edit existing in-progress manifests at install time to add `claimed_at`. The field is `.optional()`/`.nullable()`; pre-existing manifests parse with `claimed_at: undefined` and are simply IGNORED by `findStuckDevClaims` (no `claimed_at` → cannot compute age → skipped). New claims after this story lands carry the field.
- (t) Backfill historical telemetry. v1 deployments may have run prior sessions without any `agent.invoke` or `reviewer.verdict` events; this story does NOT scan transcripts or reconstruct events for those. The telemetry corpus starts at the first session AFTER this story ships.

### Deferred work

- **`eventual_merge_action` backfill loop.** A `gh pr list --state closed --search "label:reviewed-by-agent"` poll that finds resolved PRs whose `reviewer.verdict` events still carry `eventual_merge_action: null`, then rewrites the JSONL line (or appends a follow-up `reviewer.verdict.resolved` event — design decision deferred). Owned by a successor story (likely Epic 5 once the watch loop exists).
- **Per-session token totals.** Once Claude Code surfaces per-spawn token counts to the parent prose, populate `tokens_in` / `tokens_out` on `agent.invoke` events. Schema already accommodates this; writer skips the fields in v1.
- **CLI command for `getStuckDevClaims`.** A `crew stuck-claims [--budget-min N]` shell-runnable command. Deferred until Story 5.4 lands the surfacing flow.
- **Per-role budgets.** A configurable per-role budget map (e.g. `{ "generalist-dev": 30, "security-specialist": 60 }`) read from `.crew/config.yaml`. v1 uses a single `dev_budget_ms` value (default 30 min). The helper accepts the budget as a parameter so per-role budgets are an additive change later.
- **`reviewer.comments_posted` / `reviewer.labels_applied` event types.** Speculative new event types referenced in the existing TODO comments. Not required by any FR; not added in v1. The TODO comments are REMOVED by this story (replaced with the actual call sites or a JSDoc note pointing at the post-shipped writer).
- **Telemetry replay tool.** A `crew telemetry-replay [--filter type=reviewer.verdict]` debugging command. Out of scope.

---

## Acceptance Criteria

> AC1, AC2, AC3, AC4 are verbatim from the epic (with `(d)` of AC5 split into its own AC for testability). AC5 is the integration suite. Per `plugins/crew/docs/user-surface-acs.md`, this story is **substrate**: telemetry writes are invisible to the operator (no chat-surface line emits per event), the timeout substitution is an internal failure path (operator sees the resulting `needs-human` label, not the substitution mechanism), and the `findStuckDevClaims` helper is consumed by a future poll. Per the rubric's strict-membership rule (i)–(iv), no AC triggers the `(user-surface)` tag.

**AC1:**
**Given** any agent subagent spawn,
**When** the subagent runs,
**Then** the dev session writes an `agent.invoke` event (agent type, story id, wall-clock runtime, timestamp). _(FR65)_

vitest: agent.invoke event written on dev spawn

<!-- vitest: agent.invoke is written on every spawn -->

<!-- Not user-surface: AC1 describes a telemetry-file write; no chat-surface line is emitted. -->

**AC2:**
**Given** any reviewer summary comment,
**When** posted,
**Then** a `reviewer.verdict` event is written carrying PR number, verdict sentinel, standards version, plugin version, and the eventual merge action (filled in retrospectively when the PR closes). _(FR66)_

vitest: reviewer.verdict event written on post

<!-- vitest: reviewer.verdict is written on every verdict comment -->

<!-- Not user-surface: AC2 describes a telemetry-file write; the operator sees the PR review, not the JSONL line. -->

**AC3:**
**Given** a reviewer exceeding 8 min wall-clock,
**When** the dev session inspects,
**Then** it substitutes the verdict comment with a failure comment, applies `needs-human`, and does not mark the story failed. _(NFR2)_

vitest: reviewer 8-min hard limit substitutes verdict

<!-- vitest: hard-8-min substitution applies needs-human and does not mark the story failed -->

<!-- Not user-surface: AC3's user-visible effect is the `needs-human` label (which Story 4.8 already governs as a label-only surface, not an operator-typed surface). -->

**AC4:**
**Given** a dev subagent exceeding its per-story budget (default 30 min),
**When** the orchestration session next polls,
**Then** it surfaces the story as stuck. _(NFR3, see also Story 5.4)_

vitest: 30-min dev budget surfaces in next poll

<!-- vitest: 30-min dev budget surfaces in the next poll (via the findStuckDevClaims helper that Story 5.4 will consume) -->

<!-- Not user-surface: AC4's surface is a helper return value consumed by Story 5.4's poll; this story does not wire the poll. -->

**AC5 (integration):**
vitest covers (a) `agent.invoke` written on every spawn, (b) `reviewer.verdict` written on every verdict comment, (c) hard-8-min substitution, (d) 30-min dev budget surfaces in the next poll.

vitest: per-invocation-telemetry

<!-- Not user-surface: vitest integration suite — internal harness only. -->

**AC6 (user-surface):**
**Given** the dev or reviewer subagent's last terminal/agent output contains a Claude session-limit string (`/You'?ve hit your (session|account) limit/i` or equivalent — pin the exact regex set in dev notes),
**When** `processDevTranscript` or `processReviewerTranscript` parses the transcript,
**Then** the outcome is classified as typed `SessionQuotaExhaustedError`, the dev-outcome / reviewer-outcome JSON records `failure: { class: "session-quota-exhausted", recoverable: true }`, and `/crew:start` emits chat line `Story ${storyUlid} paused — session quota exhausted; retry after quota resets` and moves the manifest to `blocked/` (not `done/`). _(retro carry-forward #2 — see Retro Amendments below)_

vitest: SessionQuotaExhaustedError classified from transcript

<!-- User-surface: the `Story ${storyUlid} paused — session quota exhausted` chat line is operator-visible on /crew:start. -->

**AC7 (substrate):**
**Given** the dev subagent has signalled handoff (locked-phrase emitted),
**When** `runDevTerminalAction` runs the pre-handoff verification,
**Then** the tool runs `pnpm -w typecheck && pnpm -w test --run` from the worktree root and on non-zero exit classifies the outcome as typed `PreHandoffSuiteRedError` (recoverable: true). The dev's locked-phrase emission alone is insufficient to advance state. _(retro carry-forward #8 — see Retro Amendments below)_

vitest: PreHandoffSuiteRedError raised when suite is red

### Expanded acceptance specifics (folded into AC1–AC5 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** Per-spawn `agent.invoke` emission:

- (1a) **Two write sites.** `processDevTranscript` writes `agent.invoke` with `agent: "generalist-dev"`; `processReviewerTranscript` writes `agent.invoke` with `agent: "generalist-reviewer"`. NO write happens from inside `runReviewerSession` (which executes inside the reviewer subagent's context) — the `TODO(4.12)` at `run-reviewer-session.ts:29` is REMOVED and replaced with a JSDoc note pointing at the parent-session writer.

- (1b) **Spawn-start timestamp passed by SKILL.md prose.** Both `processDevTranscript` and `processReviewerTranscript` gain a required `spawnStartedAt: number` option (epoch ms). The SKILL.md prose (`plugins/crew/skills/start/SKILL.md`) captures `Date.now()` immediately BEFORE invoking the Task tool and passes it into the process-tool call. The tool computes `runtime_ms = (opts.now ?? Date.now()) - spawnStartedAt` and writes the event.

- (1c) **Required event fields.** Both writers emit:
  ```ts
  {
    type: "agent.invoke",
    session_id: opts.sessionUlid,        // re-used across the session
    agent: "generalist-dev" | "generalist-reviewer",
    story_id: opts.ref,                  // the manifest ref (e.g. a native or bmad-prefixed identifier)
    data: { runtime_ms: number },        // tokens_in / tokens_out omitted (see § What this story does NOT (e))
    // ts: stamped by logger.ts (Story 1.5 contract)
  }
  ```

- (1d) **Write happens on EVERY return path of the process-tool.** Including the blocked branches (`done-blocked-handoff-grammar`, `done-blocked-gh-defer`, `done-blocked-gh-retry`, `done-blocked-gh-needs-human` for dev; `done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`, `done-blocked-no-session-result` for reviewer). The event records the SPAWN, not the outcome — even a malformed-handoff dev still spawned and ran. The write happens via a single helper call at the top of the function (after parameter validation, before the existing branching logic) OR inside a `try { ... } finally { ... }` that wraps the function body. Implementation chooses the simpler form; tests cover both green and blocked paths.

- (1e) **Telemetry write errors do NOT block the function's normal return.** Wrap the `logTelemetryEvent` call in a `try/catch`; on catch, log a chat-line `agent-invoke telemetry write failed: <err.message>` (added to the returned `chatLog` array) and continue. The process tool's normal return value is unchanged. Rationale: telemetry is observability; a disk-full state must not break the dev cycle. Mirror's logger.ts's own approach: the writer throws on Zod failure (NFR6), but the caller swallows the error here because the caller is on the critical happy-path of the dev cycle.

- (1f) **Test seam for time.** Both `processDevTranscript` and `processReviewerTranscript` accept an optional `now?: () => number` (epoch ms) option, defaulting to `() => Date.now()`. The helper internally calls `opts.now()` once to compute `runtime_ms`. Tests pass a deterministic `now` so `runtime_ms` is fixed.

- (1g) **`agent` field must satisfy the schema regex.** `TelemetryEventBase.agent` is `z.string().regex(/^[a-z0-9-]+$/)`. The literal `"generalist-dev"` and `"generalist-reviewer"` pass. (Verified: same regex was satisfied by Story 1.5's logger tests for the same role names.)

- (1h) **`session_id` carries the ULID from the parent SKILL prose.** Story 4.2's `mintSessionUlid` is called once per `/crew:start` invocation; the same ULID is the session_id on every `agent.invoke` event in that session.

- (1i) **`story_id` is the manifest ref, not a story slug.** The ref includes the adapter prefix (a native ULID-shaped id or a bmad numeric id, in each case prefixed by the adapter name). This matches the schema's "opaque identifier" description and is the same value used in claim-flow telemetry seams.

**AC2 unpacked.** Per-post `reviewer.verdict` emission:

- (2a) **Write site.** `postReviewerComments` writes the event AFTER a successful POST or PATCH of the verdict review (i.e. after `apiResult.stdout` parses successfully and `postedReviewId` is known). On the `skipped-no-session-result` branch, NO event is written (there was no verdict to record). On the timeout-substitution branch (AC3), NO `reviewer.verdict` event is written either — only a `reviewer-failure` label is applied; the event would mis-represent a non-verdict as a verdict.

- (2b) **Required event fields.** The writer emits:
  ```ts
  {
    type: "reviewer.verdict",
    session_id: opts.sessionUlid,
    agent: "generalist-reviewer",
    story_id: resultFile.ref,
    data: {
      pr_number: resultFile.prNumber,
      verdict: resultFile.recommendedVerdict,    // "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED"
      standards_version: resultFile.standardsVersion,
      plugin_version: pluginVersion,             // already resolved at the top of postReviewerComments
      eventual_merge_action: null,               // resolved by future backfill loop (deferred)
    },
  }
  ```

- (2c) **`verdict` literal carries spaces.** The schema enum from Story 4.10 is `z.enum(["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED"])` — verdict literals with spaces, matching the locked verdict-line grammar from Story 4.6b. The writer copies `resultFile.recommendedVerdict` verbatim (no canonicalisation, no underscore-substitution). Story 4.10's `computeAgreement` keys the distribution counters with underscored variants; the EVENT carries the spaced literals.

- (2d) **`eventual_merge_action` is always `null` at write time.** Defined as `z.enum([...]).nullable()` in Story 4.10's schema. The PR is still open when the verdict is posted; the eventual action is only known later. v1 writes `null` unconditionally; the backfill loop is deferred work.

- (2e) **Same `try/catch` swallow as AC1 (1e).** If `logTelemetryEvent` throws (Zod failure should be unreachable given the strict event-construction; disk-full is the realistic failure), log the failure to `chatLog` and return the normal `postReviewerComments` result. The reviewer's verdict has been POSTED to GitHub at this point — failing the function would mis-represent reality.

- (2f) **PATCH path also emits.** When `wasEdit === true` (a prior verdict was PATCH-edited in place rather than POST-ed afresh), still emit the `reviewer.verdict` event. Rationale: the verdict changed (otherwise PATCH would be a no-op); the agreement metric should see the new value. Tradeoff: this means a rework cycle produces N events for N verdict revisions on the same PR. The agreement metric's window is rolling — old events fall out — so duplication is harmless.

- (2g) **`session_id` is the dev session's ULID, NOT the reviewer subagent's session id.** The reviewer subagent runs inside the parent dev session's session context (Story 4.6); there is no separate reviewer ULID. The dev session minted the ULID once at /crew:start; the same ULID stamps every event written by tools called downstream of that mint.

- (2h) **`standards_version` source.** `resultFile.standardsVersion` is the field set by Story 4.7 inside `runReviewerSession` and persisted to `reviewer-result.json`. This story does NOT re-read or re-validate the standards doc — it consumes the persisted value verbatim.

- (2i) **`plugin_version` source.** `getPluginVersion()` is already resolved at the top of `postReviewerComments` (Story 4.7) and exists as the local `pluginVersion` variable. The writer uses that same variable; no second read.

**AC3 unpacked.** 8-min reviewer wall-clock hard limit:

- (3a) **Check site.** `postReviewerComments` accepts a new required `spawnStartedAt: number` option (epoch ms — same convention as AC1's spawn timestamp). At the TOP of the function (after `readReviewerResultFile` returns a non-null result), compute `elapsedMs = (opts.now ?? Date.now()) - spawnStartedAt`. If `elapsedMs > REVIEWER_HARD_LIMIT_MS` (8 * 60 * 1000 = 480_000), enter the timeout-substitution branch.

- (3b) **Timeout-substitution branch behaviour.** When triggered:
  1. SKIP the normal verdict-body composition and the inline-comment scan.
  2. POST a substitute review body (event: `COMMENT`, no inline comments). The body text is:
     ```
     **Reviewer timeout** — the reviewer subagent exceeded the 8-minute hard limit (NFR2) and was terminated. This PR has been labelled `needs-human` and the story has NOT been marked failed; an operator must inspect the dev branch and decide next steps.

     `standards_version: {standardsVersion}` · `plugin_version: {pluginVersion}`

     <!-- crew:verdict:reviewer-timeout:{ref} -->
     ```
     The footer marker uses the literal `reviewer-timeout` in the role-slot so a subsequent rerun's PATCH lookup can find it (the marker grammar mirrors the normal `<!-- crew:verdict:{role}:{ref} -->` from Story 4.6b).
  3. Return `{ next: "reviewer-timeout", postedReviewId, verdictLine: "**Reviewer timeout** — 8-minute hard limit exceeded", elapsedMs }`. The discriminated-union variant on `PostReviewerCommentsResult` grows by one — see (3f) below.
  4. NO `reviewer.verdict` telemetry event is emitted (per AC2 (2a)).

- (3c) **`SKILL.md` prose handles the new return variant.** Step 9a's existing switch gains a `reviewer-timeout` branch:
  - log a chat-surface line `reviewer timeout — 8-minute hard limit exceeded; applying needs-human label and halting inner cycle for operator inspection`
  - call `applyReviewerLabels({ targetRepoRoot, sessionUlid, verdictOverride: "reviewer-failure" })` (reuses the existing Story 4.8 override which applies `needs-human`; we do NOT introduce a separate `"reviewer-timeout"` override because the behaviour is identical)
  - SKIP step 10 (`processReviewerTranscript`) entirely — the manifest stays in `in-progress/` with no `blocked_by` stamp from `processReviewerTranscript`. To preserve the "story not marked failed" guarantee, the prose explicitly does NOT call `processReviewerTranscript` on this branch.
  - Best-effort: stamp `blocked_by: "reviewer-timeout"` on the in-progress manifest via a new MCP tool `markReviewerTimeout({ targetRepoRoot, sessionUlid, ref, manifestPath })` so the manifest carries the diagnostic for the next operator pass. The tool reuses the same atomic-rewrite pattern as `processReviewerTranscript`'s blocked-stamp helpers (look up the helper used for `blocked_by: "reviewer-verdict-blocked"` and reuse). If `markReviewerTimeout` throws, log the failure but DO NOT halt — the GitHub-side `needs-human` label is the primary signal.
  - Return to the outer loop (step 4 in SKILL.md), which calls `claimNextStory` for the next story; the timed-out story remains claimed in-progress with `blocked_by: reviewer-timeout`, so it does not re-enter the candidate set.

- (3d) **"Does not mark the story failed" — concrete definition.** The AC's "not mark failed" means: (i) the manifest is NOT moved from `in-progress/` to `done/`, (ii) no `status: "done"` is written, (iii) no `completeStory` call is made. The manifest stays in `in-progress/` with `blocked_by: "reviewer-timeout"`. This matches the existing `done-blocked-reviewer-blocked` pattern (Story 4.6 revision 2) — the story is "held" not "failed".

- (3e) **PATCH-path interaction.** If a prior verdict review exists (from an earlier reviewer spawn that completed within budget) and the current reviewer times out, the substitution body REPLACES the prior verdict via the same PATCH lookup as the normal happy path. The footer marker for the substitution is `<!-- crew:verdict:reviewer-timeout:{ref} -->`; the prior verdict's marker may have been `<!-- crew:verdict:generalist-reviewer:{ref} -->`. The PATCH lookup MUST match EITHER footer pattern when searching for a prior review to PATCH. Implementation: the existing `footerPattern` regex (`<!-- crew:verdict:[^:]+:{ref} -->`) already matches both, because the role slot is `[^:]+`. No regex change needed.

- (3f) **Updated `PostReviewerCommentsResult` discriminated union.** The type grows by one branch:
  ```ts
  | {
      next: "reviewer-timeout";
      postedReviewId: number;
      verdictLine: string;
      elapsedMs: number;
    }
  ```
  Existing branches (`skipped-no-session-result`, `posted`) are unchanged. All call sites that exhaustively switch on `next` must handle the new branch — only `SKILL.md` prose switches on it in v1 (the prose layer is the only `postReviewerComments` caller).

- (3g) **The 8-minute constant.** Declared as `const REVIEWER_HARD_LIMIT_MS = 8 * 60 * 1000` at the top of `post-reviewer-comments.ts`. NOT read from `.crew/config.yaml` in v1 — the NFR pins 8 minutes as a hard architectural commitment, not an operator-tunable knob. Future per-deployment override is deferred work.

- (3h) **Telemetry on the timeout branch.** An `agent.invoke` event for the reviewer IS still written by `processReviewerTranscript`... except `processReviewerTranscript` is NOT called on the timeout branch (per (3c)). To preserve AC1's "EVERY spawn" guarantee, `postReviewerComments` itself emits the `agent.invoke` event in the timeout branch — with the SAME shape as AC1 (1c) but `runtime_ms` set to `elapsedMs`. The double-write risk (postReviewerComments writes agent.invoke for reviewer, processReviewerTranscript also writes agent.invoke for reviewer on the normal path) is avoided because the two paths are mutually exclusive: timeout-branch SKIPS `processReviewerTranscript`; normal-branch path lets `processReviewerTranscript` write the event.

- (3i) **`spawnStartedAt` provenance.** The same `reviewerSpawnStartedAt` captured in SKILL.md prose immediately before the reviewer Task call is passed to BOTH `postReviewerComments` (for the timeout check) AND `processReviewerTranscript` (for the runtime_ms stamp). Two parameters, one source. The SKILL.md update plumbs the variable through both calls.

**AC4 unpacked.** 30-min dev budget surfacing substrate:

- (4a) **`claimed_at` field on the in-progress manifest.** `ExecutionManifestSchema` gains a new optional field `claimed_at: z.string().datetime({ offset: false }).refine((s) => s.endsWith("Z")).nullable().optional()`. Same UTC-ISO-8601 ms-precision format as telemetry's `ts` field. Pre-existing in-progress manifests without `claimed_at` parse with `claimed_at: undefined` (per (s) in § What this story does NOT).

- (4b) **`claimStory` stamps `claimed_at`.** On the `to-do → in-progress` transition, `claimStory` writes `claimed_at: new Date().toISOString()` alongside the existing `claimed_by: sessionUlid` stamp. The atomic rewrite is unchanged; the field is added to the YAML object before stringify. A test seam (`now?: () => Date`) is added consistent with the rest of the codebase.

- (4c) **`findStuckDevClaims` helper signature.**
  ```ts
  export interface StuckDevClaim {
    ref: string;
    manifestPath: string;
    claimedAt: string;        // ISO-8601 UTC ms-precise
    sessionUlid: string;      // from claimed_by
    elapsedMs: number;        // computed at call time
    budgetMs: number;         // echoed back from input
  }

  export async function findStuckDevClaims(opts: {
    targetRepoRoot: string;
    budgetMs?: number;        // default 30 * 60 * 1000
    now?: () => Date;         // test seam
  }): Promise<StuckDevClaim[]>;
  ```

- (4d) **Helper behaviour.**
  1. Read `<targetRepoRoot>/.crew/state/in-progress/` (use `fs.readdir`; on ENOENT return `[]` — no in-progress directory means no stuck claims).
  2. For each `*.yaml` entry: read, `parseExecutionManifest`. If parse throws (malformed manifest), surface a `{ ref: "<file>", manifestPath, elapsedMs: 0, budgetMs, claimedAt: "", sessionUlid: "" }` entry with a synthetic flag? — NO. Decision: on parse error, RE-THROW. A malformed in-progress manifest is a bug; the helper should not silently exclude it. The caller (Story 5.4's poll) will surface the error.
  3. If `claimed_at` is `undefined` or `null`, SKIP the entry (pre-this-story manifests cannot be aged — see (s) in § What this story does NOT).
  4. Compute `elapsedMs = now.getTime() - new Date(claimed_at).getTime()`. If `elapsedMs > budgetMs`, append a `StuckDevClaim` entry; otherwise skip.
  5. Return the array (may be empty), in lexicographic order by ref (preserves `readdir` order after sort — deterministic for test fixtures).
  6. NO mutations — the helper is pure-read.

- (4e) **`getStuckDevClaims` MCP tool wrapper.** Create `plugins/crew/mcp-server/src/tools/get-stuck-dev-claims.ts` — a thin delegate that calls `findStuckDevClaims` from `lib/` and returns the array as JSON. Registered in `register.ts` after the most-recently-registered Epic 4 tool (currently `computeAgreement` from Story 4.10, or `applyReviewerLabels` if 4.10 has not landed). Input schema: `z.object({ targetRepoRoot: z.string().min(1), budgetMs: z.number().int().positive().optional() })`. Output: `{ content: [{ type: "text" as const, text: JSON.stringify(stuckClaims) }] }`.

- (4f) **`DEV_BUDGET_MS_DEFAULT` constant.** Declared at the top of `lib/find-stuck-dev-claims.ts` as `export const DEV_BUDGET_MS_DEFAULT = 30 * 60 * 1000` (30 minutes). Both the lib function and the MCP-tool input default to this value when `budgetMs` is omitted.

- (4g) **The "next poll" framing.** AC4 says "When the orchestration session next polls, Then it surfaces the story as stuck." This story does NOT implement the poll — the substrate is the helper + tool. The integration test demonstrates the surfacing-as-stuck behaviour by calling the helper directly on a fixture and asserting the returned set matches expectations. Story 5.4 will wire the helper into a real poll loop. The chat-surface line operators eventually see (when 5.4 lands) is owned by 5.4.

- (4h) **Budget comparison is strict `>`, not `>=`.** A claim exactly at the budget is NOT stuck. Rationale: edge-case symmetry — a fresh claim with `elapsedMs === 0` is clearly not stuck; consistency favours strict-greater throughout.

**AC5 unpacked.** Integration suite scope:

- (5a) **Test-file layout.** Six new test files (matching the production file layout):
  - `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts` — extended (existing file) with cases (5c).
  - `plugins/crew/mcp-server/src/tools/__tests__/process-reviewer-transcript.test.ts` — extended with cases (5c).
  - `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` — extended with cases (5d) and (5e).
  - `plugins/crew/mcp-server/src/lib/__tests__/find-stuck-dev-claims.test.ts` — new, covers cases (5f).
  - `plugins/crew/mcp-server/src/tools/__tests__/get-stuck-dev-claims.test.ts` — new, covers MCP-tool-boundary cases.
  - `plugins/crew/mcp-server/src/tools/__tests__/claim-story.test.ts` OR `claim-next-story.test.ts` — extended with the `claimed_at` stamp assertion (whichever existing file already covers claim-flow writes).

- (5b) **Fixture utilities (reused across tests).** A `writeJsonl(targetRepoRoot, month, events)` helper (mirroring Story 4.10's pattern), a `verdictEvent(opts)` factory, and a `readTelemetry(targetRepoRoot)` helper that reads all `.crew/telemetry/*.jsonl`, parses, and returns the event array. Defined in a shared `__fixtures__/telemetry.ts` if more than one test file uses them; otherwise inline.

- (5c) **(a) `agent.invoke` per spawn — covered in two files.**
  - In `process-dev-transcript.test.ts`: seed a tmpdir, stub `Date.now()` via the new `now` option, call `processDevTranscript` with `spawnStartedAt: 1000`, `now: () => 5500`. Assert: `.crew/telemetry/<month>.jsonl` contains exactly one event with `type: "agent.invoke"`, `agent: "generalist-dev"`, `data.runtime_ms: 4500`, `story_id: "<ref>"`, `session_id: "<ulid>"`.
  - Repeat for `process-reviewer-transcript.test.ts` with `agent: "generalist-reviewer"`.
  - Negative case: call the process-tool TWICE (simulating a rework cycle); assert exactly TWO events written (one per call). Cross-file scan order from team-stats.ts's tests proves the readdir step doesn't skip the new file.
  - Telemetry-write-failure case: stub `logTelemetryEvent` to throw; assert the function still returns normally AND the returned `chatLog` includes the `agent-invoke telemetry write failed: ...` line.
  - Schema-construction case: assert the event object passed to `logTelemetryEvent` (spy the call) carries no extra fields beyond the schema (i.e. `tokens_in` / `tokens_out` are absent, not `undefined`).
  - Blocked-branch case: simulate a malformed-handoff dev transcript (existing test pattern in `process-dev-transcript.test.ts`); assert the `agent.invoke` event IS still written on the blocked-handoff return path. Same for reviewer's `done-blocked-no-session-result` path.

- (5d) **(b) `reviewer.verdict` per post — covered in `post-reviewer-comments.test.ts`.** Three positive cases plus three skip cases:
  - POST path: stub `gh` to return a 201-shape response; assert one `reviewer.verdict` event written with the resolved fields per AC2 (2b).
  - PATCH path: stub `gh` to return a prior review on the GET, then a 200-shape on the PATCH; assert one `reviewer.verdict` event written (per (2f), PATCH also emits).
  - Verdict-literal coverage: parameterise across the three verdict values (`READY FOR MERGE`, `NEEDS CHANGES`, `BLOCKED`); assert each lands in the JSONL line verbatim.
  - Skip case 1: `skipped-no-session-result` branch — NO event written.
  - Skip case 2: `reviewer-timeout` branch — NO `reviewer.verdict` event written (per (2a) and (3h)); but ONE `agent.invoke` event for the reviewer IS written (per (3h)).
  - Skip case 3: telemetry-write failure — stub `logTelemetryEvent` to throw; assert the POST still happened (return value still carries `postedReviewId`) and the failure surfaced in `chatLog`.

- (5e) **(c) Hard-8-min substitution — covered in `post-reviewer-comments.test.ts`.**
  - Time-just-over case: `spawnStartedAt: 0`, `now: () => 480_001` (1 ms over the 8-min limit). Assert: `next === "reviewer-timeout"`, `elapsedMs === 480_001`, the POST body contains "Reviewer timeout — the reviewer subagent exceeded the 8-minute hard limit", the footer marker is `<!-- crew:verdict:reviewer-timeout:{ref} -->`.
  - Time-just-under case: `spawnStartedAt: 0`, `now: () => 480_000` (exactly at the limit). Assert: normal verdict path (per AC3 (4h) — strict greater-than).
  - PATCH-of-prior case: seed a prior review with footer `<!-- crew:verdict:generalist-reviewer:{ref} -->`; trigger timeout; assert the prior review is PATCH-edited with the substitution body.
  - `needs-human` label application: assert `applyReviewerLabels` would be called with `verdictOverride: "reviewer-failure"` (the SKILL.md prose owns this; the post-comments test verifies the function returned the timeout branch so the prose downstream switch can match).
  - Story-not-marked-failed: assert the test fixture's in-progress manifest is NOT moved to `done/` after the timeout branch runs (this is a SKILL.md-level invariant; covered as a higher-level test in `start.smoke.test.ts` if such a file exists, otherwise pinned in the post-comments test by asserting the return shape only — the move-to-done happens in `completeStory`, which is not called on the timeout branch).
  - `agent.invoke` written on timeout: assert exactly one `agent.invoke` event written by `postReviewerComments` itself when the timeout branch fires.

- (5f) **(d) 30-min budget surfacing — covered in `find-stuck-dev-claims.test.ts` and `claim-story.test.ts`.**
  - In `claim-story.test.ts`: assert the in-progress manifest written by `claimStory` carries `claimed_at` in ISO-8601 UTC ms-precise format; assert the value matches a deterministic `now` stub.
  - In `find-stuck-dev-claims.test.ts`:
    - Empty `in-progress/` directory → returns `[]`.
    - Single stuck claim (claimed_at 31 minutes ago) with default budget → returns one entry with correct elapsedMs and budgetMs.
    - Single fresh claim (claimed_at 5 minutes ago) → returns `[]`.
    - Mixed set (3 stuck, 2 fresh) → returns 3 entries in lexicographic ref order.
    - Custom budget (`budgetMs: 60 * 60 * 1000` for 1 hour, 31-min-old claim) → returns `[]` (not stuck under 1-hour budget).
    - Pre-this-story manifest (no `claimed_at` field) → skipped silently.
    - Malformed in-progress manifest → re-throws `MalformedExecutionManifestError`.
    - Exactly-at-budget claim (elapsedMs === budgetMs) → NOT returned (strict `>` per (4h)).
    - ENOENT on `in-progress/` directory → returns `[]`.
  - In `get-stuck-dev-claims.test.ts`:
    - Tool-name camelCase assertion (`"getStuckDevClaims"`).
    - Input validation: `budgetMs: 0` rejected, `budgetMs: -1` rejected, missing `targetRepoRoot` rejected.
    - Valid input round-trip including the empty-array case.

- (5g) **Tool-count assertion bump.** Two new MCP tools register: `getStuckDevClaims` AND `markReviewerTimeout`. Search the test suite for hardcoded counts (`grep -rn "registerTool" plugins/crew/mcp-server/src/__tests__ plugins/crew/mcp-server/src/tools/__tests__ plugins/crew/mcp-server/tests`); bump any assertion by +2.

- (5h) **Schema-test extension for `claimed_at`.** Extend `plugins/crew/mcp-server/src/schemas/__tests__/execution-manifest.test.ts` (or create if absent) with: valid ISO-8601 UTC parses; missing field parses (optional); `null` parses (nullable); malformed-timestamp rejects; non-Z-suffix rejects.

- (5i) **SKILL.md acceptance test.** A new test file `plugins/crew/skills/start/__tests__/spawn-timing.smoke.test.ts` (or equivalent location matching existing skill smokes) that exercises the SKILL.md prose's `spawnStartedAt` plumbing end-to-end against a fake Task tool — verifies that the timestamp captured in prose actually flows into the process-tool calls. If the existing SKILL.md test harness is too thin to express this, skip the test and pin the invariant via the existing prose-line review in `start-skill-acceptance.md`. Document the gap in the story's Completion Notes if so.

- (5j) **End-to-end via existing operator-smoke (if present).** If `plugins/crew/skills/start/__tests__/start.smoke.test.ts` (or similar) exists, extend with a single assertion: after a green-path dev/reviewer cycle on a tmpdir target repo, the `.crew/telemetry/<month>.jsonl` file contains EXACTLY ONE `agent.invoke` event with `agent: "generalist-dev"`, EXACTLY ONE with `agent: "generalist-reviewer"`, and EXACTLY ONE `reviewer.verdict` event. If the smoke does not exist (or runs in a slower CI tier), defer this assertion to the dev agent's manual verification per `verify` skill.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Confirm `ReviewerVerdictEventSchema` is in place (dependency on Story 4.10)** (AC: #2)
  - [ ] 1.1 Open `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`. Confirm `ReviewerVerdictEventSchema` is exported AND included in the `TelemetryEventSchema` discriminated union.
  - [ ] 1.2 If the schema is ABSENT (Story 4.10 has not yet merged to main), STOP and surface the dependency to the operator via the chat surface. Do NOT re-author the schema inside this story. Re-run the story after 4-10 lands.
  - [ ] 1.3 If the schema is PRESENT, import `ReviewerVerdictEvent` (the inferred type) where needed in Task 3.

- [ ] **Task 2: Add the `agent.invoke` writer to `processDevTranscript`** (AC: #1, #5c)
  - [ ] 2.1 In `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts`, extend `ProcessDevTranscriptOptions` (or whatever the existing options type is named) with `spawnStartedAt: number` (required) and `now?: () => number` (optional, default `() => Date.now()`).
  - [ ] 2.2 At the top of the function body, AFTER input parsing and BEFORE the existing branching logic: compute `runtimeMs = (opts.now ?? Date.now()) - opts.spawnStartedAt`. Call a new local helper `await writeAgentInvokeEvent({ targetRepoRoot, sessionUlid, agent: "generalist-dev", ref, runtimeMs })` wrapped in a `try/catch`. On catch, push `agent-invoke telemetry write failed: ${err.message}` to the `chatLog` array (which already exists on every return path of this tool).
  - [ ] 2.3 Create the local helper `writeAgentInvokeEvent` in `plugins/crew/mcp-server/src/lib/agent-invoke-writer.ts`. Signature: `(opts: { targetRepoRoot, sessionUlid, agent, ref, runtimeMs, now? }) => Promise<void>`. Body: construct the event per AC1 (1c), call `logTelemetryEvent({ targetRepoRoot, event, now })`. Export from `lib/`.
  - [ ] 2.4 Update `process-dev-transcript.test.ts` per AC5 (5c) — assert event written on every return path (green and blocked).

- [ ] **Task 3: Add the `agent.invoke` writer to `processReviewerTranscript`** (AC: #1, #5c)
  - [ ] 3.1 In `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts`, extend options with `spawnStartedAt: number` (required) and `now?: () => number` (optional).
  - [ ] 3.2 At the top of the function body (AFTER `readReviewerResultFile` for parity with `postReviewerComments`, but BEFORE the verdict-branching), call `writeAgentInvokeEvent({ ..., agent: "generalist-reviewer" })` via the same helper from Task 2.3, wrapped in `try/catch` with the same chatLog-push pattern.
  - [ ] 3.3 Remove the `TODO(4.12)` comment at `run-reviewer-session.ts:29`. Replace with a JSDoc note: `// agent.invoke for the reviewer is emitted by processReviewerTranscript (parent session); runReviewerSession runs inside the reviewer subagent context where logTelemetryEvent is not available.`
  - [ ] 3.4 Update `process-reviewer-transcript.test.ts` per AC5 (5c).

- [ ] **Task 4: Add the `reviewer.verdict` writer to `postReviewerComments` (POST and PATCH paths)** (AC: #2, #5d)
  - [ ] 4.1 In `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`, AFTER the successful POST path's `postedReviewId` extraction (line ~316) and AFTER the successful PATCH path's `patchedId` extraction (line ~274): call a new local helper `await writeReviewerVerdictEvent({ targetRepoRoot, sessionUlid, agent: "generalist-reviewer", ref: resultFile.ref, prNumber: resultFile.prNumber, verdict: resultFile.recommendedVerdict, standardsVersion: resultFile.standardsVersion, pluginVersion })`. Wrap in `try/catch`; on catch, append the failure line to a local `chatLog` array (NOTE: `postReviewerComments` does not currently return a chatLog; either add one to the return shape or surface the failure via a console.error / no-op log — keep symmetric with the other writers; if the return shape grows, update SKILL.md prose to surface the new chatLog).
  - [ ] 4.2 Decision on chatLog: ADD an optional `chatLog?: string[]` field to `PostReviewerCommentsResult` (additive on all variants). Existing SKILL.md step 9a switch surfaces the chatLog if present (mirror the pattern from `processDevTranscript`).
  - [ ] 4.3 Create the local helper `writeReviewerVerdictEvent` in `plugins/crew/mcp-server/src/lib/reviewer-verdict-writer.ts`. Signature mirrors AC2 (2b)'s event shape. Always sets `eventual_merge_action: null`. Exported from `lib/`.
  - [ ] 4.4 Remove the `TODO(4.12)` comment at `post-reviewer-comments.ts:26`. Remove the `TODO(4.12)` at `apply-reviewer-labels.ts:23` (no `reviewer.labels_applied` event is written; per (d) in § What this story does NOT, the speculative event is deferred indefinitely).
  - [ ] 4.5 Update `post-reviewer-comments.test.ts` per AC5 (5d).

- [ ] **Task 5: Add the 8-min reviewer hard limit to `postReviewerComments`** (AC: #3, #5e)
  - [ ] 5.1 In `post-reviewer-comments.ts`, extend `PostReviewerCommentsOptions` with `spawnStartedAt: number` (required) and `now?: () => number` (optional).
  - [ ] 5.2 At the top of the function (AFTER `readReviewerResultFile` returns non-null, BEFORE the `permissions = await loadRolePermissions(...)` call): compute `elapsedMs = (opts.now ?? Date.now()) - opts.spawnStartedAt`. Declare `const REVIEWER_HARD_LIMIT_MS = 8 * 60 * 1000` as a module-level constant near the top.
  - [ ] 5.3 If `elapsedMs > REVIEWER_HARD_LIMIT_MS`, enter the timeout-substitution branch per AC3 (3b). Compose the substitution body (verbatim text from (3b)); look up any prior verdict review via the existing footer-pattern lookup (the regex `[^:]+` already matches both `generalist-reviewer` and `reviewer-timeout` roles); POST or PATCH the substitution body; write the `agent.invoke` event per AC3 (3h) using the same `writeAgentInvokeEvent` helper from Task 2.3; return `{ next: "reviewer-timeout", postedReviewId, verdictLine, elapsedMs, chatLog? }`.
  - [ ] 5.4 Update the `PostReviewerCommentsResult` discriminated union per AC3 (3f).
  - [ ] 5.5 Update `post-reviewer-comments.test.ts` per AC5 (5e).

- [ ] **Task 6: Wire `spawnStartedAt` through SKILL.md prose** (AC: #1, #3, #5i)
  - [ ] 6.1 In `plugins/crew/skills/start/SKILL.md`, locate the dev-spawn block (step 3 of the inner cycle "Dev spawn"). Before the `invoke the Task tool with the devPrompt` line, add: `2a. capture devSpawnStartedAt = Date.now() (millisecond epoch) BEFORE invoking the Task tool; pass devSpawnStartedAt as a parameter to processDevTranscript in step 5.`
  - [ ] 6.2 Update step 5's `pass the captured devTranscript to processDevTranscript(...)` line to include `spawnStartedAt: devSpawnStartedAt` in the args object.
  - [ ] 6.3 In the "Reviewer spawn" block, locate step 8 (`invoke the Task tool with the reviewerPrompt`). Add: `7a. capture reviewerSpawnStartedAt = Date.now() BEFORE invoking the Task tool; pass reviewerSpawnStartedAt to BOTH postReviewerComments (step 9a) and processReviewerTranscript (step 10) as the spawnStartedAt parameter.`
  - [ ] 6.4 Update steps 9a and 10's calls to include `spawnStartedAt: reviewerSpawnStartedAt`.
  - [ ] 6.5 Add a new sub-branch to step 9a's switch: `- 'reviewer-timeout' → log 'reviewer timeout — 8-minute hard limit exceeded (elapsedMs: <ms>); applying needs-human label and halting inner cycle for operator inspection'; call applyReviewerLabels({ ..., verdictOverride: 'reviewer-failure' }); call markReviewerTimeout({ targetRepoRoot, sessionUlid, ref, manifestPath }) wrapped in try/catch (log secondary failure but do not halt); SKIP step 10 (processReviewerTranscript); return to outer loop step 4 (do not loop back to dev spawn).` Pin the verbatim chat-surface line in a Failure modes entry.
  - [ ] 6.6 Add a Failure modes entry: `reviewer-timeout / blocked_by: reviewer-timeout`: The reviewer subagent exceeded the 8-minute hard limit (NFR2). The verdict comment was substituted with a failure comment; needs-human label applied; manifest stamped blocked_by: reviewer-timeout. Story is NOT marked failed — manifest stays in in-progress/. Recovery: operator inspects the dev branch, decides whether to re-spawn a reviewer (clear blocked_by, re-run /crew:start) or close the story manually.`
  - [ ] 6.7 If a SKILL.md prose smoke test exists, add coverage per AC5 (5i); otherwise document the gap in Completion Notes.

- [ ] **Task 7: Add `claimed_at` to `ExecutionManifestSchema` and `claimStory`** (AC: #4, #5f, #5h)
  - [ ] 7.1 In `plugins/crew/mcp-server/src/schemas/execution-manifest.ts`, add an optional `claimed_at` field per AC4 (4a) directly after the `claimed_by` field declaration. Update the field's JSDoc to reference this story key and FR/NFR.
  - [ ] 7.2 In `plugins/crew/mcp-server/src/tools/claim-story.ts`, on the to-do → in-progress transition: add `claimed_at: opts.now().toISOString()` to the manifest object before stringify. Add a `now?: () => Date` test seam to options (mirror existing seams).
  - [ ] 7.3 If `claimNextStory` calls `claimStory` internally, no extra change is needed; the field flows through.
  - [ ] 7.4 Update `claim-story.test.ts` (or `claim-next-story.test.ts` — whichever covers the in-progress write) per AC5 (5f) first bullet.
  - [ ] 7.5 Update `execution-manifest.test.ts` per AC5 (5h).

- [ ] **Task 8: Add `findStuckDevClaims` helper** (AC: #4, #5f)
  - [ ] 8.1 Create `plugins/crew/mcp-server/src/lib/find-stuck-dev-claims.ts` per AC4 (4c)–(4f).
  - [ ] 8.2 Mirror `lib/team-stats.ts`'s ENOENT handling pattern for `fs.readdir`.
  - [ ] 8.3 Use `parseExecutionManifest` (the canonical reader from `schemas/execution-manifest.ts`) — do NOT call `ExecutionManifestSchema.parse` directly.
  - [ ] 8.4 Sort the result by `ref` lexicographically before returning (deterministic for test fixtures).
  - [ ] 8.5 Create `plugins/crew/mcp-server/src/lib/__tests__/find-stuck-dev-claims.test.ts` per AC5 (5f).

- [ ] **Task 9: Add the `getStuckDevClaims` MCP tool wrapper** (AC: #4, #5f)
  - [ ] 9.1 Create `plugins/crew/mcp-server/src/tools/get-stuck-dev-claims.ts` per AC4 (4e). Thin delegate to `findStuckDevClaims`. Returns JSON-stringified array as `text` content per MCP convention.
  - [ ] 9.2 Register in `plugins/crew/mcp-server/src/tools/register.ts` after the most-recently-registered tool. Input schema per AC4 (4e). Description string: `"Return the list of in-progress dev claims that have exceeded the per-story budget (default 30 min, NFR3)."`.
  - [ ] 9.3 Create `plugins/crew/mcp-server/src/tools/__tests__/get-stuck-dev-claims.test.ts` per AC5 (5f) third bullet group.

- [ ] **Task 10: Add the `markReviewerTimeout` MCP tool** (AC: #3)
  - [ ] 10.1 Create `plugins/crew/mcp-server/src/tools/mark-reviewer-timeout.ts`. Signature: `(opts: { targetRepoRoot: string; sessionUlid: string; ref: string; manifestPath: string }) => Promise<{ next: "stamped" | "manifest-missing"; chatLog?: string[] }>`.
  - [ ] 10.2 Reuse the atomic-rewrite helper that `processReviewerTranscript` uses for stamping `blocked_by: "reviewer-verdict-blocked"`. Stamp `blocked_by: "reviewer-timeout"` on the in-progress manifest. If the manifest is missing, return `{ next: "manifest-missing" }` (silent skip — the SKILL.md prose treats it as best-effort).
  - [ ] 10.3 The `blocked_by` union in `execution-manifest.ts` already accepts a string fallback (line ~135); `"reviewer-timeout"` does NOT need to be added as a literal but MAY be added for documentation. Choose: add as a literal alongside `"reviewer-grammar"` for parity with existing block reasons.
  - [ ] 10.4 Register in `register.ts`. Input schema: standard. Output: standard text content with JSON-stringified return.
  - [ ] 10.5 Tests: a happy-path stamp test, a manifest-missing test, an idempotency test (re-stamping a manifest that already has `blocked_by: "reviewer-timeout"` is a no-op).

- [ ] **Task 11: Tool-count assertion bump** (AC: all)
  - [ ] 11.1 Search the test suite for hardcoded tool counts: `grep -rn "registerTool" plugins/crew/mcp-server/src/__tests__ plugins/crew/mcp-server/src/tools/__tests__ plugins/crew/mcp-server/tests`. Bump by +2 for `getStuckDevClaims` and `markReviewerTimeout`.
  - [ ] 11.2 If `acceptance.test.ts` asserts a tool count, update with a JSDoc-style comment citing this story key.

- [ ] **Task 12: Build, vitest, dist** (AC: all)
  - [ ] 12.1 `pnpm build` from `plugins/crew/mcp-server/` passes — TypeScript surfaces no errors from the widened options, new helpers, or new tools.
  - [ ] 12.2 All vitest tests pass — `pnpm vitest --run` from `plugins/crew/mcp-server/`.
  - [ ] 12.3 Confirm `canonical-fs-guard.test.ts` still passes — the new code paths write only to `.crew/telemetry/*.jsonl` (via the existing logger, which is already whitelisted) and to `.crew/state/in-progress/*.yaml` (already a write path for `claimStory` / `processReviewerTranscript`). No new write surfaces are added.
  - [ ] 12.4 Confirm `team-stats.test.ts` and `compute-agreement.test.ts` (from Story 4.10) continue to pass — the new event emissions are additive and both readers tolerate unknown-to-them event types.
  - [ ] 12.5 Commit `dist/` per CLAUDE.md. The rebuild picks up the new `lib/`, `tools/`, modified `schemas/`, and modified `register.ts`.

---

## Implementation strategy

### Why the writes happen in process-tool layers, not in SKILL.md prose or in the subagent itself

The locked feedback from `[[feedback_prose_mut_steps_need_seam]]` and `[[feedback_default_to_deterministic_seams]]` is that prose-level mutating steps are unreliable under load: Claude skips MUST-call-X instructions when the conversation gets long. The fix is to move side-effects into the tool-layer return paths. Telemetry emission is exactly such a side-effect: it MUST happen on every spawn, regardless of how dense the prose around it is.

Two write-site options were considered:
1. **Inside `runReviewerSession` / a new `runDevSession` tool** — the subagent's own context. REJECTED because (a) `runReviewerSession` runs inside the reviewer subagent's process which does not have a writable `.crew/` path resolution boundary the same way the parent does; (b) the reviewer's wall-clock cannot be measured from inside the reviewer (the spawn boundary is external).
2. **Inside `processDevTranscript` / `processReviewerTranscript` / `postReviewerComments`** — the parent dev session's tools, called immediately after each Task returns. CHOSEN because the parent has the spawn-start timestamp and the `.crew/` resolution; the SKILL.md prose passes `spawnStartedAt` as a parameter (a single primitive value), which is much harder for prose to "forget" than a multi-step MUST-call-X instruction.

The SKILL.md prose change is intentionally minimal: capture `Date.now()` in a local variable, pass it through. The tool layer does the rest.

### Why the 8-min check lives in `postReviewerComments`, not in SKILL.md prose

Same load-bearing-seam logic as above. The natural-language alternative would be SKILL.md step 8.5: "If now - reviewerSpawnStartedAt > 8 min, skip postReviewerComments, post a substitute comment, apply needs-human, skip processReviewerTranscript." Under load this is exactly the kind of multi-step branching that gets condensed or skipped. Folding it inside `postReviewerComments` means the prose's invariant is reduced to "always call postReviewerComments with spawnStartedAt" — the tool layer decides whether the elapsed time crosses the threshold.

The `reviewer-timeout` return branch is then surfaced as a new switch case in SKILL.md, which IS prose-driven — but a switch case on a known discriminated-union value is a much shorter prose obligation than a conditional-then-substitute flow.

### Why telemetry-write failures are swallowed (and not propagated)

The `agent.invoke` and `reviewer.verdict` events are observability infrastructure. Their failure to land does not invalidate the dev cycle's outcome (the PR was reviewed; the verdict was posted; the manifest was moved). Propagating a telemetry-write failure would surface a disk-full or permission error as a story-failure — wrong category, wrong recovery path. The swallow pattern mirrors `team-stats.ts`'s per-line malformed tolerance: read what you can, count what you couldn't, never throw on a single bad write.

The chat-surface log line ensures the failure is VISIBLE (the operator sees it) without being FATAL.

### Why `claimed_at` lives on the manifest, not in a separate telemetry-only file

Three reasons:
1. **Atomicity with claim.** The `claimed_by` stamp is already an atomic-rewrite of the manifest on the to-do → in-progress transition. Adding `claimed_at` to the same rewrite ensures the two fields are either both written or both absent — no half-state.
2. **No extra read path.** `findStuckDevClaims` already needs to read in-progress manifests (to enumerate them); reading the `claimed_at` field is free.
3. **Telemetry is event-shaped, not state-shaped.** The agreement metric and stats helpers process append-only event streams; the in-progress manifest IS the canonical state for "what's claimed right now". Stuck-claim detection is state-shaped (it asks "which CURRENT claims are too old"), not event-shaped.

### Why the `findStuckDevClaims` helper takes `budgetMs` as a parameter, not a config field

Defer the config decision to Story 5.4 (the poll). The helper is reusable across budgets (per-role, per-tier in a future story); a hard-coded read of `.crew/config.yaml` inside the helper would tightly couple it to the config schema. Passing as a parameter keeps the helper pure-ish and trivially testable.

### Why `markReviewerTimeout` is a separate tool, not folded into `applyReviewerLabels`

`applyReviewerLabels` is GitHub-side (posts a label via `gh api`). `markReviewerTimeout` is local-state-side (stamps `blocked_by` on the in-progress manifest). They are independent concerns with independent failure modes: a label-post can fail (network, rate-limit) without the manifest stamp also failing. Folding them would create a partial-success failure mode that's hard to reason about.

### Why the substitution body is a literal template, not composed via `composeSummaryBody`

`composeSummaryBody` (Story 4.6b) reads ACs from the reviewer result, composes per-AC outcome lines, etc. — none of which is meaningful on a timeout (the reviewer never ran the ACs). The timeout body is a fixed announcement plus the version footer. Hard-coding the template inside `post-reviewer-comments.ts` is simpler than parameterising the composer to handle an empty-result branch.

### Schema dependency notes (Story 4.10 ordering)

Story 4.10 is `ready-for-dev` at the time this story is authored. If 4-10 has not been merged when 4-12 enters dev, the dev agent MUST stop at Task 1 and surface the dependency. Re-authoring `ReviewerVerdictEventSchema` inside 4-12 would create a merge conflict and violate the locked-file boundary for `schemas/telemetry-events.ts` (this story does NOT modify the schema file).

If 4-10 is in a feature branch but not merged, the dev agent may rebase 4-12's branch on 4-10's branch (operator decision, surface the option).

---

## Locked files

These files are off-limits to this story. If a change appears necessary, STOP and surface the conflict — do not silently edit.

- `plugins/crew/mcp-server/src/lib/logger.ts` (Story 1.5) — the canonical telemetry writer. This story CALLS it; it does NOT modify it.
- `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` (Story 1.5 / extended by Story 4.10) — the event schemas. This story CONSUMES them; it does NOT modify them. The `ReviewerVerdictEventSchema` lands in 4-10; verify presence per Task 1.
- `plugins/crew/mcp-server/src/lib/team-stats.ts` (Story 2.6) — the first reader. Untouched.
- `plugins/crew/mcp-server/src/lib/compute-agreement.ts` (Story 4.10) — the second reader. Untouched. (May not exist yet if 4-10 has not merged — in which case it is locked-future.)
- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1) — the canonical "story is done" surface. The timeout branch explicitly does NOT call it.
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Story 4.6) — only change is REMOVAL of the `TODO(4.12)` comment at line 29, replaced with the JSDoc note in Task 3.3. The function body is unchanged.
- `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts` (Story 4.6b) — the verdict-body composer. The timeout substitution uses a literal template, NOT the composer.
- `plugins/crew/mcp-server/src/tools/read-backlog-inventory.ts`, `scan-sources.ts`, `validate-planner-backlog.ts` — Epic 3 surfaces; untouched.
- `plugins/crew/permissions/generalist-dev.yaml`, `plugins/crew/permissions/generalist-reviewer.yaml` — no new tool added to either persona; the new tools (`getStuckDevClaims`, `markReviewerTimeout`) are called by SKILL.md prose / future Story 5.4 poll, not by personas.

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/tools/process-dev-transcript.ts`** (Story 4.3b / 4.5 / 4.6 / 4.8b) — Task 2 extends options with `spawnStartedAt` and `now`; adds a single helper call near the top of the function body. No existing branching logic is changed.
- **`plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts`** (Story 4.3b / 4.3c / 4.6) — Task 3 mirrors the Task 2 extension. No existing branching logic is changed.
- **`plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`** (Stories 4.6b / 4.7) — Tasks 4 + 5 add `spawnStartedAt` / `now` options, the 8-min timeout branch, the `reviewer.verdict` emission, and the new `reviewer-timeout` discriminated-union variant. The existing POST/PATCH path is unchanged in shape; the timeout check sits BEFORE it as a pre-check.
- **`plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts`** (Stories 4.7 / 4.8) — Task 4.4 only REMOVES the `TODO(4.12)` comment. No code change.
- **`plugins/crew/mcp-server/src/tools/claim-story.ts`** (Story 4.1) — Task 7 adds `claimed_at` stamping. Single line addition to the manifest-write block; no other change.
- **`plugins/crew/mcp-server/src/schemas/execution-manifest.ts`** (Story 4.1 et al.) — Task 7 adds the optional `claimed_at` field. Strict-mode invariant preserved; existing manifests parse unchanged because the field is optional.
- **`plugins/crew/mcp-server/src/tools/register.ts`** (touched by most Epic-1 through Epic-4 stories) — Tasks 9 + 10 append two new tool registrations.
- **`plugins/crew/skills/start/SKILL.md`** (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7 / 4.8) — Task 6 adds spawn-timestamp capture, threads `spawnStartedAt` through three tool calls, adds the `reviewer-timeout` switch branch, and adds a Failure modes entry. The existing inner-cycle structure is preserved.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/lib/agent-invoke-writer.ts` (Task 2.3)
- `plugins/crew/mcp-server/src/lib/reviewer-verdict-writer.ts` (Task 4.3)
- `plugins/crew/mcp-server/src/lib/find-stuck-dev-claims.ts` (Task 8.1)
- `plugins/crew/mcp-server/src/lib/__tests__/find-stuck-dev-claims.test.ts` (Task 8.5)
- `plugins/crew/mcp-server/src/tools/get-stuck-dev-claims.ts` (Task 9.1)
- `plugins/crew/mcp-server/src/tools/__tests__/get-stuck-dev-claims.test.ts` (Task 9.3)
- `plugins/crew/mcp-server/src/tools/mark-reviewer-timeout.ts` (Task 10.1)
- `plugins/crew/mcp-server/src/tools/__tests__/mark-reviewer-timeout.test.ts` (Task 10.5)
- Optional: `plugins/crew/mcp-server/src/__fixtures__/telemetry.ts` (Task 5b — shared test fixtures) if more than one test file needs them.

### Files this story will modify

- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Task 2)
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Task 3)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Tasks 4, 5)
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Task 3.3 — comment-only)
- `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts` (Task 4.4 — comment-only)
- `plugins/crew/mcp-server/src/tools/claim-story.ts` (Task 7.2)
- `plugins/crew/mcp-server/src/schemas/execution-manifest.ts` (Task 7.1)
- `plugins/crew/mcp-server/src/tools/register.ts` (Tasks 9.2, 10.4)
- `plugins/crew/skills/start/SKILL.md` (Task 6)
- `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts` (Task 2.4)
- `plugins/crew/mcp-server/src/tools/__tests__/process-reviewer-transcript.test.ts` (Task 3.4)
- `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` (Tasks 4.5, 5.5)
- `plugins/crew/mcp-server/src/tools/__tests__/claim-story.test.ts` or `claim-next-story.test.ts` (Task 7.4)
- `plugins/crew/mcp-server/src/schemas/__tests__/execution-manifest.test.ts` (Task 7.5)
- Any test file holding a hardcoded MCP tool count (Task 11.1)
- `plugins/crew/mcp-server/dist/` (Task 12.5; rebuild and commit)

### Current-state notes on files being modified

- **`process-dev-transcript.ts`** (current state per Story 4.3b/4.5/4.6/4.8b): exports `processDevTranscript({ targetRepoRoot, sessionUlid, ref, devTranscript })` returning a discriminated union over the five `next:` values. The function reads `dev-outcome.json` (Story 4.8b), parses the handoff phrase, and returns the next-action discriminant. Task 2 adds `spawnStartedAt` and `now` to the options and one helper call near the top.
- **`process-reviewer-transcript.ts`** (current state per Story 4.3b/4.3c/4.6): exports `processReviewerTranscript({ targetRepoRoot, sessionUlid, ref, manifestPath })` returning a discriminated union over the four `next:` values. Calls `readReviewerResultFile` first; on null, returns the blocked-no-session-result branch. Task 3 adds spawn-timing options and one helper call near the top.
- **`post-reviewer-comments.ts`** (current state per Story 4.6b/4.7): exports `postReviewerComments({ targetRepoRoot, sessionUlid, role?, pluginVersionOverride?, ... })` returning either `{ next: "skipped-no-session-result" }` or `{ next: "posted", postedReviewId, ... }`. Reads `reviewer-result.json`, fetches PR diff, fetches PR view, GETs existing reviews to find a prior verdict footer, POSTs (or PATCHes) the verdict review. Tasks 4+5 add spawn-timing options, the timeout pre-check, the `reviewer-timeout` return variant, and `reviewer.verdict` emission on the POST/PATCH success paths.
- **`apply-reviewer-labels.ts`** (current state per Stories 4.7/4.8): already supports `verdictOverride: "reviewer-failure"` which applies `needs-human`. The timeout branch reuses this override; no behavioural change needed in this file.
- **`claim-story.ts`** (current state per Story 4.1): writes the in-progress manifest with `claimed_by: sessionUlid` and `status: "in-progress"` on the atomic move. Task 7 adds one field (`claimed_at`) and one option seam (`now?: () => Date`).
- **`execution-manifest.ts`** (current state per Story 4.1 / 3.5): defines `ExecutionManifestSchema` strict-mode with the existing fields. Task 7 adds one optional nullable field.
- **`SKILL.md`** (current state per Stories 4.2 through 4.8): the inner-cycle is documented in numbered steps. Task 6 adds spawn-time-capture lines, threads a parameter through three call sites, adds a new switch branch, and adds a Failure modes entry.

### Testing standards

- vitest with `pnpm vitest --run` from `plugins/crew/mcp-server/`.
- `os.tmpdir() + crypto.randomUUID()` for tmpdir fixtures; `fs.rm(..., { recursive: true })` in `afterEach`.
- No global mocks. Time mocking is via the explicit `now?: () => number` / `now?: () => Date` seams added to each function (no `vi.useFakeTimers()`).
- Telemetry-reading assertions use a small `readTelemetry(targetRepoRoot)` helper that lists `.crew/telemetry/*.jsonl`, splits on newlines, and JSON.parses each line; assert on the resulting object array.
- Per-event fixtures use `verdictEvent(opts)` and `agentInvokeEvent(opts)` factories (mirroring Story 4.10's pattern).
- Schema tests for `claimed_at` use `safeParse` with `expect(result.success).toBe(false)` for failure cases; assert on `result.error.issues[0].path` when path matters.
- The 8-minute boundary test pair (`elapsedMs === 480_000` → normal path; `elapsedMs === 480_001` → timeout path) is a strict-greater-than pin test — it MUST be added with explicit JSDoc citing AC4 (4h).

### Dependencies

- Story 1.5 (`logger.ts` writer; `AgentInvokeEventSchema` + `TelemetryInvalidEventSchema` schemas) — CALLED by this story's new writer helpers.
- Story 4.10 (`ReviewerVerdictEventSchema` schema widening; `computeAgreement` reader) — schema CONSUMED by this story's `writeReviewerVerdictEvent`. **HARD DEPENDENCY** — see § Schema dependency notes.
- Story 4.6 / 4.6b / 4.7 (`runReviewerSession`, `postReviewerComments`, `composeSummaryBody`, version-stamping) — call-site context for Tasks 4–5.
- Story 4.8 (`applyReviewerLabels` with `verdictOverride: "reviewer-failure"`) — reused verbatim on the timeout branch.
- Story 4.1 (`claimStory`, `completeStory`, ExecutionManifestSchema additions) — extended by Task 7.
- Story 4.3b / 4.3c (`processDevTranscript`, `processReviewerTranscript`, chatLog pattern) — extended by Tasks 2–3.
- Architecture § Telemetry & Observability (`core-architectural-decisions.md` lines ~64–71) — pins the substrate this story populates.
- Architecture § Runtime Budgets (`core-architectural-decisions.md` lines ~92–110, if present, otherwise NFR section) — pins the 8-min / 30-min commitments.
- FR65, FR66 (`prd-crew-v1/functional-requirements.md`) — the per-invocation telemetry requirements.
- NFR2, NFR3 (`prd-crew-v1/non-functional-requirements.md`) — the runtime-budget requirements.

### Downstream callers (not implemented by this story)

- Story 4.10's `computeAgreement` already consumes `reviewer.verdict` events; once this story ships the writer, the helper starts returning non-null metrics on repos with ≥50 resolved verdicts. The `eventual_merge_action` backfill is still deferred — see § Deferred work.
- Story 5.3's watch skill / orchestration polling loop will call `getStuckDevClaims` (or its lib counterpart) at each poll interval to surface stuck stories.
- Story 5.4's stuck-story and stale-claim detection will consume both `getStuckDevClaims` AND a heartbeat mechanism (independent of this story) to distinguish "claim is old but dev is alive" from "claim is old and dev is silent". This story ships the time-based half only.
- Future Epic 6 outcome-stats helper (`computeOutcomeStats`) will consume `agent.invoke` events for runtime aggregation by role.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.12`]
- [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`] (§ Telemetry & Observability)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] (FR65, FR66)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/non-functional-requirements.md`] (NFR2, NFR3)
- [Source: `plugins/crew/mcp-server/src/lib/logger.ts`] (the writer this story calls)
- [Source: `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`] (schemas this story consumes — `ReviewerVerdictEventSchema` lands in Story 4.10)
- [Source: `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`] (TODO(4.12) at line 26)
- [Source: `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`] (TODO(4.12) at line 29 — removed by this story)
- [Source: `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts`] (TODO(4.12) at line 23 — removed by this story; `verdictOverride: "reviewer-failure"` reused)
- [Source: `plugins/crew/mcp-server/src/tools/claim-story.ts`] (extended with `claimed_at` stamp)
- [Source: `plugins/crew/mcp-server/src/schemas/execution-manifest.ts`] (extended with `claimed_at` field)
- [Source: `plugins/crew/skills/start/SKILL.md`] (line 121 mentions "Story 4.12's 30-min dev budget acts as the implicit cap")
- [Source: `plugins/crew/docs/user-surface-acs.md`] (substrate-vs-user-surface judgement)
- [Source: `_bmad-output/implementation-artifacts/4-10-agreement-metric-helper-compute-agreement.md`] (template for stats-helper-style implementation, plus the upstream schema)

---

## Previous story intelligence

### From Story 4.10 (recently authored — direct schema dependency)

- 4.10 ships `ReviewerVerdictEventSchema` as an additive widening of `TelemetryEventSchema`. The schema's `data.eventual_merge_action` is `.nullable()`; this story's writer always sets it to `null` (resolved later by a deferred backfill loop). The schema's `verdict` enum uses the spaced literals `"READY FOR MERGE"`, `"NEEDS CHANGES"`, `"BLOCKED"` — this story's writer copies them verbatim from `resultFile.recommendedVerdict`.
- 4.10's `computeAgreement` excludes events with `eventual_merge_action: null` from its window. Until the backfill loop ships, every event written by this story is excluded — so `computeAgreement` returns `null` (insufficient data) on all deployments. This is by design; the metric becomes meaningful once the backfill loop lands.

### From Story 4.6b / 4.7 (shipped — verdict-line and version-stamp conventions)

- The verdict-line grammar in posted comments uses literal `READY FOR MERGE` / `NEEDS CHANGES` / `BLOCKED` phrases. The footer marker is `<!-- crew:verdict:{role}:{ref} -->`. This story's timeout-substitution uses the same footer pattern with role-slot `reviewer-timeout`; the PATCH-lookup regex (`[^:]+`) already matches both role variants.
- The version stamp `` `standards_version: ...` · `plugin_version: ...` `` is the canonical format; this story's substitution body uses the same format verbatim.

### From Story 4.8 (shipped — label override pattern)

- `applyReviewerLabels` accepts `verdictOverride: "reviewer-failure"` which applies `needs-human`. This story's timeout branch reuses the override verbatim — no new override literal is needed.

### From Story 4.1 / 4.3 (shipped — manifest write patterns)

- The atomic-rewrite pattern for in-progress manifests is well-established. `processReviewerTranscript` already stamps `blocked_by` for `reviewer-verdict-needs-changes` and `reviewer-verdict-blocked`; the new `markReviewerTimeout` tool reuses the same helper for `blocked_by: "reviewer-timeout"`.
- The `claimed_by: sessionUlid` stamp on the to-do → in-progress transition is the precedent for adding `claimed_at` alongside it.

### From Story 1.5 (shipped — logger contract)

- `logTelemetryEvent` validates the event against `TelemetryEventSchema` and throws `TelemetryEventInvalidError` on failure (plus writes a `telemetry.invalid` record). This story's writers construct events that pass the schema by construction; the try/catch swallows other errors (disk-full, permission) per AC1 (1e).

### From Story 2.6 (shipped — reader pattern)

- `team-stats.ts` ignores event types it doesn't aggregate (it explicitly opts in to `type === "agent.invoke"`). Once this story's writes start landing, `team-stats.ts`'s `fireCountsByAgent` map will start populating from the new `agent.invoke` events. No change to `team-stats.ts` is needed.

### From the locked-feedback memory entries

- [[feedback_prose_mut_steps_need_seam]] — `Claude skips MUST-call-X prose under load; move side-effects into tool-layer return paths.` Drove the choice to write telemetry inside `processDevTranscript` / `processReviewerTranscript` / `postReviewerComments` rather than from SKILL.md prose. The SKILL.md change is reduced to capturing one primitive (`Date.now()`) and passing it as a parameter.
- [[feedback_default_to_deterministic_seams]] — `Load-bearing decisions live in tool-written artefacts, not LLM prose.` Drove the choice to put the 8-min timeout check inside `postReviewerComments` (the tool decides) rather than as a SKILL.md conditional (the prose decides). The new `reviewer-timeout` discriminated-union return value is the deterministic seam.

### Git intelligence (recent commits)

```
0b07f7d spec(4-10): author spec for agreement-metric helper + sprint-status tidy (#130)
940f4db feat(3): BMad adapter leniency for real-world BMad backlogs (#129)
9b7bbe0 spec(4-9b): author spec for risk-tier classifier, evidence stamping, and fallback (#123)
7e91670 spec(3-8): author spec for BMad adapter real-world leniency (#127)
2d449dd backlog: Story 3.8 — BMad adapter leniency for real-world backlogs (#126)
```

Pattern: Epic 4 spec commits follow `spec(4-X): <subject>`. Implementation commits follow `feat(4.X): <subject>`. This story's spec commit will be `spec(4-12): author spec for per-invocation telemetry and runtime soft/hard limits`. The implementation commit (when the dev agent lands) follows the `feat(4.12)` pattern.

---

## Retro Amendments — 2026-05-25

Added during the mid-epic-4 retrospective ([epic-4-retro-2026-05-25.md](epic-4-retro-2026-05-25.md), carry-forwards #2 and #8). AC6 and AC7 live in `## Acceptance Criteria` above; the why-and-context lives here.

**Why AC6 exists (session-quota-exhausted typed failure):** PR #138 was bricked by exactly this failure mode. The subagent output said *"You've hit your session limit"* verbatim, fell through as handoff-grammar drift, and Jack had to manually recover. On a clean install with no Jack-acting-as-operator, this would silently kill the "walk away" promise. Typed class makes the failure observable and recoverable.

**Operator-recovery doc (AC6):** add a one-page note under `plugins/crew/docs/troubleshooting/session-quota.md` describing what the operator sees, why, and how to resume (re-run `/crew:start` after the quota resets — the blocked manifest auto-promotes).

**Why AC7 exists (green-at-commit pre-handoff gate):** PR #138's dev hit quota mid-cleanup and left the suite red across 5 files; the locked-phrase had already been emitted so the run advanced as if green. The architecture lesson — "if it lives in prose, move it to a tool" — applies: the suite-green claim was implicit in prose; making it an explicit tool-side gate closes the gap.

**Schema impact:** two new error classes in `errors.ts` (`SessionQuotaExhaustedError`, `PreHandoffSuiteRedError`), additive to the `failure.class` enum. Telemetry events (this story's existing scope) record both as distinct classes for the dashboard's recoverable-vs-fatal split.

**Out of scope for this story:**
- Pre-quota heuristic / breadcrumb-on-`SIGTERM` (deferred — needs runtime-limits work this story already adds; revisit only if cheap inside the existing diff).
- Auto-retry of session-quota-exhausted runs (operator-driven — `/crew:start` re-invocation is the recovery surface).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
