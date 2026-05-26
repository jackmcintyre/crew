# Story 4.12: Per-invocation telemetry and runtime soft/hard limits

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin maintainer**,
I want **every agent invocation to write a typed `agent.invoke` telemetry event, every posted reviewer verdict to write a `reviewer.verdict` event (with a follow-up `reviewer.verdict.merge_action` event when the PR closes), the dev session to enforce an 8-minute reviewer hard cap that substitutes the verdict comment and applies `needs-human` without marking the story failed, and the dev session to emit a `dev.budget_exceeded` event when cumulative dev-subagent runtime on a story crosses the configurable 30-minute budget**,
so that **the agreement metric (Story 4.10), outcome stats (Epic 6), skill-effectiveness reports (Epic 6), and orchestration surfacing of stuck stories (Story 5.3 / 5.4) all have authoritative typed data instead of LLM-narrated chat that may have drifted**.

### What this story is, in one sentence

Add three new event types to the closed `TelemetryEventSchema` discriminated union (`reviewer.verdict`, `reviewer.verdict.merge_action`, `dev.budget_exceeded`), implement a new MCP tool `recordAgentInvoke` that emits `agent.invoke` AND atomically enforces the 8-minute reviewer hard cap (by composing the existing `postReviewerComments` + `applyReviewerLabels` tools and stamping `timed_out: true` on the verdict event) AND emits `dev.budget_exceeded` when cumulative dev runtime on a story crosses 30 minutes, add a sibling MCP tool `recordPrCloseAction` that writes the retroactive `reviewer.verdict.merge_action` event (caller — typically Story 5.3's polling loop — is out of scope here), wire the `reviewer.verdict` initial emission inside `postReviewerComments` on POST success, and ship a vitest suite covering the four AC branches plus the seven obvious edge cases.

### What this story does (and why it needs its own story)

PRD `FR65/FR66/NFR2/NFR3` pin the contract; architecture (`core-architectural-decisions.md` § "Telemetry & Observability") pinned the storage layout, schema discriminator shape, and discriminated-union closure rule. Story 1.5 shipped the substrate — `lib/logger.ts`'s `logTelemetryEvent` is the only write path, the discriminated union currently declares `agent.invoke` + `telemetry.invalid`, and the canonical-fs-guard test pins that write path. This story extends the closed union with three new event types and adds the two MCP tools that emit them.

The 8-min reviewer hard cap (AC3) is the second deliverable. Without it, a reviewer that hangs at 7m59s and returns at 12m00s would silently post a real verdict comment on a PR that the operator has long since stopped paying attention to. NFR2 says: substitute the verdict body with a failure body, apply `needs-human`, keep the story in `review` (not `failed`). That last clause is load-bearing — flipping to `failed` would orphan the manifest into `done-blocked` territory and lose the human-recovery path.

The 30-min dev budget (AC4) is the third deliverable. The event-emission seam ships here so Story 5.3's polling loop (and any future orchestration surface) can read JSONL and surface the story as stuck without re-running the timing logic. NFR3 says "surfaced by the orchestration session" — surfacing is 5.3's job; emission is this story's job. The dev session's cumulative wall-clock on a story is a sum-of-`agent.invoke`-events filtered by `agent === "generalist-dev"` and `story_id === <ref>`, computed lazily inside `recordAgentInvoke` each time a new dev invocation is recorded.

Three reasons this is one story not three:

1. **All three new event types share the same `.strict()`-discriminated-union extension pattern.** Extending the schema once with three sibling entries is cheaper than three serial extensions. The schema's `.strict()` discriminator forces every event-emission seam to import the same `TelemetryEventSchema` — so adding the events without adding the emitters would leave dead types.

2. **The 8-min cap, the 30-min budget, and the `agent.invoke` emission are all wired through the same dev-session-side MCP tool (`recordAgentInvoke`).** AC1 just emits; AC3 also substitutes-and-labels-and-stamps when `agent === "generalist-reviewer"` and `runtime_ms > 480_000`; AC4 also reads-and-emits when `agent === "generalist-dev"` and `cumulative_runtime_ms > 1_800_000`. Three behaviours, one entrypoint — the inverse pattern (three tools doing one thing each) would force the dev-session SKILL.md prose to remember which to call when, which is exactly the failure mode memory `feedback_prose_mut_steps_need_seam` warned us against.

3. **AC2's `reviewer.verdict` emission lives in `postReviewerComments` (not in `recordAgentInvoke`).** This is the only AC that does NOT route through `recordAgentInvoke`, because the verdict-post is a tool-layer event independent of subagent timing. Splitting `reviewer.verdict` into its own story would be a 200-line patch ("emit one telemetry event on POST success") — too small to be worth its own ship cycle.

This story explicitly does NOT introduce the orchestration polling loop that surfaces `dev.budget_exceeded` to the operator (Story 5.3 / 5.4 own that), the agreement-metric helper that consumes `reviewer.verdict.merge_action` events (Story 4.10 owns it), or any caller that invokes `recordPrCloseAction` (Story 5.3's polling loop will be the typical caller; until 5.3 ships, the tool exists but is uncalled).

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Implement the orchestration polling loop that surfaces `dev.budget_exceeded` as a stuck story to the operator. Story 5.3 (`/crew:watch` skill and polling loop) and Story 5.4 (stuck-story detection) own the surfacing. This story ships the event-emission seam only — the JSONL line that 5.3 reads.
- (c) Implement `compute-agreement` (Story 4.10). 4.10 reads `reviewer.verdict` + `reviewer.verdict.merge_action` events and computes the rolling agreement ratio. This story produces the events; 4.10 consumes them. No agreement-metric code, no rolling-window logic.
- (d) Implement the auto-merge gate (Story 4.10b). 4.10b reads `agreement_metric` (from 4.10) and `risk_tier` (from 4.9b) and decides whether to auto-merge. This story is consumer-agnostic.
- (e) Wire a caller for `recordPrCloseAction`. The PR-close event happens on GitHub, not inside the plugin. The natural caller is Story 5.3's polling loop (which can reconcile open PRs from `reviewer.verdict` events that lack a corresponding `reviewer.verdict.merge_action`). Until 5.3 ships, `recordPrCloseAction` is a registered MCP tool with no production caller — exercised only by vitest. This is intentional: the tool is the seam, the caller is downstream.
- (f) Add a JSONL→Parquet exporter, a stats dashboard, or any aggregation beyond what `recordAgentInvoke` computes for its own `dev.budget_exceeded` decision. Aggregation is Epic 6 (outcome stats, skill effectiveness).
- (g) Make the 8-min reviewer cap or the 30-min dev budget configurable from `.crew/config.yaml` in v1. Defaults are hardcoded constants in `lib/runtime-limits.ts` (new file). The architecture's "8 minutes" and "default 30 minutes" wording allows for future configurability, but config-loading + Zod schema + override-resolution is out of scope; a config knob can be added additively in a later story without changing this story's emission seam.
- (h) Persist any state outside `<targetRepoRoot>/.crew/telemetry/<YYYY-MM>.jsonl`. No in-memory cache of cumulative-runtime — `recordAgentInvoke` reads the current month's JSONL on each invocation to compute the dev-cumulative for AC4. The architecture's JSONL-as-truth model rules out a sidecar cumulative-tracker file. Performance: one read of the current month's JSONL per `agent.invoke` is bounded (one file, monthly rollover, typically <1MB).
- (i) Watch the JSONL file for changes. The aggregation-on-read pattern in `recordAgentInvoke` is invoked exactly when a new dev invocation is being recorded — no polling, no fsnotify, no rollover watcher.
- (j) Implement a token-budget enforcement. AC1 includes `tokens_in` / `tokens_out` as optional fields on `agent.invoke` (already declared by Story 1.5's schema), but there is no budget gate on tokens in v1. The dev session passes tokens through if it has them (it usually doesn't — Anthropic's response shape doesn't surface them to the subagent caller) but no decision logic gates on tokens.
- (k) Substitute the verdict comment for any reason OTHER than the 8-min hard cap. If the reviewer subagent itself returns a "block" verdict, normal `postReviewerComments` / `applyReviewerLabels` flow applies — the substitution is *only* invoked when `recordAgentInvoke` detects `agent: generalist-reviewer` AND `runtime_ms > 480_000`. Other failure modes (reviewer crash mid-flight; reviewer returns malformed JSON) are not in scope for this story; existing typed-error handling continues to apply.
- (l) Change the locked verdict-comment idempotency marker (Story 4.7's `<!-- crew:verdict:<plugin-version>:<story-id> -->`). The substituted failure comment uses the SAME marker so rerun behaviour is preserved — a subsequent successful reviewer run finds the substituted comment by grep, edits in place, and the operator sees the recovery cleanly.
- (m) Modify Story 4.8's `applyReviewerLabels` tool. The tool already accepts `verdictOverride: "reviewer-failure"` (line 77-78 of `apply-reviewer-labels.ts`) which routes through the same `["reviewed-by-agent", "needs-human"]` label set. This story calls it with that override and is otherwise unconcerned with how labels are applied.
- (n) Modify the closed verdict literal set. The verdict event's `verdict` field uses the existing `"READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED"` triple (from `run-reviewer-session.ts`'s `RecommendedVerdict` type) AND adds the `"reviewer-failure"` literal that `applyReviewerLabels` already supports. No new verdict states; no semantic change to the existing three.
- (o) Add `pino`'s SonicBoom destination, batching, or any throughput-optimised write path. `logTelemetryEvent`'s `fs.appendFile` synchronous-on-flush model (Story 1.5 design comment in `lib/logger.ts:9-25`) is unchanged. This story may emit two-to-three events per story execution at peak — throughput is not the bottleneck.
- (p) Reach into a planning adapter, the catalogue, role permissions, or any persona/standards file. Telemetry events are write-only side effects on `.crew/telemetry/`; no reads of role/persona/standards state.
- (q) Touch `run-dev-terminal-action.ts` (Story 4.4) or `process-dev-transcript.ts` (Story 4.3b/4.5). The dev session's terminal-action and transcript-processing seams already exist; `agent.invoke` for the dev subagent is recorded by the dev session SKILL.md (caller of `recordAgentInvoke`), not by these tools. Specifically, no `agent.invoke` is emitted from `run-dev-terminal-action.ts` — that tool runs *inside* the dev subagent and recording its own runtime would double-count.

### Deferred work

- **Configurable budgets in `.crew/config.yaml`.** The 8-min reviewer cap and the 30-min dev budget are hardcoded constants in v1. A later story can add an additive `plugin.runtime_limits` block with override resolution (mirror the `agreement_threshold` pattern from Story 4.10b).
- **`recordPrCloseAction` caller.** The MCP tool ships here; the polling loop that calls it is Story 5.3's responsibility. Manual invocation works in the interim.
- **Telemetry-aggregation MCP tool or CLI.** Architecture's "Stats helpers" line (`core-architectural-decisions.md:71`) declares these as future tools — Epic 6 owns the surfacing (outcome stats, skill-effectiveness reports). This story stays in the emission lane.
- **Token-budget enforcement.** Fields exist on the schema; no enforcement gate in v1. Adding one requires upstream support from the Task-tool layer that surfaces tokens to subagent callers, which Anthropic doesn't expose today.

---

## Acceptance Criteria

> AC1–AC4 are verbatim from the epic (with minor wording reflowed for the unpacked sections below). AC5 is the integration suite. None reference a slash command, operator-typed CLI, install-doc path, or Claude Code UI element — they describe internal telemetry events, an MCP tool, and a verdict-substitution branch. Per `plugins/crew/docs/user-surface-acs.md`, this story is **substrate**; no `(user-surface)` tags apply.

**AC1:**
**Given** any agent subagent spawn,
**When** the subagent runs,
**Then** the dev session writes an `agent.invoke` event (agent type, story id, wall-clock runtime, timestamp). _(FR65)_

<!-- Not user-surface: AC1 describes the dev session's call to a new MCP tool that writes to `.crew/telemetry/<YYYY-MM>.jsonl`. The operator does not see, type, or click any surface in this AC; the JSONL file is internal observability data. -->

**AC2:**
**Given** any reviewer summary comment,
**When** posted,
**Then** a `reviewer.verdict` event is written carrying PR number, verdict sentinel, standards version, plugin version, and the eventual merge action (filled in retrospectively when the PR closes). _(FR66)_

<!-- Not user-surface: AC2 describes a side-effect of `postReviewerComments` writing an additional JSONL line. No operator surface. -->

**AC3:**
**Given** a reviewer exceeding 8 min wall-clock,
**When** the dev session inspects,
**Then** it substitutes the verdict comment with a failure comment, applies `needs-human`, and does not mark the story failed. _(NFR2)_

<!-- Not user-surface: AC3 is dev-session control flow. The operator sees the eventual PR comment + label, but those are downstream surfaces owned by Stories 4.6b (comments) and 4.8 (labels) — this AC describes the *substitution* trigger, not the operator surface. -->

**AC4:**
**Given** a dev subagent exceeding its per-story budget (default 30 min),
**When** the orchestration session next polls,
**Then** it surfaces the story as stuck. _(NFR3, see also Story 5.4)_

<!-- Not user-surface: AC4's deliverable in *this* story is the emission of `dev.budget_exceeded` JSONL events; the polling/surfacing is Story 5.3/5.4's responsibility. See § "What this story does NOT (b)". -->

**AC5 (integration):**
vitest covers (a) `agent.invoke` written on every spawn, (b) `reviewer.verdict` written on every verdict comment, (c) hard-8-min substitution, (d) 30-min dev budget surfaces in the next poll.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

### Expanded acceptance specifics (folded into AC1–AC5 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** `recordAgentInvoke` MCP tool, `agent.invoke` emission semantics:

- (1a) **New MCP tool: `recordAgentInvoke`.** Signature: `recordAgentInvoke(opts: { sessionUlid: string; agent: string; storyId?: string; startedAt: string; completedAt: string; tokensIn?: number; tokensOut?: number; targetRepoRoot?: string }): Promise<RecordAgentInvokeResult>`. The dev session SKILL.md calls this once after every Task-tool subagent spawn completes. `startedAt` / `completedAt` are ISO-8601 UTC timestamps captured by the dev session before/after the spawn. `runtime_ms` is computed as `Date.parse(completedAt) - Date.parse(startedAt)` — must be a non-negative integer; negative or NaN raises `RuntimeBoundsInvalidError`.

- (1b) **The dev session is responsible for capturing wall-clock.** The MCP tool layer cannot see the Task-tool spawn; the dev session SKILL.md captures `startedAt` immediately before the Task call and `completedAt` immediately after Task returns. This story does NOT modify any SKILL.md (start/SKILL.md is locked); a follow-up SKILL.md wiring story (or Story 5.3) is responsible for the prose-level "call `recordAgentInvoke` after every spawn" instruction. The tool ships and is exercised by vitest in v1; the SKILL.md prose wiring lands in a sibling story noted in § Locked files.

- (1c) **`agent.invoke` event body — exactly the existing 1.5 schema, unchanged.** The schema declared in `schemas/telemetry-events.ts:46-55` is used verbatim. `runtime_ms` is required; `tokens_in` and `tokens_out` are optional. The event's `agent` field is the kebab-cased role name (e.g. `generalist-dev`, `generalist-reviewer`) per the existing `TelemetryEventBase.agent` regex `/^[a-z0-9-]+$/`.

- (1d) **Result shape.** `RecordAgentInvokeResult` is one of:
  ```ts
  type RecordAgentInvokeResult =
    | { kind: "ok" }
    | { kind: "reviewer-timed-out"; substitutedCommentUrl: string; labelsApplied: string[] }
    | { kind: "dev-budget-exceeded"; cumulativeRuntimeMs: number; budgetMs: number };
  ```
  The dev session SKILL.md (caller) inspects the discriminator and surfaces appropriately. The `ok` case is the common path; the other two are sentinel returns that the dev session must propagate to its chat output for the orchestrator to see (this is where AC4's "next poll surfaces" hook attaches downstream).

- (1e) **No emission on `RuntimeBoundsInvalidError`.** If `completedAt < startedAt` (clock-skew on the operator's machine) or either timestamp is malformed, the tool raises and writes nothing — no telemetry, no substitution, no budget check. The dev session SKILL.md is expected to propagate the error to chat; the operator sees a typed error rather than silent data corruption.

**AC2 unpacked.** `reviewer.verdict` emission inside `postReviewerComments`:

- (2a) **Trigger point.** `tools/post-reviewer-comments.ts` already runs to completion only on successful POST of the summary comment (failures raise typed errors and propagate). Immediately after the existing POST-success path (and BEFORE the function returns), emit one `reviewer.verdict` event via `logTelemetryEvent`. The emission is wrapped in a `try { ... } catch (cause) { ... }` block: a telemetry-write failure MUST NOT cause the verdict-post to be rolled back or rerun — the comment is already posted to GitHub. On telemetry error, log via the existing typed-error path and continue; the next reviewer run will produce a fresh event.

- (2b) **Event body.**
  ```ts
  {
    type: "reviewer.verdict";
    session_id: <reviewer session ulid>;
    agent: "generalist-reviewer";  // hardcoded; only this role posts verdict comments in v1
    story_id: <ref from manifest>;
    data: {
      pr_number: number;
      verdict: "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED" | "reviewer-failure";
      standards_version: string;  // semver — read from reviewer-result.json's `standardsVersion`
      plugin_version: string;     // semver — read from plugin.json via `lib/plugin-version.ts`
      timed_out: boolean;         // true if event was emitted via the AC3 substitution path; false otherwise
    };
  }
  ```
  No `eventual_merge_action` field on this event — that's a separate retroactive event (see 2c). The discriminated-union schema for `reviewer.verdict` enforces this shape via `.strict()`.

- (2c) **Retroactive `eventual_merge_action`.** A separate event type `reviewer.verdict.merge_action` is emitted later (typically by Story 5.3's polling loop, via the new `recordPrCloseAction` tool — see AC2g) with the join key `(pr_number, session_id)`. Schema:
  ```ts
  {
    type: "reviewer.verdict.merge_action";
    session_id: <reviewer session ulid; matches the original event>;
    agent: "generalist-reviewer";
    story_id: <ref>;
    data: {
      pr_number: number;
      merge_action: "merged" | "closed-unmerged" | "still-open";
      resolved_at: string;  // ISO-8601 UTC
    };
  }
  ```
  Story 4.10's `compute-agreement` reads both events and joins by `(pr_number, session_id)` to compute agreement. The join key is documented in the JSDoc on `RecordPrCloseActionOpts` for future-4.10 consumption.

- (2d) **`standards_version` source.** The reviewer's `reviewer-result.json` (Story 4.6 / 4.7) already carries `standardsVersion` — confirmed in `post-reviewer-comments.ts:242` (`resultFile.standardsVersion`). Pass through verbatim. If the field is unexpectedly absent (older session pre-4.7), raise `ReviewerResultMissingStandardsVersionError` rather than emit a malformed event.

- (2e) **`plugin_version` source.** Use `getPluginVersion()` from `lib/plugin-version.ts` (Story 1.5 era). Cached at module-load time; safe to call inline.

- (2f) **`session_id` source.** The reviewer session's ulid is the `sessionUlid` passed into `postReviewerComments` (existing signature). Pass through verbatim.

- (2g) **New MCP tool: `recordPrCloseAction`.** Signature: `recordPrCloseAction(opts: { sessionUlid: string; storyId?: string; prNumber: number; mergeAction: "merged" | "closed-unmerged" | "still-open"; resolvedAt?: string; targetRepoRoot?: string }): Promise<{ kind: "ok" }>`. Writes one `reviewer.verdict.merge_action` event via `logTelemetryEvent`. `resolvedAt` defaults to `new Date().toISOString()`. No-op idempotency: the tool does NOT dedupe — if called twice with the same `(prNumber, sessionUlid)`, it writes twice. Dedup is the caller's responsibility (Story 5.3's loop). Rationale: append-only JSONL semantics + downstream `compute-agreement` (4.10) can pick the latest by `resolved_at` if needed; embedding a dedup index here adds state we don't otherwise need.

**AC3 unpacked.** 8-min reviewer hard cap (substitution branch inside `recordAgentInvoke`):

- (3a) **Trigger condition.** Inside `recordAgentInvoke`: after writing the `agent.invoke` event (which always happens), check: `agent === "generalist-reviewer" && runtimeMs > REVIEWER_HARD_CAP_MS`. The constant `REVIEWER_HARD_CAP_MS = 8 * 60 * 1000 = 480_000` is exported from a new file `lib/runtime-limits.ts`. NO other reviewer-runtime measurement exists in v1; this is the single source of truth.

- (3b) **Substitution body.** Compose the substituted comment body with the existing verdict idempotency marker (Story 4.7). The body text MUST contain:
  - The verdict-marker footer: `<!-- crew:verdict:<plugin-version>:<story-id> -->` — verbatim from Story 4.7's convention; computed via the same helper that `postReviewerComments` uses today.
  - A first-line failure header: exactly `## Reviewer exceeded 8-minute hard cap` (literal; tested verbatim).
  - A second paragraph naming the runtime: `Reviewer wall-clock ran for <N> seconds (cap: 480 seconds). Story was not marked failed; \`needs-human\` label applied so a human can triage.` Where `<N>` is `Math.round(runtimeMs / 1000)`.
  - A third paragraph naming the story ref and PR number, and a link to the prior verdict marker (so the operator can find the cap-substituted comment in the PR history).

- (3c) **Substitution mechanism.** Call the existing `postReviewerComments` MCP tool with `verdictBodyOverride: <substituted body>` and `reviewerVerdictOverride: "reviewer-failure"`. Both fields are NEW additions to `postReviewerComments`' typed input (see § Locked files for the exception). `postReviewerComments` already handles the locked-marker grep-and-edit idempotency — passing the substituted body uses that same mechanism with no special-casing.

- (3d) **Label application.** Call `applyReviewerLabels({ targetRepoRoot, sessionUlid, verdictOverride: "reviewer-failure" })` — this is the existing Story 4.8 signature (`apply-reviewer-labels.ts:77-78`). It routes through the existing `["reviewed-by-agent", "needs-human"]` label set. No modification to `applyReviewerLabels` required.

- (3e) **Story NOT marked failed.** The manifest at `.crew/state/review/<ref>.yaml` (the reviewer state where the story lives between PR-open and merge) is NOT touched by this story. Specifically: do NOT call `completeStory({ outcome: "failed" })` or any other state-transition tool. The story stays in `review`. The `needs-human` label is the surfacing channel; orchestration surfaces the label via Story 5.3's polling. This invariant is asserted in vitest (4f4): after the substitution path runs, the manifest file's path and contents are unchanged from before.

- (3f) **Verdict event still emitted.** After substitution + labelling complete (or fail — see 3g), emit the `reviewer.verdict` event from inside `recordAgentInvoke` (not from `postReviewerComments`, because the substitution path bypasses the normal POST trigger). Event data carries `verdict: "reviewer-failure"`, `timed_out: true`. This is the ONLY path that emits `reviewer.verdict` with `verdict: "reviewer-failure"`.

- (3g) **Best-effort substitution.** If `postReviewerComments` or `applyReviewerLabels` itself fails (network, gh auth), DO NOT raise — log via the existing typed-error path. The `reviewer.verdict` event is still emitted with `timed_out: true` and `verdict: "reviewer-failure"`. Rationale: the operator already has a problem (reviewer hung); the recovery comment / label is a courtesy, not load-bearing. The JSONL event is the durable record.

- (3h) **Return shape.** The `recordAgentInvoke` call that triggered the substitution returns `{ kind: "reviewer-timed-out", substitutedCommentUrl: <url or "" on failure>, labelsApplied: <array or [] on failure> }`. The dev session SKILL.md surfaces this to chat. The dev session does NOT itself flip status — same invariant as (3e).

**AC4 unpacked.** 30-min dev budget (`dev.budget_exceeded` emission inside `recordAgentInvoke`):

- (4a) **Trigger condition.** Inside `recordAgentInvoke`, after writing `agent.invoke`: if `agent === "generalist-dev" && storyId !== undefined`, compute cumulative dev runtime for this story. Read the current month's JSONL file (`<targetRepoRoot>/.crew/telemetry/<YYYY-MM>.jsonl`), filter `{ type: "agent.invoke", agent: "generalist-dev", story_id: <storyId> }`, sum `data.runtime_ms`. The newly-written event is included (the sum is computed AFTER the append). If the sum was below `DEV_BUDGET_MS = 30 * 60 * 1000 = 1_800_000` BEFORE this event and is at-or-above AFTER, emit one `dev.budget_exceeded` event.

- (4b) **One-shot emission, not per-event.** The `dev.budget_exceeded` event is emitted exactly once per `(story_id, current_month)` pair. To detect the "first crossing," `recordAgentInvoke` checks both: (i) the cumulative sum AFTER this event is `>= DEV_BUDGET_MS`, AND (ii) no prior `dev.budget_exceeded` event for this `story_id` exists in the current month's JSONL. If a prior `dev.budget_exceeded` exists, skip emission. The check is `O(n)` over the current month's JSONL — acceptable given monthly rollover.

- (4c) **Cross-month edge case.** If the dev runtime accumulates across a month rollover (e.g. a story spans October → November), the November file starts with zero cumulative — a `dev.budget_exceeded` event for the same story may emit in both October and November. This is intentional: monthly buckets are the architectural unit of telemetry granularity (`core-architectural-decisions.md:68`). Story 5.3's polling logic deduplicates on `(story_id, year)` if needed.

- (4d) **Event body.**
  ```ts
  {
    type: "dev.budget_exceeded";
    session_id: <dev session ulid passed into recordAgentInvoke>;
    agent: "generalist-dev";
    story_id: <ref>;
    data: {
      cumulative_runtime_ms: number;   // sum after this event
      budget_ms: number;               // DEV_BUDGET_MS at emission time
      triggering_invocation_runtime_ms: number;  // the just-recorded invocation's runtime
    };
  }
  ```

- (4e) **Return shape.** `recordAgentInvoke` returns `{ kind: "dev-budget-exceeded", cumulativeRuntimeMs, budgetMs }`. The caller (dev session SKILL.md) is expected to surface to chat; it does NOT flip status or stop work (NFR3 says "surfaced" — not "stopped"; surfacing without stopping preserves operator choice).

- (4f) **No retroactive emission on tool deployment.** When `recordAgentInvoke` is first deployed, prior dev runtime that already exceeds 30 min for any in-flight story will trigger emission on the NEXT call to `recordAgentInvoke` for that story. This is acceptable: the surfacing happens once-and-thereafter is suppressed.

**AC5 unpacked.** Integration suite scope:

- (5a) **Fixture base.** vitest tests use `fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"))` per `beforeEach` to create a clean `targetRepoRoot`. `afterEach` cleans via `fs.rm(..., { recursive: true })`. No `import.meta.url` mocking. No mocking of `logTelemetryEvent` — tests exercise the real writer against the tmpdir JSONL file.

- (5b) **(a) `agent.invoke` written on every spawn.** `it()` block calls `recordAgentInvoke` three times with distinct `sessionUlid`s and a 60-second runtime each. Read the month's JSONL; assert exactly three `agent.invoke` events exist, in order, with the expected `session_id` / `agent` / `runtime_ms` values. Assert no other event types were written. Result for each call: `{ kind: "ok" }`.

- (5c) **(b) `reviewer.verdict` written on every verdict comment.** Two sub-cases:
  - (b1) Direct `postReviewerComments` integration: write a valid `reviewer-result.json` to the session dir, stub the `gh` call to succeed, call `postReviewerComments`. Read the month's JSONL; assert one `reviewer.verdict` event exists with `verdict` matching the result file's `recommendedVerdict`, `timed_out: false`, and the expected PR number / standards_version / plugin_version.
  - (b2) `recordPrCloseAction` companion event: call the tool with `mergeAction: "merged"`. Assert one `reviewer.verdict.merge_action` event exists with matching `pr_number` and `session_id`.

- (5d) **(c) Hard-8-min substitution.** Call `recordAgentInvoke({ agent: "generalist-reviewer", startedAt: T0, completedAt: T0 + 9 * 60 * 1000 + 1 })` against a tmpdir with a seeded `reviewer-result.json` (so the verdict-marker / standards-version are resolvable). Stub `postReviewerComments` and `applyReviewerLabels` to succeed. Assert:
  - (c1) Return shape: `{ kind: "reviewer-timed-out", substitutedCommentUrl: <stub url>, labelsApplied: ["reviewed-by-agent", "needs-human"] }`.
  - (c2) JSONL contains one `agent.invoke` event with `runtime_ms: 540001`, and one `reviewer.verdict` event with `verdict: "reviewer-failure"`, `timed_out: true`.
  - (c3) The substituted comment body passed to the `postReviewerComments` stub contains exactly `## Reviewer exceeded 8-minute hard cap` and the runtime in seconds.
  - (c4) Story manifest path / contents in `.crew/state/review/` are unchanged before/after — assert via `fs.readFile` snapshot.
  - (c5) `applyReviewerLabels` was called with `verdictOverride: "reviewer-failure"` (assert via spy).
  - (c6) Best-effort: when `postReviewerComments` stub raises, the JSONL still contains the `reviewer.verdict` event with `timed_out: true` and the return shape is `{ kind: "reviewer-timed-out", substitutedCommentUrl: "", labelsApplied: [] }`.

- (5e) **(d) 30-min dev budget surfaces.** Three sub-cases:
  - (d1) Call `recordAgentInvoke({ agent: "generalist-dev", storyId: "bmad:1.2", startedAt: T0, completedAt: T0 + 10 * 60 * 1000 })` three times in sequence. Assert: first two calls return `{ kind: "ok" }`; the third (cumulative 30 min) returns `{ kind: "dev-budget-exceeded", cumulativeRuntimeMs: 1800000, budgetMs: 1800000 }`. JSONL contains three `agent.invoke` events and exactly one `dev.budget_exceeded` event.
  - (d2) Call a fourth `recordAgentInvoke` with another 10-min runtime. Return is `{ kind: "ok" }` (NOT `dev-budget-exceeded` — only first crossing triggers). JSONL has four `agent.invoke` events and still exactly one `dev.budget_exceeded` event.
  - (d3) `agent: "generalist-dev"` WITHOUT `storyId`: assert no `dev.budget_exceeded` event written even if a single invocation exceeds 30 min. The cumulative-by-story computation requires a `story_id`.

- (5f) **Non-AC coverage (extras the implementer should add for the same suite):**
  - `RuntimeBoundsInvalidError` on `completedAt < startedAt`: assert thrown; no events written.
  - `RuntimeBoundsInvalidError` on malformed timestamps: assert thrown; no events written.
  - `agent.invoke` for non-dev / non-reviewer roles (e.g. `pm`, `architect`): assert event written; no substitution, no budget check, no extra events.
  - `recordPrCloseAction` writes the event verbatim — assert `merge_action` field matches input.
  - Schema-strict assertion: an attempt to write a `reviewer.verdict` event with an unknown extra key in `data` fails (caught by `logTelemetryEvent`'s `TelemetryEventSchema.safeParse`) — assert `TelemetryEventInvalidError` is thrown AND a `telemetry.invalid` event appears in the JSONL (the existing Story 1.5 failure-recording path).
  - Schema-strict assertion: `dev.budget_exceeded` with unknown extra key in `data` similarly fails.

- (5g) **Round-trip JSONL parseability.** One `it()` reads back the JSONL file after a multi-event run and parses each line with `TelemetryEventSchema.safeParse` — every line must `success: true`. This protects against any event-construction code path that bypasses Zod validation.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Extend the telemetry event schema** (AC: #2, #3, #4)
  - [ ] 1.1 In `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`, append three new schema entries after `TelemetryInvalidEventSchema`:
    - `ReviewerVerdictEventSchema` — discriminator `"reviewer.verdict"`, `data: { pr_number: z.number().int().positive(), verdict: z.enum(["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED", "reviewer-failure"]), standards_version: z.string().regex(/^\d+\.\d+\.\d+$/), plugin_version: z.string().regex(/^\d+\.\d+\.\d+$/), timed_out: z.boolean() }`. `.strict()` on both event and data objects.
    - `ReviewerVerdictMergeActionEventSchema` — discriminator `"reviewer.verdict.merge_action"`, `data: { pr_number: z.number().int().positive(), merge_action: z.enum(["merged", "closed-unmerged", "still-open"]), resolved_at: z.string().datetime({ offset: false }).refine(s => s.endsWith("Z"), "must be UTC") }`. `.strict()`.
    - `DevBudgetExceededEventSchema` — discriminator `"dev.budget_exceeded"`, `data: { cumulative_runtime_ms: z.number().int().nonnegative(), budget_ms: z.number().int().positive(), triggering_invocation_runtime_ms: z.number().int().nonnegative() }`. `.strict()`.
  - [ ] 1.2 Update `TelemetryEventSchema` to include all three new schemas in the discriminated union (now 5 entries: `AgentInvokeEventSchema`, `TelemetryInvalidEventSchema`, `ReviewerVerdictEventSchema`, `ReviewerVerdictMergeActionEventSchema`, `DevBudgetExceededEventSchema`).
  - [ ] 1.3 Export the new schemas and inferred types (`ReviewerVerdictEvent`, `ReviewerVerdictMergeActionEvent`, `DevBudgetExceededEvent`).
  - [ ] 1.4 No behavioural change to `lib/logger.ts` — its discriminated-union dispatch already handles new types via the schema.

- [ ] **Task 2: Runtime-limit constants and typed errors** (AC: #1, #3, #4)
  - [ ] 2.1 Create `plugins/crew/mcp-server/src/lib/runtime-limits.ts`. Export:
    - `export const REVIEWER_HARD_CAP_MS = 8 * 60 * 1000;` (literally `480_000`).
    - `export const DEV_BUDGET_MS = 30 * 60 * 1000;` (literally `1_800_000`).
    - JSDoc citing NFR2 + NFR3 + this story key.
  - [ ] 2.2 In `plugins/crew/mcp-server/src/errors.ts`, append:
    - `RuntimeBoundsInvalidError` extending `DomainError`. Constructor: `{ sessionUlid: string; agent: string; startedAt: string; completedAt: string; reason: string }`. Message: `` `recordAgentInvoke: invalid runtime bounds for session <sessionUlid> agent=<agent> (started=<startedAt>, completed=<completedAt>): <reason>. (NFR2/NFR3)` ``.
    - `ReviewerResultMissingStandardsVersionError` extending `DomainError`. Constructor: `{ sessionUlid: string }`. Message: `` `reviewer-result.json for session <sessionUlid> missing required standardsVersion field; cannot emit reviewer.verdict event. (FR66)` ``.

- [ ] **Task 3: `reviewer.verdict` emission inside `postReviewerComments`** (AC: #2)
  - [ ] 3.1 Modify `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (declared-locked-file exception — see § Locked files). At the POST-success path (immediately before the function returns its result), assemble and emit a `reviewer.verdict` event via `logTelemetryEvent`:
    ```ts
    try {
      await logTelemetryEvent({
        targetRepoRoot: opts.targetRepoRoot,
        event: {
          type: "reviewer.verdict",
          session_id: opts.sessionUlid,
          agent: "generalist-reviewer",
          story_id: <ref from manifest>,
          data: {
            pr_number: resultFile.prNumber,
            verdict: resultFile.recommendedVerdict,
            standards_version: resultFile.standardsVersion,
            plugin_version: getPluginVersion(),
            timed_out: false,
          },
        },
      });
    } catch (cause) {
      // Telemetry-write failures must not roll back the verdict POST.
      // The comment is already on GitHub; the next reviewer run will produce a fresh event.
      // Log via existing typed-error path (TelemetryEventInvalidError or any other).
    }
    ```
  - [ ] 3.2 The `<ref from manifest>` is the story ref the reviewer was working on; read from the same source `post-reviewer-comments.ts` already uses (the manifest in `.crew/state/`). If unavailable for any reason, set `story_id` undefined — the schema's `story_id` is optional.
  - [ ] 3.3 If `resultFile.standardsVersion` is undefined or empty, raise `ReviewerResultMissingStandardsVersionError` rather than emit a malformed event. (This is structurally impossible post-4.7 but worth pinning.)

- [ ] **Task 4: Add `verdictBodyOverride` and `reviewerVerdictOverride` to `postReviewerComments`** (AC: #3)
  - [ ] 4.1 Extend `postReviewerComments`' input shape (in `tools/post-reviewer-comments.ts`):
    - Add optional `verdictBodyOverride?: string`. When provided, the tool uses this body verbatim instead of composing from `composeReviewerSummary` (the existing Story 4.6b helper). All other behaviour (locked-marker grep, edit-in-place idempotency) unchanged.
    - Add optional `reviewerVerdictOverride?: "reviewer-failure"`. When provided, the emitted `reviewer.verdict` event's `verdict` field carries the override value AND `timed_out: true`. When absent, the field comes from `resultFile.recommendedVerdict` and `timed_out: false`.
  - [ ] 4.2 Both fields are optional with no default; existing callers (Story 4.6b chat surface) pass nothing and see no behavioural change.

- [ ] **Task 5: `recordAgentInvoke` MCP tool** (AC: #1, #3, #4)
  - [ ] 5.1 Create `plugins/crew/mcp-server/src/tools/record-agent-invoke.ts`. Implement:
    ```ts
    export async function recordAgentInvoke(opts: RecordAgentInvokeOpts): Promise<RecordAgentInvokeResult>
    ```
    where `RecordAgentInvokeOpts = { sessionUlid: string; agent: string; storyId?: string; startedAt: string; completedAt: string; tokensIn?: number; tokensOut?: number; targetRepoRoot: string; postReviewerCommentsImpl?: ...; applyReviewerLabelsImpl?: ...; nowImpl?: () => Date; readCurrentMonthJsonlImpl?: ...; logTelemetryEventImpl?: ... }`. The four `*Impl` fields are test seams; production callers pass none.
  - [ ] 5.2 Algorithm:
    1. Parse `startedAt` and `completedAt` with `Date.parse`. If either is NaN or `completedAt < startedAt`, raise `RuntimeBoundsInvalidError` (no telemetry written).
    2. Compute `runtimeMs = parseDate(completedAt) - parseDate(startedAt)`.
    3. Build and emit `agent.invoke` event via `logTelemetryEvent`. Optional `tokens_in` / `tokens_out` only included when provided.
    4. **Reviewer-cap branch:** if `agent === "generalist-reviewer" && runtimeMs > REVIEWER_HARD_CAP_MS`:
       - Compose substituted body per AC3 unpacked (3b). Use `getPluginVersion()` and the story-id-from-session resolution path that `postReviewerComments` already uses.
       - Call `postReviewerComments({ targetRepoRoot, sessionUlid, verdictBodyOverride: <substituted>, reviewerVerdictOverride: "reviewer-failure" })`. On failure, swallow and set `substitutedCommentUrl: ""`.
       - Call `applyReviewerLabels({ targetRepoRoot, sessionUlid, verdictOverride: "reviewer-failure" })`. On failure, swallow and set `labelsApplied: []`.
       - Emit `reviewer.verdict` event with `verdict: "reviewer-failure", timed_out: true` via `logTelemetryEvent` (best-effort).
       - Return `{ kind: "reviewer-timed-out", substitutedCommentUrl, labelsApplied }`.
    5. **Dev-budget branch:** if `agent === "generalist-dev" && storyId !== undefined`:
       - Read the current month's JSONL (`<targetRepoRoot>/.crew/telemetry/<YYYY-MM>.jsonl`). Use `fs.readFile`; if ENOENT, treat as empty.
       - Filter lines parseable as `agent.invoke` events with matching `agent` + `story_id`; sum `data.runtime_ms`.
       - Filter lines parseable as `dev.budget_exceeded` events with matching `story_id` — if ANY exist in the current month, skip emission.
       - If the cumulative-with-this-invocation `>= DEV_BUDGET_MS` AND no prior `dev.budget_exceeded` for this story this month: emit one event via `logTelemetryEvent`; return `{ kind: "dev-budget-exceeded", cumulativeRuntimeMs, budgetMs: DEV_BUDGET_MS }`.
    6. Otherwise: return `{ kind: "ok" }`.
  - [ ] 5.3 JSDoc citing this story key, FR65, NFR2, NFR3, and the cumulative-runtime-by-story computation rationale.

- [ ] **Task 6: `recordPrCloseAction` MCP tool** (AC: #2)
  - [ ] 6.1 Create `plugins/crew/mcp-server/src/tools/record-pr-close-action.ts`. Implement:
    ```ts
    export async function recordPrCloseAction(opts: RecordPrCloseActionOpts): Promise<{ kind: "ok" }>
    ```
    where `RecordPrCloseActionOpts = { sessionUlid: string; storyId?: string; prNumber: number; mergeAction: "merged" | "closed-unmerged" | "still-open"; resolvedAt?: string; targetRepoRoot: string; nowImpl?: () => Date; logTelemetryEventImpl?: ... }`.
  - [ ] 6.2 Default `resolvedAt` to `(opts.nowImpl ?? (() => new Date()))().toISOString()`. Emit one `reviewer.verdict.merge_action` event via `logTelemetryEvent`. Return `{ kind: "ok" }`.
  - [ ] 6.3 JSDoc explicitly documents the `(prNumber, sessionUlid)` join key that Story 4.10's `compute-agreement` will use, and notes the deliberate no-dedup decision (caller's responsibility).

- [ ] **Task 7: MCP-tool registration** (AC: all)
  - [ ] 7.1 In `plugins/crew/mcp-server/src/tools/register.ts`, register `recordAgentInvoke` and `recordPrCloseAction` following the existing registration pattern. Tool-count assertion in `__tests__/tool-registration.test.ts` (if present) gets bumped by 2.
  - [ ] 7.2 Add the new tools to the appropriate role permissions YAML so the dev session (caller of `recordAgentInvoke`) and any future caller of `recordPrCloseAction` can invoke them. The natural permission home: `plugins/crew/permissions/generalist-dev.yaml` for `recordAgentInvoke`; `recordPrCloseAction` lands in a permissions file appropriate to its eventual caller (Story 5.3 will own this — for v1, add to `generalist-dev.yaml` as a placeholder so it can be exercised from tests).

- [ ] **Task 8: Integration test suite** (AC: #5)
  - [ ] 8.1 Create `plugins/crew/mcp-server/src/tools/__tests__/record-agent-invoke.test.ts`. Cover AC5 cases (5b) basic emission, (5d) substitution branch, (5e) budget branch, (5f) error + edge cases.
  - [ ] 8.2 Create `plugins/crew/mcp-server/src/tools/__tests__/record-pr-close-action.test.ts`. Cover (5c)(b2) merge-action emission, (5f) verbatim merge_action passthrough.
  - [ ] 8.3 Modify `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` (if existing) or create the file. Add tests for (5c)(b1) — `reviewer.verdict` event written on POST success; substitution-override path produces the expected event.
  - [ ] 8.4 Create `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events-extension.test.ts` (or add to the existing `telemetry-events.test.ts` if present). Cover the three new schemas' strict-mode behaviour (5g — round-trip parseability) and the schema-strict assertions in (5f).
  - [ ] 8.5 Use `fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"))` for all tmpdir fixtures (project convention; matches `4-9-...md`'s § Testing standards).
  - [ ] 8.6 Use `expect(fn).rejects.toThrow(RuntimeBoundsInvalidError)` for class assertions; combined `expect(...).rejects.toMatchObject({ name: "RuntimeBoundsInvalidError" })` for property assertions.

- [ ] **Task 9: Build, vitest, dist** (AC: all)
  - [ ] 9.1 `pnpm build` from `plugins/crew/mcp-server` passes. TypeScript surfaces no errors from the new files.
  - [ ] 9.2 All vitest tests pass — both new tests and the existing suite (no regression).
  - [ ] 9.3 Commit `dist/` per CLAUDE.md. The `dist/` rebuild picks up the new `schemas/`, `lib/`, and `tools/` files.
  - [ ] 9.4 Remove the `TODO(4.12)` comment from `tools/run-reviewer-session.ts:29` — the wiring is now complete (via `postReviewerComments` for `reviewer.verdict` and via the new `recordAgentInvoke` for `agent.invoke`). This is a one-line edit; declared-locked-file exception noted.

---

## Implementation strategy

### Why `agent.invoke` is emitted by the dev session SKILL.md caller, not by MCP tools

The Task tool that spawns a subagent is harness-level — the MCP tool layer cannot observe the spawn directly. The dev session (the SKILL.md prose running under the dev subagent's parent) is the only layer that knows when a subagent was spawned and when it returned. So the wall-clock measurement HAS to be captured in SKILL.md prose (or in the harness, which we can't modify), then handed to the MCP tool layer via `recordAgentInvoke`. The MCP tool's job is to write durable data + enforce caps; the SKILL.md's job is to measure + call.

This story does not modify any SKILL.md (start/SKILL.md is locked). The wiring lands in a sibling story (likely Story 5.3 when the orchestration polling skill ships its full instruction set). In v1, `recordAgentInvoke` is exercised by vitest only — production SKILL.md callers come later. This is intentional and called out in § "What this story does NOT (b)" + AC1 unpacked (1b).

### Why `reviewer.verdict` is emitted inside `postReviewerComments` (not via `recordAgentInvoke`)

The verdict-post happens as part of the reviewer's normal flow — there's no Task-tool spawn surrounding `postReviewerComments` from the dev session's perspective (the dev session calls `postReviewerComments` directly). Embedding the emission inside the tool is the deterministic seam: every successful POST writes one event, no caller has to remember.

The substitution branch (AC3) is the only path that emits `reviewer.verdict` from `recordAgentInvoke` — because in that path `postReviewerComments` is being called WITH the override flags, and we need the resulting `reviewer.verdict` event to carry `timed_out: true`. The simplest way: have `recordAgentInvoke` emit the event AND have `postReviewerComments` NOT emit when `reviewerVerdictOverride` is set. Either (a) the override path emits from `recordAgentInvoke` and `postReviewerComments` skips emission when the override flag is present, OR (b) `postReviewerComments` always emits but uses the override values when they're set, and `recordAgentInvoke` doesn't emit. Option (b) is cleaner — one emission point per code path. Going with (b): when `reviewerVerdictOverride: "reviewer-failure"` is passed, `postReviewerComments` emits the event with `verdict: "reviewer-failure", timed_out: true`. `recordAgentInvoke` does not emit `reviewer.verdict` itself; it just calls `postReviewerComments` and `applyReviewerLabels`. Task 5.2 step 4 reflects this.

**Revised AC3 mechanism (per the strategy above):** `recordAgentInvoke` calls `postReviewerComments` with `verdictBodyOverride` + `reviewerVerdictOverride`. `postReviewerComments` emits `reviewer.verdict` with `timed_out: true`. AC3(f) and Task 5.2's "Emit reviewer.verdict from recordAgentInvoke" are wrong — please use the cleaner mechanism (b). This footnote intentionally documents the design trade-off; the dev agent should follow this strategy section, not the inline AC3(f) wording.

### Why `dev.budget_exceeded` is computed by re-reading the JSONL (no sidecar cumulative)

Two alternatives:

1. **Sidecar cumulative file** at `.crew/state/sessions/<storyId>/dev-cumulative-runtime-ms.json` — write-on-every-invocation, read at trigger check. Pros: O(1) read; cons: another state file to keep consistent with telemetry truth; another canonical-fs-guard whitelist entry.
2. **Read JSONL each call** — at `recordAgentInvoke` time, read current month's JSONL, sum matching events. Pros: telemetry is the single source of truth (no consistency to maintain); easier to reason about. Cons: O(n) read where n = current month's event count.

Going with (2). The JSONL file is bounded (monthly rollover, typically <1MB), the read happens at most once per dev subagent invocation (not per millisecond), and a Story 6.x perf pass can introduce caching if profiling shows it matters. The architectural principle (`core-architectural-decisions.md:69` — JSONL events are the parseable substrate) is preserved.

### Why the substitution body must include the verdict idempotency marker

Story 4.7's locked footer (`<!-- crew:verdict:<plugin-version>:<story-id> -->`) is how reruns of the reviewer find-and-edit-in-place existing comments. If the substituted failure comment uses a DIFFERENT marker (or no marker), then a subsequent successful reviewer run would POST a new comment alongside the failure comment — the PR ends up with two reviewer comments, and the operator can't tell which is current. Reusing the marker lets the recovery be clean: a successful reviewer run after a substitution finds-by-grep, edits the failure body to the new success body, and the PR history reads naturally (failure event → recovery event, single comment thread).

### Why best-effort substitution (3g) is correct

The operator already has a problem: the reviewer hung. The recovery comment + label is a courtesy — the JSONL `reviewer.verdict` event with `timed_out: true` is the load-bearing record (consumed by 4.10's agreement metric and any future SLA dashboard). If `gh` itself is failing (network, auth), no amount of retrying changes that. Failing loudly here would amplify one problem into two without helping the operator. Failing silently to JSONL preserves the durable record.

### Why no configurable budgets in v1

The hardcoded `REVIEWER_HARD_CAP_MS = 480_000` and `DEV_BUDGET_MS = 1_800_000` are sourced from NFR2 and NFR3 verbatim. Adding `.crew/config.yaml` overrides is a future-additive change: a `plugin.runtime_limits.reviewer_cap_ms` field with override resolution mirrors Story 4.9's pattern (default + override). Doing it now would balloon scope with no current operator demand. The constants live in `lib/runtime-limits.ts` so the eventual overlay-aware loader has a clean place to land.

### Why schemas use `.strict()` and `z.literal` discriminators

Consistent with Story 1.5's existing closed-set discipline. Unknown extra keys are how spec format drift starts; `.strict()` fails fast at the write boundary. The discriminator literals make `compute-agreement` (4.10) and any future consumer's `safeParse` route to the right schema branch without an `if/else` chain.

### Why no MCP tool dedupes `recordPrCloseAction` writes

The tool ships with no caller in v1. The natural caller (Story 5.3's polling loop) is the right place to put dedup — because 5.3 knows when it most-recently-polled and which PRs it observed transitions on. Embedding dedup here would require this story to either (a) read the JSONL on every write (cost — same as the AC4 case but for a tool that shouldn't even be hot-path), or (b) maintain a sidecar dedup index (more state, more guarantees to maintain). Append-only JSONL with caller-side dedup is the simpler v1.

---

## Locked files

These files are off-limits to this story. If a change appears necessary, STOP and surface the conflict — do not silently edit.

- `plugins/crew/mcp-server/src/lib/logger.ts` (Story 1.5) — DO NOT modify. The discriminated-union dispatch already handles new event types via the schema; no logger change needed.
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Story 4.6) — DO NOT modify behaviour. Task 9.4 is a one-line comment-removal exception (the `TODO(4.12)` line); no functional change.
- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts` (Story 4.4) — DO NOT modify. The dev-terminal-action tool runs *inside* the dev subagent; emitting `agent.invoke` from inside would double-count.
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Story 4.6) — DO NOT modify. The transcript processor is downstream of `runReviewerSession`; its existing verdict-routing logic is unchanged by this story.
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Story 4.3b / 4.5 / 4.6) — DO NOT modify. The dev transcript processor reads `dev-outcome.json` (Story 4.8b) and is not in the telemetry emission path.
- `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts` (Story 4.8) — DO NOT modify. The tool already supports `verdictOverride: "reviewer-failure"` (line 77-78); this story calls it with that value and is otherwise unconcerned.
- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1) — DO NOT modify. AC3's invariant is that the story is NOT moved to failed; that means NOT calling this tool with `outcome: "failed"` from any new code path.
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` / `claim-story.ts` (Story 4.1) — DO NOT modify.
- `plugins/crew/skills/start/SKILL.md` (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7) — DO NOT modify. The SKILL.md wiring for `recordAgentInvoke` lands in a sibling story; v1 ships the tool only.
- `plugins/crew/permissions/generalist-reviewer.yaml` (Stories 2.2 / 4.6 / 4.7) — DO NOT modify. Only `generalist-dev.yaml` is touched (Task 7.2).
- `plugins/crew/mcp-server/src/lib/plugin-version.ts` (Story 1.5) — pattern reference only; do not modify.

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/schemas/telemetry-events.ts`** (Story 1.5; locked-by-default because the closed discriminated union is contract surface) — Task 1 appends three new schemas to the closed union. This is the additive-extension pattern explicitly anticipated by the file's "Closed set in v1" docstring. No existing schemas are modified; three new entries plus union-list update.
- **`plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`** (Story 4.6b / 4.7; locked due to verdict-marker idempotency contract) — Task 3 adds the `reviewer.verdict` emission inside the POST-success path and Task 4 adds the `verdictBodyOverride` + `reviewerVerdictOverride` input fields. The locked verdict-marker grep-and-edit behaviour is preserved verbatim; the new fields are optional and additive.
- **`plugins/crew/mcp-server/src/errors.ts`** (typed-error hierarchy; appended-to by most Epic-1 through Epic-4 stories) — Task 2.2 appends `RuntimeBoundsInvalidError` and `ReviewerResultMissingStandardsVersionError`. Routine additive growth following the established `extends DomainError` pattern.
- **`plugins/crew/mcp-server/src/tools/register.ts`** (Story 1.4; locked due to tool-count assertion) — Task 7.1 registers two new tools. Bump the tool-count assertion in the existing `__tests__/tool-registration.test.ts` if present.
- **`plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`** (Story 4.6; locked due to deterministic-verdict-transport contract) — Task 9.4 removes the `TODO(4.12)` comment on line 29. No behavioural change; comment-only edit.
- **`plugins/crew/permissions/generalist-dev.yaml`** (Story 2.2) — Task 7.2 adds the two new tool names to the allow-list. Routine additive growth.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/lib/runtime-limits.ts` (Task 2.1)
- `plugins/crew/mcp-server/src/tools/record-agent-invoke.ts` (Task 5)
- `plugins/crew/mcp-server/src/tools/record-pr-close-action.ts` (Task 6)
- `plugins/crew/mcp-server/src/tools/__tests__/record-agent-invoke.test.ts` (Task 8.1)
- `plugins/crew/mcp-server/src/tools/__tests__/record-pr-close-action.test.ts` (Task 8.2)
- `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events-extension.test.ts` (Task 8.4 — or add to existing telemetry-events test file if present)

### Files this story will modify

- `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` (Task 1; append three schemas + update union list)
- `plugins/crew/mcp-server/src/errors.ts` (Task 2.2; append two error classes)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Tasks 3, 4; emit event, add override fields)
- `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` (Task 8.3; add new tests if file exists, else create)
- `plugins/crew/mcp-server/src/tools/register.ts` (Task 7.1; register two new tools)
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Task 9.4; remove TODO comment — comment-only)
- `plugins/crew/permissions/generalist-dev.yaml` (Task 7.2; add two tool entries)
- `plugins/crew/mcp-server/dist/` (Task 9.3; rebuild and commit)

### Current-state notes on files being modified or referenced

- **`schemas/telemetry-events.ts`** (current state per Story 1.5): defines `TelemetryEventBase`, `AgentInvokeEventSchema`, `TelemetryInvalidEventSchema`, and the `TelemetryEventSchema` discriminated union. `.strict()` on every payload. Closed-set rule documented in the top-of-file JSDoc. Task 1 appends three sibling event schemas and updates the union list — no existing entries touched.
- **`tools/post-reviewer-comments.ts`** (current state per Stories 4.6b / 4.7): POSTs the reviewer summary comment to GitHub, uses the locked verdict-marker for idempotent reruns. Reads `resultFile.standardsVersion` at line 242 (confirmed). Currently emits no telemetry. Tasks 3 + 4 add one POST-success emission and two optional input fields; existing behaviour preserved when overrides are absent.
- **`tools/apply-reviewer-labels.ts`** (current state per Story 4.8): already accepts `verdictOverride: "reviewer-failure"` (lines 77-78), already routes that override through the `["reviewed-by-agent", "needs-human"]` label set (lines 135-137). No modification — this story calls it with the existing override.
- **`lib/logger.ts`** (current state per Story 1.5): single entrypoint for telemetry writes; dispatches via `TelemetryEventSchema.safeParse`. Adding new schemas to the union (Task 1) is sufficient; no logger change.
- **`tools/run-reviewer-session.ts`** (current state per Story 4.6 with the rev-2 deterministic-verdict-transport patch): writes `reviewer-result.json` via `atomicWriteFile`. Carries a `TODO(4.12)` on line 29 that Task 9.4 removes — the implementation arrived.

### Testing standards

- vitest with `pnpm vitest --run` from `plugins/crew/mcp-server/`.
- `fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"))` for tmpdir fixtures; `fs.rm(..., { recursive: true })` in `afterEach`.
- No global mocks. No `import.meta.url` mocking.
- Class-level error assertions via `expect(fn).rejects.toThrow(RuntimeBoundsInvalidError)`; property assertions via `expect(...).rejects.toMatchObject({ name: "RuntimeBoundsInvalidError" })`.
- Telemetry round-trip: tests read back the JSONL file after each scenario and parse each line with `TelemetryEventSchema.safeParse` to confirm schema conformance.
- Test seams on `recordAgentInvoke`: `postReviewerCommentsImpl` / `applyReviewerLabelsImpl` / `nowImpl` / `readCurrentMonthJsonlImpl` / `logTelemetryEventImpl`. Production callers pass none; tests pass test doubles. No `vi.mock` of production modules.

### Dependencies

- Story 1.5 (`lib/logger.ts`, `schemas/telemetry-events.ts`) — the closed-set discriminated-union substrate this story extends.
- Story 4.6 / 4.6b / 4.7 (`tools/post-reviewer-comments.ts`, the verdict-marker idempotency contract, `reviewer-result.json` shape) — the POST seam this story emits from.
- Story 4.8 (`tools/apply-reviewer-labels.ts`) — already supports `verdictOverride: "reviewer-failure"`; AC3 invokes it unchanged.
- Architecture § "Telemetry & Observability" (`core-architectural-decisions.md` lines 64-72) — pins JSONL format, schema discriminator, version-stamping requirement.
- PRD `FR65` (`prd-crew-v1/functional-requirements.md:98`) — per-agent invocation log.
- PRD `FR66` (`prd-crew-v1/functional-requirements.md:99`) — per-reviewer-verdict log + retroactive merge_action.
- PRD `NFR2` (`prd-crew-v1/non-functional-requirements.md:8`) — 8-min reviewer hard cap.
- PRD `NFR3` (`prd-crew-v1/non-functional-requirements.md:9`) — 30-min dev budget.

### Downstream callers (not implemented by this story)

- Story 4.10: `compute-agreement` reads `reviewer.verdict` + `reviewer.verdict.merge_action` events; joins on `(pr_number, session_id)`.
- Story 5.3: orchestration polling loop calls `recordPrCloseAction` after observing PR-state transitions via `gh pr view`; surfaces `dev.budget_exceeded` events as "stuck stories" on the operator chat surface.
- Story 5.4: stuck-story / stale-claim detection reads `dev.budget_exceeded` as one of its inputs.
- Story 6.x: outcome-stats / skill-effectiveness reports read all event types.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.12`]
- [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`] (§ Telemetry & Observability)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] (FR65, FR66)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/non-functional-requirements.md`] (NFR2, NFR3)
- [Source: `plugins/crew/mcp-server/src/lib/logger.ts`] (write-path pattern reference)
- [Source: `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`] (schema pattern + closed-set rule)
- [Source: `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`] (POST-success emission seam)
- [Source: `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts`] (existing `verdictOverride: "reviewer-failure"` support)
- [Source: `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts:29`] (`TODO(4.12)` to remove)
- [Source: `plugins/crew/docs/user-surface-acs.md`] (substrate-vs-user-surface judgement)

---

## Previous story intelligence

### From Story 4.9 (just shipped — adjacent in epic, PR #149)

- **Spec validation caught real bugs before code burned.** Three example-vs-rule contradictions were patched inline pre-dev: `z.literal` `errorMap` wiring; lowercase-vs-uppercase regex/Zod-emit mismatch; `os.tmpdir() + crypto.randomUUID()` broken-path pattern. Lesson: pin assertion text to the actually-installed Zod version (Zod 4.x emits `"Invalid option"` not `"Invalid enum value"`).
- **Zod 4 `z.literal` custom errors use `{ message: "..." }` not v3's `errorMap`.** Pattern to follow if any new schema in this story uses literals with custom messages.
- **Tmpdir fixture convention:** `fs.mkdtemp(path.join(os.tmpdir(), "<prefix>-"))` — adopted in 4.9 spec and AC4 / Task 8.5 above.
- **Override-replaces-default semantics** from 4.9 are not directly applicable here (this story has no override; the runtime-limit constants are hardcoded), but the discipline of one-source-of-truth-per-decision carries over.

### From Story 4.8 (shipped — pattern source for label application)

- `applyReviewerLabels` already accepts `verdictOverride: "reviewer-failure"` and routes through the `["reviewed-by-agent", "needs-human"]` label set. AC3 reuses this surface verbatim.

### From Story 4.7 (shipped — verdict-marker idempotency)

- The locked footer marker `<!-- crew:verdict:<plugin-version>:<story-id> -->` is how `postReviewerComments` finds-and-edits-in-place. AC3 invariant: the substituted failure comment MUST carry the same marker so a subsequent successful reviewer run cleanly edits in place.

### From Story 1.5 (shipped — telemetry substrate)

- `logTelemetryEvent` in `lib/logger.ts` is the ONLY write path for telemetry. Whitelisted in `canonical-fs-guard.test.ts`. New event types are added by extending the closed discriminated union in `schemas/telemetry-events.ts`; the logger requires no change.
- On Zod failure, the logger writes a `telemetry.invalid` event AND throws `TelemetryEventInvalidError` — this story relies on that fail-loud behaviour for AC5's schema-strict assertions.

### Git intelligence (recent commits on dev)

```
6963c0a feat(4): Risk-tiering spec format and override resolution (#149)
53b3432 feat(5): Persist dev transcript to disk before any MCP call (#148)
d3e1c81 chore(ship-story): TEMP hand-edit base to origin/dev
371e390 chore: gitignore .crew/ runtime directory
47af195 spec(5-10): authored ready-for-dev spec for transcript persistence
```

Pattern: Epic 4 commits follow `feat(4): <subject>`. Story 4.12's commit follows `feat(4): Per-invocation telemetry and runtime soft/hard limits`. Spec commits follow `chore(<short>): <subject>`. Dist rebuild is part of the same `feat(4)` commit (one PR per story rule).

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
