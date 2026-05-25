# Story 4.10b: Auto-merge gate, medium/high pause, and user override

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator**,
I want **low-risk PRs with verdict `READY FOR MERGE` to auto-merge via `gh pr merge --squash` once the reviewer has earned my trust (`risk_tier: low` AND `agreement_metric ≥ plugin.agreement_threshold` from `.crew/config.yaml`, default `0.8`), and all other shapes (`medium`/`high` risk tier regardless of verdict, low risk with sub-threshold or insufficient-data agreement) to pause with the `needs-human` label and a one-line surface reason, while still allowing me to merge anything manually**,
so that **the dev-review loop drains end-to-end on PRs the reviewer is reliable on, and pauses for me on PRs where either the change is risky or the reviewer's track record doesn't yet justify auto-merge — without ever blocking my manual override authority (FR42)**.

### What this story is, in one sentence

Add `runAutoMergeGate` (MCP tool, file `mcp-server/src/tools/auto-merge-gate.ts`) that reads `reviewer-result.json` for the just-completed reviewer run, consults `computeAgreement` (Story 4.10) and `WorkspaceConfigSchema.plugin.agreement_threshold` to make a six-branch decision (merge / paused-medium / paused-high / paused-sub-threshold / paused-insufficient-data / skipped-not-ready-for-merge), calls `gh pr merge --squash --delete-branch` on the merge branch and `gh api POST /issues/<n>/labels` with `needs-human` on every pause branch; wire the tool into `plugins/crew/skills/start/SKILL.md` as a new step `12a` on the `done-ready-for-merge` branch (after the manifest move, before "claiming next"); grant the orchestrator role `gh_allow: pr-merge`.

### What this story does (and why it needs its own story)

Story 4.10 shipped the deterministic `computeAgreement` helper that returns `AgreementMetric | null`. Story 4.9b shipped the `risk_tier` stamp (on the execution manifest and on the `reviewer-result.json` via the `riskTier` field on `ReviewerResultFileShape`). This story is the consumer of both — it composes the two inputs into a single decision and either calls `gh pr merge` or pauses the PR with `needs-human`.

Three reasons the gate is its own story rather than folded into 4.10 or 4.9b:

1. **Different review surface and different blast radius.** The `computeAgreement` helper is a pure aggregator over local files; the risk-tier classifier is a pure pattern-matcher. The auto-merge gate writes to GitHub — it calls `gh pr merge`, which closes a PR and merges a branch into `main`. Reviewing the gate's six-branch decision tree plus its `gh` side effects under one PR with either of the upstream stories would conflate "is the input correct" with "is the action correct", and the latter is the higher-blast-radius question.

2. **Six-branch decision tree with a config seam.** The gate's behaviour depends on two runtime inputs (verdict, risk_tier), one config value (`plugin.agreement_threshold`), and one computed value (`AgreementMetric | null`). The six branches in AC4 unpacked (4a) are the cartesian projection that the integration suite must cover. None of this surface exists in 4.10 or 4.9b.

3. **`gh pr merge` is the first plugin-runtime write to GitHub.** Prior stories' GitHub writes (the reviewer's `gh api` label calls and PR review posts in 4.6b / 4.7 / 4.8) were all reviewer-authored. The auto-merge call is the FIRST GitHub write attributed to the plugin runtime itself, on behalf of the orchestrator role. The role's permission file (`permissions/orchestrator.yaml`) gains `pr-merge` here for the first time. The `gh-error-map.yaml` may need a new entry (already-merged → recoverable success); whether one is needed is pinned in AC5 unpacked (5b).

This story explicitly DOES touch `permissions/orchestrator.yaml` (adds `pr-merge` to `gh_allow`), `skills/start/SKILL.md` (adds step 12a on the `done-ready-for-merge` branch), and creates a new MCP tool + registration. It does NOT modify `processReviewerTranscript`, `completeStory`, `applyReviewerLabels`, `runReviewerSession`, `postReviewerComments`, `computeAgreement`, the risk-tier classifier, or any schema in `schemas/`.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Modify `processReviewerTranscript` to inline the gate before `completeStory`. The manifest move `in-progress/<ref>.yaml → done/<ref>.yaml` happens INSIDE `processReviewerTranscript` on the `READY FOR MERGE` branch (Story 4.3c invariant); this story does NOT change that ordering. The auto-merge attempt runs AFTER the manifest is in `done/`. Rationale: the reviewer's verdict is the trigger that flips the manifest to `done/`; the `gh pr merge` call is a downstream effect. If `gh pr merge` fails (recoverable or otherwise), the manifest stays in `done/` and the PR stays open with `needs-human` so the operator can merge manually — this is exactly the FR42 override authority the story preserves.
- (c) Add a "wait for CI" step. The gate does not poll CI status. `gh pr merge --squash` without `--auto` merges immediately if mergeable; if the PR has required status checks pending, `gh` returns a non-zero exit and a clear error message that the gate surfaces as a paused branch (the `--auto` flag would wait for checks, but it queues a merge that fires later out-of-band — that is a different UX and a different story).
- (d) Implement `--auto` merge (GitHub's auto-merge queue). v1 makes a synchronous decision: merge now or pause now. Queueing for later (e.g. waiting for CI to go green) introduces a "merge pending" state that has no current surface in `chatLog` and no manifest representation. Deferred to a follow-up if/when the operator wants `gh pr merge --auto` as the default (likely once Story 5.x adds an orchestration loop that can observe queued PRs).
- (e) Re-classify the risk tier. The classifier (Story 4.9b) runs in `runReviewerSession` and stamps the manifest plus the `reviewer-result.json`. The gate READS `result.riskTier` exactly once per invocation; if absent (a pre-4.9b record, or a reviewer that crashed before the classifier ran), the gate treats it as a paused-high branch with reason `missing-risk-tier` (defensive fail-closed; see AC4 unpacked (4d) below).
- (f) Cache the gate decision. Each invocation reads `reviewer-result.json`, the manifest, the workspace config, and the telemetry log fresh. The gate runs at most once per `done-ready-for-merge` event; there is no value in caching across invocations.
- (g) Emit a telemetry event for the gate decision. No `gate.decision` event type exists in `TelemetryEventSchema`. Story 4.12 is the writer of per-invocation telemetry; if "how often did the gate auto-merge vs pause" becomes interesting for retros, that emission is added in 4.12 (or a successor). v1 surfaces the decision only on the `chatLog` line.
- (h) Add a `--dry-run` mode. The gate is binary: either it acts (merge or apply label) or it doesn't. A `--dry-run` MCP tool flag would be useful for the operator-facing CLI surface (deferred per (i) below) but adds branch coverage with no v1 caller. Deferred.
- (i) Add a CLI command wrapper (`crew auto-merge-gate ...`). The gate is invoked from `start` SKILL.md prose only. An operator-typed CLI surface is a future workflow once Epic 5's orchestration loop exists and an operator might want to manually run the gate against an open PR. Deferred to a follow-up story alongside the `crew compute-agreement` CLI noted in Story 4.10's deferred work.
- (j) Retry on `gh pr merge` failure. A single attempt is made; failures (recoverable or otherwise) surface to the operator via `chatLog`. Retry logic adds non-trivial state (attempt count, backoff schedule, when-to-give-up) that has no v1 caller. The operator's recovery path is: read the surface line, fix the cause (e.g. resolve a merge conflict), then run `gh pr merge` manually — this is exactly the FR42 path.
- (k) Read `risk_tier` from the execution manifest instead of from `reviewer-result.json`. Both Story 4.9b surfaces carry the value; this story chose the session file (`<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`) for two reasons: (1) `applyReviewerLabels` already reads it and the gate runs adjacent in the prose layer; (2) the manifest at gate-call time is in `done/<ref>.yaml` (just moved by `processReviewerTranscript`); reading from `done/` would require manifest-io to support that state path (it does in code, but the convention is "reviewer-result.json is the verdict transport"). The session file is the canonical source for runtime decisions; the manifest is the canonical source for queue state.
- (l) Treat `verdict: NEEDS CHANGES` or `verdict: BLOCKED` as auto-merge candidates. The gate is invoked ONLY on the `done-ready-for-merge` branch (per the SKILL.md wiring in Task 4); the other verdict branches don't reach step 12a. The gate's six-branch decision tree assumes the verdict has already been decided as `READY FOR MERGE` by `processReviewerTranscript`; the `skipped-not-ready-for-merge` return branch exists only as a defensive guard for callers that invoke the tool out of order (e.g. a future operator-typed CLI). The v1 SKILL.md prose never triggers this branch.
- (m) Apply the `auto-merged` label or any new label class. The gate applies only `needs-human` (on the pause branches) — and only via `gh api POST /issues/<n>/labels`, matching the `applyReviewerLabels` pattern. The `reviewed-by-agent` label is already on the PR (applied by `applyReviewerLabels` at step 10a). No new label vocabulary is introduced.
- (n) Bump the `reviewed-by-agent` label semantics. v1 leaves the existing labels alone. A `merged-by-agent` label might be useful retrospectively (operators can grep merged-by-the-gate PRs in GitHub) but is not in any FR and adds noise to the PR label set. Deferred.
- (o) Modify `applyReviewerLabels`. Its responsibility (apply `reviewed-by-agent` on every verdict; apply `needs-human` on NEEDS CHANGES / BLOCKED / reviewer-failure) is unchanged. The gate adds `needs-human` on a new condition (READY FOR MERGE + paused) — and does so via its own `gh api POST` call, not by extending `applyReviewerLabels`. This keeps the two responsibilities crisp: labels-after-verdict (4.8) vs labels-after-gate (this story).
- (p) Validate that `verdict === "READY FOR MERGE"` against the verdict comment text on GitHub. The gate trusts `reviewer-result.json` as authoritative (the same trust `applyReviewerLabels` and `processReviewerTranscript` already extend). If the comment was edited after posting, that's an FR42 manual-override path — the gate doesn't re-derive verdict from the comment body.
- (q) Stamp the gate decision into the PR body or any new comment. Surfacing happens on `chatLog` only. Adding a PR comment would create yet another comment to chase the verdict comment around (Story 4.7's footer-marker dance) and is out of scope.
- (r) Update `.crew/config.yaml` to expose new tuning knobs (e.g. `merge_method`, `delete_branch`). The merge method is pinned to `--squash --delete-branch` (matches Jack's `CLAUDE.md` rule "never commit to local main — squash-merge causes divergence"). A future story may surface these as config if a target repo's conventions differ.
- (s) Handle `gh pr merge`'s `--repo` flag. The gate runs `gh` with `cwd: targetRepoRoot` per the existing `lib/gh.ts` contract (which uses `execa` with the appropriate cwd). The `--repo` flag is unnecessary when cwd is set correctly. Cross-fork PRs (PR from a fork to the upstream) merge against the upstream via `gh`'s default resolution, same as the rest of the plugin's `gh` calls.
- (t) Touch `runReviewerSession`, `composeSummaryBody`, `postReviewerComments`, or the verdict-grammar parser. The gate consumes the persisted `reviewer-result.json`; the upstream producers are locked.
- (u) Implement a heartbeat or session-liveness check before merging. The gate fires from inside the `start` skill's foreground prose; the same session that ran the dev and reviewer subagents is alive when the gate fires. Epic 5's stale-claim detection is orthogonal.
- (v) Change the manifest's risk-tier-bearing schema or the `ReviewerResultFileShape`. The gate is a strict reader — `reviewer-result.json` carries `riskTier` (from 4.9b); the gate reads it. If it's absent, the gate treats it as fail-closed (per (e) and AC4 unpacked (4d)).
- (w) Persona / catalogue file changes. The gate is plugin-runtime behaviour, not agent behaviour — no `catalogue/<role>.md` and no `team/<role>/PERSONA.md` knowledge update is required by this story.
- (x) Add the gate's decision rendering to `/crew:status`. Operator visibility in v1 is via the `chatLog` surface line emitted by `start`. A future Epic 5 story may surface "PRs awaiting human merge" on `/crew:status`; out of scope here.

### Deferred work

- **`--auto` merge mode and CI-aware queueing.** Use GitHub's auto-merge queue when required checks are pending, so the gate can keep moving rather than pausing on a temporarily-failing CI. Adds a "merge pending" state to the orchestration model; pairs with Epic 5's polling loop.
- **CLI wrapper (`crew auto-merge-gate ...`).** Operator-typed surface that runs the gate against a specific session/ref. Same shape as the deferred `crew compute-agreement` from Story 4.10.
- **`merged-by-agent` label.** Retrospective visibility: which merges came from the gate vs from a human. Cheap once we want to grep PRs by gate-origin.
- **Configurable merge method.** Surface `merge_method: squash | rebase | merge` and `delete_branch: boolean` in `plugin:` block of `.crew/config.yaml`. v1 is squash + delete; a future operator may want rebase-only.
- **Gate-decision telemetry event.** A `gate.decision` JSONL event recording (sessionUlid, ref, decision, riskTier, agreementRatio, threshold). Lands with Story 4.12 if 4.12's scope expands; otherwise its own follow-up.
- **Re-run safety on an already-merged PR.** `gh pr merge` on a merged PR exits non-zero. v1 surfaces the error verbatim and proceeds; a follow-up could classify this exit signature as `already-merged → recoverable success`. AC5 unpacked (5b) below pins the behaviour for v1; a `gh-error-map.yaml` entry may follow.
- **Retry/backoff on recoverable `gh pr merge` errors.** Network blip, rate limit, transient auth. v1 single-attempt; surface and let the operator merge manually.

---

## Acceptance Criteria

> AC1–AC4 are verbatim from the epic. AC5 is the integration suite. Per `plugins/crew/docs/user-surface-acs.md`, this story has at least one operator-visible surface — the `chatLog` line emitted on each branch is the user surface. AC1 and the medium/high/sub-threshold/insufficient-data branches of AC2/AC3 each emit a verbatim chat line the operator reads in the `/crew:start` UI; per the rubric's strict-membership rule (i), those ACs carry the `(user-surface)` tag below. The MCP tool's return-shape ACs (AC4 unpacked (4a)) are substrate.

**AC1 (user-surface):**
**Given** a PR with `verdict: READY FOR MERGE`, `risk_tier: low`, and `agreement_metric ≥ threshold` (default 0.8, configurable via `plugin.agreement_threshold` in `.crew/config.yaml`),
**When** the auto-merge gate runs,
**Then** the plugin calls `gh pr merge` on the PR. _(FR40)_

<!-- User-surface: the gate emits a verbatim chat-surface line `PR #${prNumber} auto-merged (risk:low, agreement:${ratioFormatted})` that the operator reads in /crew:start. Per Surface §1 of plugins/crew/docs/user-surface-acs.md, every line emitted on a /crew:start path is part of the operator-facing surface. -->

**AC2 (user-surface):**
**Given** a PR with `risk_tier: medium` or `risk_tier: high` (regardless of verdict),
**When** the auto-merge gate runs,
**Then** the PR is paused with the `needs-human` label and no merge action is taken. _(FR41)_

<!-- User-surface: the gate emits `PR #${prNumber} paused — risk_tier: ${tier}` to chatLog; the operator sees this and reaches for `gh pr merge` if they choose to override. -->

**AC3 (user-surface):**
**Given** a PR with verdict `READY FOR MERGE`, `risk_tier: low`, but `agreement_metric` below threshold (or `null`),
**When** the auto-merge gate runs,
**Then** the PR is paused with `needs-human` and the surface line names the reason (sub-threshold or insufficient data). _(FR40)_

<!-- User-surface: two distinct chat lines — `PR #${prNumber} paused — agreement ${ratioFormatted} below threshold ${thresholdFormatted}` and `PR #${prNumber} paused — insufficient telemetry to compute agreement`. The distinction matters because the recovery paths differ. -->

**AC4 (FR42 — preserved by no-op):**
**Given** a PR with verdict `NEEDS CHANGES` or `BLOCKED`,
**When** the user runs `gh pr merge` manually,
**Then** the plugin does not interfere — override authority is preserved. _(FR42)_

<!-- Not user-surface: this AC is satisfied by *no code* — the gate is never invoked on non-READY-FOR-MERGE branches per the SKILL.md wiring. The proof is the SKILL.md wiring assertion in AC5 unpacked (5c). -->

**AC5 (integration):**
vitest covers (a) auto-merge fires, (b) medium pauses, (c) high pauses, (d) low + sub-threshold pauses, (e) low + insufficient-data pauses, (f) manual merge override.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

### Expanded acceptance specifics (folded into AC1–AC5 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** Gate contract, return shape, and decision algorithm:

- (1a) **Function signature.** `runAutoMergeGate(opts: { targetRepoRoot: string; sessionUlid: string; role?: string; execaImpl?: typeof execa; pluginRootOverride?: string }): Promise<AutoMergeGateResult>` where:
  ```ts
  export type AutoMergeGateResult =
    | { next: "skipped-no-session-result" }                    // reviewer-result.json absent
    | { next: "skipped-not-ready-for-merge"; verdict: string } // defensive — verdict is not READY FOR MERGE
    | { next: "merged"; prNumber: number; agreementRatio: number; threshold: number }
    | { next: "paused-medium"; prNumber: number }
    | { next: "paused-high"; prNumber: number }
    | { next: "paused-missing-risk-tier"; prNumber: number }   // riskTier absent on the result file
    | { next: "paused-sub-threshold"; prNumber: number; agreementRatio: number; threshold: number }
    | { next: "paused-insufficient-data"; prNumber: number };
  ```
  `role` defaults to `"orchestrator"`. `execaImpl` and `pluginRootOverride` are test seams mirroring `applyReviewerLabels`'s shape.

- (1b) **Decision algorithm.**
  1. Read `reviewer-result.json` via `readReviewerResultFile(targetRepoRoot, sessionUlid)` (same helper as `applyReviewerLabels`). On null → return `{ next: "skipped-no-session-result" }`.
  2. If `result.recommendedVerdict !== "READY FOR MERGE"` → return `{ next: "skipped-not-ready-for-merge", verdict: result.recommendedVerdict }`. (Defensive — SKILL.md never reaches the gate on a non-green branch.)
  3. If `result.riskTier === undefined` → call the pause-path (1g) with reason `missing-risk-tier`, return `{ next: "paused-missing-risk-tier", prNumber }`.
  4. If `result.riskTier === "medium"` → call the pause-path (1g), return `{ next: "paused-medium", prNumber }`.
  5. If `result.riskTier === "high"` → call the pause-path (1g), return `{ next: "paused-high", prNumber }`.
  6. (`result.riskTier === "low"`.) Resolve `threshold` from the workspace config: call `resolveWorkspace({ targetRepoRoot })` (or equivalent existing helper) and read `workspace.config.plugin.agreement_threshold`. Default `0.8` is already applied at schema-parse time.
  7. Call `computeAgreement({ targetRepoRoot })` (default `lastNVerdicts: 50`).
  8. If the result is `null` → call the pause-path (1g), return `{ next: "paused-insufficient-data", prNumber }`.
  9. If `result.ratio < threshold` → call the pause-path (1g), return `{ next: "paused-sub-threshold", prNumber, agreementRatio: result.ratio, threshold }`.
  10. Else → call the merge-path (1f), return `{ next: "merged", prNumber, agreementRatio: result.ratio, threshold }`.

- (1c) **Why "filter by riskTier BEFORE consulting agreement metric".** Medium/high tiers pause regardless of the agreement metric (FR41 is unconditional on verdict and metric). Reading the metric only when `riskTier === "low"` keeps the helper call out of the medium/high paths — slightly cheaper, and tells the test suite that the helper's null-return cannot affect a medium/high decision.

- (1d) **Why "skipped-not-ready-for-merge" is a defensive return, not an error.** The MCP tool boundary makes `runAutoMergeGate` callable from any session (e.g. a future operator CLI). Treating "called against a non-green verdict" as an error would punish that future caller; treating it as a noop return preserves FR42's spirit ("the user can merge manually"). v1's SKILL.md wiring guarantees this branch never fires from `/crew:start`.

- (1e) **`prNumber` source.** Read from `reviewer-result.json` — `result.prNumber` is already on the schema (Story 4.6 / 4.8). The gate does not derive `prNumber` from any other source.

- (1f) **Merge-path implementation.**
  1. Load orchestrator permissions via `loadRolePermissions({ role: "orchestrator", pluginRoot })`. The role's `gh_allow` MUST include `pr-merge` (Task 5 adds it).
  2. Call `gh({ role, permissions, subcommand: "pr-merge", args: [String(prNumber), "--squash", "--delete-branch"], execaImpl, pluginRootOverride: pluginRoot })`.
  3. On success: return the merged branch.
  4. On `GhRecoverableError`: propagate uncaught. The SKILL.md outer try/catch (Task 4) surfaces the error verbatim and proceeds to claim the next story (consistent with `applyReviewerLabels`'s best-effort posture — the manifest is already in `done/`; the operator merges manually).
  5. Other gh exit codes (already-merged, merge-conflict, blocked-by-branch-protection): propagate the raw `ExecaError` uncaught. The SKILL.md outer try/catch surfaces verbatim. v1 does NOT classify these in `gh-error-map.yaml` — see Deferred work.

- (1g) **Pause-path implementation.** Apply ONE label `needs-human` via `gh api POST /repos/${owner}/${repo}/issues/${prNumber}/labels` with body `{ labels: ["needs-human"] }`. Resolve `owner`/`repo` by calling `gh pr-view ${prNumber} --json baseRepository` (same pattern `applyReviewerLabels` uses). Failures (Gh recoverable, response-shape) propagate uncaught — SKILL.md surfaces verbatim. No surface-line composition happens inside the tool; SKILL.md composes the operator-visible chat line from the returned `next` branch and `prNumber`.

- (1h) **Idempotency on rerun.** If the operator re-runs `/crew:start` against a session whose PR was already merged in a prior run, the second `gh pr merge --squash --delete-branch` call exits non-zero with a message like `Pull request #N is already merged`. The gate does not catch this — the error propagates and SKILL.md's outer try/catch surfaces the line. The operator reads "already merged" and ignores it. v1 contract; a future story may add an `already-merged` `gh-error-map.yaml` row that classifies this as a recoverable success (return `{ next: "merged-already" }`).

- (1i) **`needs-human` label is idempotent on the PR side.** GitHub's `POST /issues/<n>/labels` is upsert-shaped: applying a label already present is a no-op (the API returns the existing label list, no error). The gate does not pre-check.

- (1j) **No labels are removed.** The gate does not strip `reviewed-by-agent` (still true — the reviewer ran). It does not strip a `needs-human` that might have been applied by `applyReviewerLabels` (in v1, that label is applied only on non-green verdicts; on a `READY FOR MERGE` verdict the label is absent before the gate runs). Idempotency aside, the gate is additive-only on labels.

- (1k) **Verdict-line literals match Story 4.6b / 4.10.** The gate checks `result.recommendedVerdict === "READY FOR MERGE"` with the exact literal from the locked verdict grammar (matching `ReviewerVerdictEventSchema`'s enum in Story 4.10). No translation, no canonicalisation.

**AC2 unpacked.** Medium/high pause semantics:

- (2a) **Trigger conditions.** Pause when `result.riskTier === "medium"` OR `result.riskTier === "high"`. The `paused-missing-risk-tier` branch is a separate fail-closed defensive case (see (4d)); operators distinguish "the classifier said medium" from "the classifier didn't run" by the surface line.

- (2b) **Surface lines (composed in SKILL.md, NOT in the tool).** SKILL.md emits these verbatim on each branch:
  - `paused-medium` → `PR #${prNumber} paused — risk_tier: medium`
  - `paused-high` → `PR #${prNumber} paused — risk_tier: high`
  - `paused-missing-risk-tier` → `PR #${prNumber} paused — risk_tier missing on reviewer-result (run pre-dates 4.9b or classifier failed)`

- (2c) **No agreement metric is consulted.** The gate's algorithm steps (1b.4) and (1b.5) return without reading the metric. The integration suite asserts this by passing a `computeAgreement` test double that throws if called (one of the medium/high test fixtures).

**AC3 unpacked.** Low + below-threshold / insufficient-data pause semantics:

- (3a) **Sub-threshold trigger.** `metric !== null` AND `metric.ratio < threshold`.

- (3b) **Insufficient-data trigger.** `metric === null` (the helper returned the v1 null branch — see Story 4.10 AC2).

- (3c) **Surface lines (SKILL.md).**
  - `paused-sub-threshold` → `PR #${prNumber} paused — agreement ${(ratio * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`
  - `paused-insufficient-data` → `PR #${prNumber} paused — insufficient telemetry to compute agreement (need ≥50 resolved verdicts)`

- (3d) **The threshold's source is the workspace config.** The gate does NOT accept a `threshold` parameter. `plugin.agreement_threshold` is the single source of truth; if the operator wants a different threshold they edit `.crew/config.yaml`. Schema default is `0.8` (matches FR40).

- (3e) **Ratio rendering is one decimal place.** Surface readability over precision. The raw ratio (a JS number) is the returned value; the SKILL.md formatter uses `.toFixed(1)` for the chat line only.

**AC4 unpacked.** FR42 override authority and the missing-risk-tier defensive branch:

- (4a) **The gate never fires on non-green verdicts.** SKILL.md (Task 4) wires the gate only inside the `done-ready-for-merge` branch of step 12's switch. The NEEDS CHANGES / BLOCKED branches (`done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`) emit their own chat lines and return to the outer loop without invoking the gate. AC4 is satisfied by absence — the integration suite asserts the wiring (AC5 unpacked (5c)).

- (4b) **The `gh pr merge` call uses `--squash --delete-branch`.** Matches Jack's `CLAUDE.md` rule (squash to keep main linear; delete the source branch on merge). No config switch in v1.

- (4c) **The gate does not block manual `gh pr merge`.** GitHub's API has no concept of "this PR is reserved by an agent"; the operator can `gh pr merge` at any time. The plugin's only writes to the PR are the verdict comment (4.6b/4.7), label applies (4.8 / this story), and the merge call itself. None of these prevent a manual merge.

- (4d) **Defensive fail-closed on `riskTier === undefined`.** If `reviewer-result.json` lacks `riskTier`, the gate pauses with `needs-human` and surface reason `missing-risk-tier`. Rationale: the gate's auto-merge decision rests on knowing the tier; an absent tier means the classifier didn't run (a pre-4.9b record or a runtime bug), and the safe default is "don't auto-merge". An operator who knows the change is safe can `gh pr merge` manually.

**AC5 unpacked.** Integration suite scope:

- (5a) **Test-file layout.** Two vitest test files:
  - `plugins/crew/mcp-server/src/tools/__tests__/auto-merge-gate.test.ts` — primary integration suite covering the eight return branches plus the SKILL.md-wiring assertion (5c).
  - `plugins/crew/permissions/__tests__/orchestrator-permissions.test.ts` — if a permission-shape test exists for other roles, extend it to assert `pr-merge` is in `orchestrator.gh_allow`. If no such test exists, the assertion is added as a standalone `it()` inside `auto-merge-gate.test.ts` reading and parsing the YAML.

- (5b) **Fixture pattern.** Tmpdir per `beforeEach`; populate `.crew/state/sessions/<ulid>/reviewer-result.json` with a hand-crafted shape (the `ReviewerResultFileShape` interface from `run-reviewer-session.ts` is the truth-source). Populate `.crew/config.yaml` with `plugin.agreement_threshold` as needed (default tests use the implicit 0.8). Use an `execa` test double (`execaImpl` opts seam) that returns canned `gh` outputs. NO real `gh` calls.

- (5c) **SKILL.md-wiring assertion.** A single `it()` reads `plugins/crew/skills/start/SKILL.md` and asserts:
  1. The string `runAutoMergeGate` appears exactly once on the `done-ready-for-merge` branch of step 12.
  2. The string `runAutoMergeGate` does NOT appear on any other branch (`done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`, `done-blocked-no-session-result`).
  3. The chat-surface lines from (2b), (3c), and the (1a) merge branch each appear verbatim in the SKILL.md prose (use substring assertions, not full-line equality, to tolerate surrounding markdown).

- (5d) **Branch (a): auto-merge fires.** Seed `reviewer-result.json` with `{ recommendedVerdict: "READY FOR MERGE", riskTier: "low", prNumber: 42, ... }`; seed telemetry with 60 resolved `reviewer.verdict` events giving an agreement ratio of 0.9 (≥ 0.8 default threshold). Assert: `next === "merged"`, `agreementRatio` matches, `threshold === 0.8`, the `execaImpl` mock saw exactly one `gh pr-merge` call with args `["42", "--squash", "--delete-branch"]`. Assert NO `gh api POST .../labels` call.

- (5e) **Branch (b): medium pauses.** `riskTier: "medium"`. Assert: `next === "paused-medium"`, NO `gh pr-merge` call, exactly one `gh api POST /repos/.../issues/42/labels` call with body containing `"needs-human"`. Assert the `computeAgreement` test double was NOT called.

- (5f) **Branch (c): high pauses.** Same as (5e) with `riskTier: "high"`; assert `next === "paused-high"`.

- (5g) **Branch (d): low + sub-threshold pauses.** `riskTier: "low"`; telemetry yields `ratio: 0.6`; default threshold 0.8. Assert: `next === "paused-sub-threshold"`, `agreementRatio: 0.6`, `threshold: 0.8`, one label-apply call, no merge call.

- (5h) **Branch (e): low + insufficient-data pauses.** `riskTier: "low"`; telemetry empty (or only 10 resolved events, below the default window of 50). `computeAgreement` returns `null`. Assert: `next === "paused-insufficient-data"`, one label-apply call, no merge call.

- (5i) **Branch (f): manual merge override (proof by absence).** Seed `reviewer-result.json` with `recommendedVerdict: "NEEDS CHANGES"`. The gate is NOT invoked from SKILL.md on this branch — the unit test calls the tool directly to assert `next === "skipped-not-ready-for-merge"`, `verdict: "NEEDS CHANGES"`. The wiring-side proof is in (5c) — the SKILL.md NEEDS CHANGES branch contains no reference to `runAutoMergeGate`. Together these two assertions satisfy AC4.

- (5j) **No-session-result branch.** Delete `reviewer-result.json` before calling. Assert: `next === "skipped-no-session-result"`. No `gh` calls of any kind.

- (5k) **Missing-risk-tier branch.** Seed `reviewer-result.json` with `recommendedVerdict: "READY FOR MERGE"` but no `riskTier` field. Assert: `next === "paused-missing-risk-tier"`, one label-apply call, no merge call. No call to `computeAgreement`.

- (5l) **Configurable threshold.** Write `.crew/config.yaml` with `plugin: { agreement_threshold: 0.6 }`. Telemetry yields `ratio: 0.65`. Assert: `next === "merged"` (not paused-sub-threshold). Same seed with `agreement_threshold: 0.7`: assert `next === "paused-sub-threshold"`.

- (5m) **Idempotent label-apply.** Pre-seed a fake "label-already-applied" gh response (the labels endpoint returns the existing label list; the gate treats the call as success). Assert no error.

- (5n) **Recoverable gh error on merge propagates.** Mock `gh pr-merge` to throw `GhRecoverableError`. Assert the call throws (propagated uncaught); assert no label-apply call was made (the gate took the merge path, not the pause path).

- (5o) **Recoverable gh error on label-apply propagates.** Mock the labels endpoint to throw `GhRecoverableError`. Assert the call throws.

- (5p) **`gh pr view` resolution.** Pre-seed the `gh pr-view` mock to return `{ baseRepository: { name: "crew", owner: { login: "anthropics" } } }`. Assert the labels URL is `/repos/anthropics/crew/issues/42/labels`. (Mirrors the `applyReviewerLabels` resolution path.)

- (5q) **Tool-name camelCase assertion.** Assert the tool is registered in `register.ts` as `"runAutoMergeGate"` exactly (matches Implementation-patterns §4 naming rule).

- (5r) **`prNumber` type.** Assert the merge-path `gh` args pass `String(prNumber)` (gh expects a string CLI arg, not a number). Defensive against silent integer coercion bugs.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Add the `runAutoMergeGate` MCP tool** (AC: #1, #2, #3, #5d–5r)
  - [ ] 1.1 Create `plugins/crew/mcp-server/src/tools/auto-merge-gate.ts`. Top-level JSDoc header citing this story key, FR40, FR41, FR42, and the upstream-story lineage (4.9b for `riskTier`, 4.10 for `computeAgreement`, 4.8 for `applyReviewerLabels`-template).
  - [ ] 1.2 Export the `AutoMergeGateResult` discriminated union per AC1 unpacked (1a). One `type` declaration; eight branches.
  - [ ] 1.3 Export `RunAutoMergeGateOptions` interface mirroring `ApplyReviewerLabelsOptions`'s test-seam shape (`targetRepoRoot`, `sessionUlid`, `role`, `execaImpl`, `pluginRootOverride`).
  - [ ] 1.4 Implement `export async function runAutoMergeGate(opts: RunAutoMergeGateOptions): Promise<AutoMergeGateResult>` per the algorithm in (1b). Default `role = "orchestrator"`.
  - [ ] 1.5 Read `reviewer-result.json` via `readReviewerResultFile(targetRepoRoot, sessionUlid)`. Null-branch returns `{ next: "skipped-no-session-result" }`.
  - [ ] 1.6 Defensive verdict check — return `{ next: "skipped-not-ready-for-merge", verdict }` when `recommendedVerdict !== "READY FOR MERGE"`.
  - [ ] 1.7 Implement the riskTier branch table per (1b.3)–(1b.5) — call the local `pause(reason)` helper for medium/high/missing.
  - [ ] 1.8 For `riskTier === "low"`: load the workspace config (use the existing `resolveWorkspace` or a leaner read of `.crew/config.yaml` via the existing helper in `state/workspace-resolver.ts`). Extract `threshold = workspace.config.plugin.agreement_threshold`.
  - [ ] 1.9 Call `computeAgreement({ targetRepoRoot })` (default window). Direct function import from `lib/compute-agreement.js` — NOT through the MCP-tool boundary (matches the "lib is the canonical helper" pattern from Story 4.10).
  - [ ] 1.10 Branch on the metric: null → `pause("insufficient-data")`; `ratio < threshold` → `pause("sub-threshold")`; else → `merge()`.
  - [ ] 1.11 Local `pause(reason)` helper: resolve owner/repo via `gh pr-view <prNumber> --json baseRepository`; `gh api POST /repos/${owner}/${repo}/issues/${prNumber}/labels --input -` with body `{ "labels": ["needs-human"] }`. Return the appropriate `paused-*` branch shape.
  - [ ] 1.12 Local `merge()` helper: `gh pr-merge <prNumber> --squash --delete-branch`. Return `{ next: "merged", prNumber, agreementRatio, threshold }`.
  - [ ] 1.13 Both helpers load orchestrator permissions via `loadRolePermissions({ role, pluginRoot })` once at function entry.
  - [ ] 1.14 Propagate uncaught: `GhRecoverableError`, `GhApiResponseShapeError`, and the raw `ExecaError` for non-recoverable gh exit codes. The SKILL.md outer try/catch (Task 4) handles all of these.

- [ ] **Task 2: Register `runAutoMergeGate` in the MCP tool registry** (AC: #5q)
  - [ ] 2.1 In `plugins/crew/mcp-server/src/tools/register.ts`, append a `server.registerTool({ name: "runAutoMergeGate", ... })` block. Place it after `applyReviewerLabels` (Story 4.8) so the Epic 4 tools cluster.
  - [ ] 2.2 Input schema: `z.object({ targetRepoRoot: z.string().min(1), sessionUlid: z.string().min(1) })`. (Internal seams like `execaImpl` are not exposed at the MCP boundary.)
  - [ ] 2.3 Handler: parse input; call `runAutoMergeGate`; return `{ content: [{ type: "text" as const, text: JSON.stringify(result) }] }`.
  - [ ] 2.4 Description string: `"Decide auto-merge vs needs-human pause for the just-completed reviewer run (FR40, FR41, FR42)."`
  - [ ] 2.5 Add the import: `import { runAutoMergeGate } from "./auto-merge-gate.js";`

- [ ] **Task 3: Update `permissions/orchestrator.yaml` to allow `pr-merge`** (AC: #1, #5a)
  - [ ] 3.1 Append `- pr-merge` to the `gh_allow` list in `plugins/crew/permissions/orchestrator.yaml`. The resulting file:
    ```yaml
    role: orchestrator
    tools_allow:
      - getStatus
      - recordYield
      - heartbeat
      - readPersona
      - lookupRoleByDomain
      - runAutoMergeGate
    gh_allow:
      - pr-view
      - pr-merge
      - api
    gh_allow_args: {}
    ```
    Also add `runAutoMergeGate` to `tools_allow` so the tool layer allows the orchestrator role to invoke the MCP tool (consistent with the negative-capability enforcement from FR79–FR81). Add `api` to `gh_allow` because the pause-path uses `gh api POST .../labels`.
  - [ ] 3.2 No other permission file changes. The `generalist-reviewer` role does NOT gain `pr-merge` (FR37 negative capability preserved).

- [ ] **Task 4: Wire `runAutoMergeGate` into `start` SKILL.md** (AC: #1, #2, #3, #4, #5c)
  - [ ] 4.1 In `plugins/crew/skills/start/SKILL.md`, on the `done-ready-for-merge` branch of step 12 (currently three sub-bullets ending with "return to outer loop step 4"), insert a new step `12a` BEFORE the existing "claiming next" chat line. Shape:
    ```
    12a. invoke runAutoMergeGate({ targetRepoRoot, sessionUlid }). This call is best-effort: wrap it in a try/catch. Switch on the `next` field:
       - `merged` → emit the verbatim chat-surface line `PR #${prNumber} auto-merged (risk:low, agreement:${(agreementRatio * 100).toFixed(1)}%)`.
       - `paused-medium` → emit `PR #${prNumber} paused — risk_tier: medium`.
       - `paused-high` → emit `PR #${prNumber} paused — risk_tier: high`.
       - `paused-missing-risk-tier` → emit `PR #${prNumber} paused — risk_tier missing on reviewer-result (run pre-dates 4.9b or classifier failed)`.
       - `paused-sub-threshold` → emit `PR #${prNumber} paused — agreement ${(agreementRatio * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`.
       - `paused-insufficient-data` → emit `PR #${prNumber} paused — insufficient telemetry to compute agreement (need ≥50 resolved verdicts)`.
       - `skipped-no-session-result` → emit `auto-merge-gate skipped — no reviewer-result.json` and proceed.
       - `skipped-not-ready-for-merge` → emit `auto-merge-gate skipped — verdict was ${verdict} (defensive — should not reach here on the green branch)` and proceed.
       - If `runAutoMergeGate` throws: log `auto-merge-gate failed: <error.message>` and do NOT halt. The manifest is already in `done/`; surface the failure and proceed to the existing "claiming next" line. The operator merges manually.
    ```
  - [ ] 4.2 Keep the existing "story <ref> moved to done — claiming next" line AFTER step 12a, so the chat surface reads: gate result → claim next.
  - [ ] 4.3 Do NOT add `runAutoMergeGate` to any other branch of step 12 (`done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`, `done-blocked-no-session-result`). This is what proves AC4 — the wiring assertion in (5c) checks for absence on these branches.
  - [ ] 4.4 Add a one-line invariant note in the SKILL.md "Failure modes" section: `auto-merge-gate failure (any error from runAutoMergeGate): logged best-effort; the manifest stays in done/; the PR stays open for manual merge. FR42 override preserved.`

- [ ] **Task 5: Integration test suite — `tools/__tests__/auto-merge-gate.test.ts`** (AC: #5a–5r)
  - [ ] 5.1 Create the file. Imports: `vitest`, `node:fs/promises` as `fs`, `node:os`, `node:path`, `node:crypto`, `runAutoMergeGate` from the new module, `js-yaml` for config seeding (matches the workspace-resolver's parser).
  - [ ] 5.2 Top-level helper `seedSession(root, ulid, result)`: ensures `.crew/state/sessions/<ulid>/`; writes `reviewer-result.json` with the given shape.
  - [ ] 5.3 Top-level helper `seedConfig(root, plugin)`: writes `.crew/config.yaml` with `adapter: bmad` + `adapter_config: {stories_root: "_bmad-output/implementation-artifacts"}` + the given `plugin:` block. Required for `resolveWorkspace` to find a valid config.
  - [ ] 5.4 Top-level helper `seedTelemetry(root, events)`: writes one or more `<YYYY-MM>.jsonl` files under `.crew/telemetry/`; each event is a valid `ReviewerVerdictEvent` shape with `eventual_merge_action` resolved.
  - [ ] 5.5 Top-level helper `mkExeca(handlers)`: returns a synthetic `execa`-shaped function that dispatches on the first arg of `args` (e.g. `"pr-merge"`, `"api"`, `"pr-view"`); each handler returns `{ stdout, stderr, exitCode: 0 }` or throws. Used to assert call shapes.
  - [ ] 5.6 `beforeEach` creates a tmpdir; `afterEach` cleans via `fs.rm(..., { recursive: true })`.
  - [ ] 5.7 Implement test cases (5d) through (5r). Each `it()` is independent.
  - [ ] 5.8 The SKILL.md-wiring assertion (5c) reads `plugins/crew/skills/start/SKILL.md` directly via `fs.readFile`; uses substring checks (`.toContain(...)`) for the six chat-surface line literals and the wiring placement.
  - [ ] 5.9 The permission-file assertion (5a) reads `plugins/crew/permissions/orchestrator.yaml`; parses with `js-yaml`; asserts `gh_allow` contains `pr-merge` and `tools_allow` contains `runAutoMergeGate`.

- [ ] **Task 6: Tool-count assertion bump** (AC: all)
  - [ ] 6.1 Search the test suite for hardcoded tool counts: `grep -rn "registerTool" plugins/crew/mcp-server/src/__tests__ plugins/crew/mcp-server/src/tools/__tests__` and any `expect(...).toBe(N)` against a count. Bump by +1 for the new registration (and +1 again if Story 4.10 has already been merged before this story; the dev agent must check the current count fresh).
  - [ ] 6.2 If `acceptance.test.ts` (Story 1.1) asserts a tool count, update it and cite this story key in a JSDoc-style comment.

- [ ] **Task 7: Build, vitest, dist** (AC: all)
  - [ ] 7.1 `pnpm build` (from `plugins/crew/mcp-server/`) passes. TypeScript surfaces no errors from the new files or the widened tool-registry.
  - [ ] 7.2 All vitest tests pass — both new tests AND the existing suite. Run `pnpm vitest --run` from `plugins/crew/mcp-server/`.
  - [ ] 7.3 Confirm `canonical-fs-guard.test.ts` still passes — the new tool writes only to GitHub (via `gh`), not to canonical-state paths.
  - [ ] 7.4 Commit `dist/` per CLAUDE.md.

---

## Implementation strategy

### Why the gate runs in the orchestrator role, not the reviewer role

FR37 (negative capability) pins the reviewer subagent as unable to close, merge, or formally request changes on a PR. The gate's `gh pr merge` call is a merge — exactly the capability FR37 denies the reviewer. The gate is plugin-runtime behaviour invoked by `start` SKILL.md prose, NOT inside the reviewer subagent's context; the orchestrator role is the correct attribution. Task 3 adds `pr-merge` to `orchestrator.gh_allow`. The reviewer's permission file is unchanged.

### Why the gate runs AFTER `completeStory` (not before)

`processReviewerTranscript`'s `READY FOR MERGE` branch calls `completeStory` internally and moves the manifest `in-progress/ → done/` (Story 4.3c). The gate fires AFTER this move. Rationale: the reviewer's verdict is what makes the story "done" in the plugin's queue model; the actual GitHub-side merge is an effect of that decision, and may legitimately fail (CI red, merge conflict, branch protection). If the gate ran BEFORE the manifest move and `gh pr merge` failed, the manifest would stay in `in-progress/` with no clear state-machine recovery — the operator would have to manually flip the manifest. With the chosen ordering, the manifest is in `done/` regardless of merge outcome; failures surface as a chat line and the operator's manual `gh pr merge` is the recovery (FR42).

### Why "skipped-not-ready-for-merge" is a return branch, not an error

The MCP tool boundary means `runAutoMergeGate` is callable from any session. Treating "called on a non-green verdict" as an error punishes the future operator-CLI caller (deferred work). Treating it as a return branch preserves FR42's spirit — the user can manually merge anything; the gate just doesn't help on non-green branches. SKILL.md never reaches this branch under v1 wiring; AC5 unpacked (5i) asserts that.

### Why "missing-risk-tier" pauses (rather than treats as low)

The classifier (Story 4.9b) stamps `riskTier` on `reviewer-result.json` for every reviewer run. An absent field means either (a) the record was written before 4.9b shipped (historical) or (b) the classifier crashed (a bug). In both cases, "we don't know the risk" is the truth; defaulting to "low" would silently auto-merge a possibly-high-risk change. Fail-closed: pause with the explicit reason so the operator can investigate. Treating it as "high" would also be safe but would conflate two distinct surface lines ("classifier said high" vs "classifier didn't run"); the operator's diagnosis differs.

### Why squash + delete-branch (not configurable in v1)

Jack's `CLAUDE.md` rule pins squash-merge ("never commit to local main — squash-merge causes divergence"); the rule is a project invariant. Delete-branch keeps the remote branch list small and matches the typical post-merge cleanup. v1 ships these as hardcoded args. A future story exposes them as `plugin.merge_method` / `plugin.delete_branch_on_merge` config if a different target repo's conventions demand it (deferred).

### Why the surface lines are composed in SKILL.md, not in the tool

The tool returns a structured discriminated union (`AutoMergeGateResult`); SKILL.md composes the operator-visible chat line. This split mirrors the `processReviewerTranscript` / `applyReviewerLabels` pattern — tools return structured data; the prose layer renders. Benefits: the tool stays unit-testable without string-equality assertions on chat lines; SKILL.md changes can re-word the lines without touching the tool; the same tool serves a future CLI surface (deferred) that may render differently.

### Why `applyReviewerLabels` is not extended to handle the paused-from-gate case

`applyReviewerLabels` runs at step 10a — AFTER the reviewer comments are posted but BEFORE `processReviewerTranscript` (which calls `completeStory`). It can't know the gate's decision because the gate hasn't fired yet. Extending it to "also call computeAgreement and decide on needs-human" would inline the gate's responsibility into the labels tool and conflate two different decision points. Keeping the gate as its own tool, running its own label apply on its own branches, is cleaner.

### Why no `gh-error-map.yaml` entry for "already-merged"

`gh pr merge` on an already-merged PR exits non-zero with stderr like `Pull request #N is already merged`. Classifying this signature as `recoverable: true, treat_as: success` requires a stable error-message pattern; gh's output is not formally versioned and may change across releases. v1 surfaces the raw error; the operator reads "already merged" and ignores it. A future story may add the classifier entry once the pattern is observed in practice (and once a test fixture pins gh's exact output for the version range we support).

---

## Locked files

These files are off-limits to this story. If a change appears necessary, STOP and surface the conflict — do not silently edit.

- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` (Story 4.1 / 4.2)
- `plugins/crew/mcp-server/src/tools/claim-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Stories 4.6 / 4.9b)
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Stories 4.6 / 4.3c)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Stories 4.6b / 4.7)
- `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts` (Story 4.8) — the labels tool's responsibility is unchanged; this story adds a SECOND label-apply path (in the new gate tool), not an extension of the existing one.
- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts` (Story 4.4 / 4.8b)
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Stories 4.3b / 4.5 / 4.6 / 4.8b)
- `plugins/crew/mcp-server/src/lib/compute-agreement.ts` (Story 4.10) — consumed via direct function import; not modified.
- `plugins/crew/mcp-server/src/lib/team-stats.ts` (Story 2.6) — not modified.
- `plugins/crew/mcp-server/src/lib/logger.ts` (Story 1.5) — no telemetry emission in v1.
- `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` (Stories 1.5 / 4.10) — no schema change.
- `plugins/crew/mcp-server/src/schemas/execution-manifest.ts` (Stories 3.2 / 4.9b) — no schema change; the manifest's `risk_tier` field is added by 4.9b, consumed indirectly via `reviewer-result.json`.
- `plugins/crew/mcp-server/src/schemas/workspace-config.ts` (Story 1.2) — the `plugin.agreement_threshold` field is already on the schema with default 0.8.
- `plugins/crew/permissions/generalist-reviewer.yaml` (Stories 2.2 / 4.6 / 4.7 / 4.8) — FR37 negative capability preserved; no `pr-merge` grant to the reviewer.
- `plugins/crew/permissions/generalist-dev.yaml` (Stories 2.2 / 4.4) — no change.
- `_bmad-output/planning-artifacts/**` — no planning-artifact changes; the spec lives here as a story file, not as a PRD/architecture edit.

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/tools/register.ts`** (touched by most Epic-1 through Epic-4 stories) — Task 2 appends a `runAutoMergeGate` registration. No existing registration is modified. Tool-count assertions (if present elsewhere) are bumped by Task 6.
- **`plugins/crew/permissions/orchestrator.yaml`** (Stories 2.2) — Task 3 appends `pr-merge` and `api` to `gh_allow` and `runAutoMergeGate` to `tools_allow`. No existing entries are removed or modified.
- **`plugins/crew/skills/start/SKILL.md`** (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7 / 4.8) — Task 4 inserts a new step `12a` on the `done-ready-for-merge` branch and adds one line to "Failure modes". No existing step is removed or re-ordered.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/tools/auto-merge-gate.ts` (Task 1)
- `plugins/crew/mcp-server/src/tools/__tests__/auto-merge-gate.test.ts` (Task 5)

### Files this story will modify

- `plugins/crew/mcp-server/src/tools/register.ts` (Task 2; new import + new registerTool call)
- `plugins/crew/permissions/orchestrator.yaml` (Task 3; `gh_allow` and `tools_allow` appends)
- `plugins/crew/skills/start/SKILL.md` (Task 4; new step 12a + one Failure-modes line)
- Any test file holding a hardcoded MCP tool count (Task 6; identified via grep)
- `plugins/crew/mcp-server/dist/` (Task 7.4; rebuild and commit)

### Current-state notes on files being modified

- **`tools/register.ts`** (current state per Story 4.8): contains the Epic-4 cluster of registrations including `applyReviewerLabels`. Pattern is consistent — each registration is its own `server.registerTool({...})` block with name, description, inputSchema, and handler. Task 2 appends one more in the same shape, placed immediately after the `applyReviewerLabels` block so the gate sits next to the labels tool it pairs with.
- **`permissions/orchestrator.yaml`** (current state per Story 2.2): five `tools_allow` entries (getStatus, recordYield, heartbeat, readPersona, lookupRoleByDomain) and a single-entry `gh_allow` (`pr-view`). Task 3 appends `runAutoMergeGate` to `tools_allow` and `pr-merge` + `api` to `gh_allow`.
- **`skills/start/SKILL.md`** (current state per Story 4.8): step 12 has a four-branch switch with sub-bullets. The `done-ready-for-merge` branch's three sub-bullets cover (1) confirming `completed: true`, (2) emitting `story <ref> moved to done — claiming next`, (3) returning to outer loop step 4. Task 4 inserts a new step 12a between (1)/(2) and the existing chat line — the gate fires after the manifest is confirmed in done/ but before the surface line.

### Testing standards

- vitest with `pnpm vitest --run` from `plugins/crew/mcp-server/`.
- `os.tmpdir() + crypto.randomUUID()` for tmpdir fixtures; `fs.rm(..., { recursive: true })` in `afterEach`.
- No real `gh` calls — `execaImpl` test seam mocks every gh invocation.
- No global mocks. No clock mocking.
- Per-test seeded `.crew/config.yaml` is required for `resolveWorkspace` to succeed; the default-threshold tests still need to write a minimal config (without a `plugin:` block — the schema applies the 0.8 default).
- The SKILL.md-wiring test (5c) reads the live SKILL.md file from disk; it asserts substrings, not full-line equality. If the SKILL.md prose is re-worded in a future story, the assertion needs updating — that's intentional, it's a coupling between SKILL.md and the wiring contract.

### Dependencies

- Story 4.10 (`computeAgreement` helper) — consumed via direct function import. The gate calls `computeAgreement({ targetRepoRoot })` with the default window.
- Story 4.9b (`riskTier` on `ReviewerResultFileShape`, `risk_tier` on the manifest) — consumed via `result.riskTier` read off `reviewer-result.json`.
- Story 4.8 (`applyReviewerLabels` + `lib/gh.ts` + `gh-error-map.yaml`) — pattern source for the pause-path label apply; the gate copies the `gh pr-view --json baseRepository` resolution shape verbatim.
- Story 4.6 (`reviewer-result.json` shape) — the canonical session-file transport.
- Story 4.3c (`processReviewerTranscript` calls `completeStory`) — the manifest is in `done/` by the time the gate runs.
- Story 1.2 (`WorkspaceConfigSchema.plugin.agreement_threshold`) — the threshold's single source of truth.
- FR40 / FR41 / FR42 (`prd-crew-v1/functional-requirements.md` lines 59–62) — the contract.
- Architecture (§ project-structure-boundaries.md line 235, the "data flow step 8") — pins the gate's place in the per-story flow.

### Downstream consumers / future work

- Story 4.12: May emit a `gate.decision` telemetry event for retro analysis. Not in scope here.
- Epic 5: Orchestration / polling. A future story may surface "PRs awaiting human merge" via `/crew:status`.
- Epic 6 retros: The agreement metric the gate consumes is itself the input to the retro's "is the reviewer reliable" question. The gate's decisions become observable through telemetry once 4.12 ships the emission.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.10b`]
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] (FR40, FR40a, FR41, FR42)
- [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`] (data-flow step 8)
- [Source: `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md`] (line 235, "Low-risk + agreement-metric-clears → auto-merge via `gh pr merge`")
- [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md`] (§ 4 MCP Tool Naming)
- [Source: `_bmad-output/implementation-artifacts/4-10-agreement-metric-helper-compute-agreement.md`] (sibling spec — pinned the `compute-agreement` contract this story consumes)
- [Source: `_bmad-output/implementation-artifacts/4-9b-risk-tier-classifier-code-evidence-stamping-and-fallback.md`] (sibling spec — pinned the `riskTier` field on `reviewer-result.json`)
- [Source: `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts`] (pattern source for the pause-path label apply and the gh pr-view resolution)
- [Source: `plugins/crew/mcp-server/src/schemas/workspace-config.ts`] (`plugin.agreement_threshold` source-of-truth)
- [Source: `plugins/crew/permissions/orchestrator.yaml`] (the file Task 3 modifies)
- [Source: `plugins/crew/skills/start/SKILL.md`] (the file Task 4 modifies; step 12's `done-ready-for-merge` branch is the wiring site)
- [Source: `plugins/crew/docs/user-surface-acs.md`] (substrate-vs-user-surface judgement)
- [Source: CLAUDE.md] (squash-merge rule pinning `--squash --delete-branch`)

---

## Previous story intelligence

### From Story 4.10 (just-authored — direct upstream)

- The `computeAgreement` helper returns `AgreementMetric | null`. The gate's null branch (`paused-insufficient-data`) consumes this contract directly — see Story 4.10's "Why the helper returns `AgreementMetric | null` (not `{ ratio: null, ... }`)" rationale, which makes the gate's one-liner `if (metric === null) return pause("insufficient-data")` the intended call site.
- The helper is intentionally a `lib/` direct-import for in-process callers; this gate is the first such caller and validates the design choice.

### From Story 4.9b (just-authored — direct upstream)

- `ReviewerResultFileShape` gained `riskTier?: "low" | "medium" | "high"`. The gate reads exactly this field; absence triggers the `paused-missing-risk-tier` defensive branch.
- The classifier stamps both the in-progress manifest and the session result file with the same value. The gate prefers the session file for the reasons in NOT (k) above.

### From Story 4.8 (shipped — pattern lineage)

- `applyReviewerLabels` is the template for the pause-path: resolve owner/repo via `gh pr-view --json baseRepository`; apply labels via `gh api POST /repos/{owner}/{repo}/issues/{n}/labels`. The gate copies this pattern verbatim (different label name, same shape).
- Best-effort posture: label-apply failures don't halt the outer flow; the manifest is canonical and recovery is operator-driven. The gate inherits this posture in SKILL.md's try/catch.

### From Story 4.3c (shipped — manifest-move ordering)

- `processReviewerTranscript` on the READY FOR MERGE branch calls `completeStory` BEFORE returning. The manifest is in `done/<ref>.yaml` by the time SKILL.md's step 11 surfaces chatLog; the gate fires at step 12a after that. The gate makes no manifest-move call.

### From Story 4.7 (shipped — version-stamp convention)

- The verdict comment carries `standards_version` and `plugin_version`. These are not consumed by the gate (the decision rests on verdict + riskTier + agreement); they remain forensically useful in the comment body and in the `reviewer.verdict` telemetry event that Story 4.12 will write.

### From Story 4.6 (shipped — `reviewer-result.json` shape)

- The session-file is the verdict transport. The gate reads it via the existing `readReviewerResultFile` helper (no new IO surface).

### Git intelligence (recent commits)

```
b5e3dac spec(4-12): author spec for per-invocation telemetry and runtime soft/hard limits (#131)
79c492e spec(4-11): author spec for yield protocol — locked phrase, domain routing, in-domain insistence (#132)
0b07f7d spec(4-10): author spec for agreement-metric helper + sprint-status tidy (#130)
940f4db feat(3): BMad adapter leniency for real-world BMad backlogs (#129)
9b7bbe0 spec(4-9b): author spec for risk-tier classifier, evidence stamping, and fallback (#123)
```

Pattern: spec commits follow `spec(<key>): <subject>`. This story's spec commit will follow `spec(4-10b): author spec for auto-merge gate, medium/high pause, and user override`.

---

## Retro Amendments — 2026-05-25

Added during the mid-epic-4 retrospective ([epic-4-retro-2026-05-25.md](epic-4-retro-2026-05-25.md), carry-forward #6). The original AC1–AC5 above were validated and remain unchanged; the AC below is additive.

**AC6 (substrate) — Medium+ findings cannot reach `merged` without an explicit override:**
**Given** a PR with `verdict: READY FOR MERGE` and `risk_tier: low` and `agreement_metric ≥ threshold`,
**When** `reviewer-result.json` contains any finding with `severity ∈ {"medium", "high"}` AND `reviewer-result.json.overrideToken` is absent or empty,
**Then** `runAutoMergeGate` returns `{ next: "paused-residual-medium-or-higher", prNumber, residuals: { medium: number, high: number } }` and emits chat line `PR #${prNumber} paused — ${count} unresolved medium/high finding(s)`.

**Why:** PR #109 carried a Medium-severity reviewer finding (PR-URL regex unanchored) across two PRs because no gate enforced override. The auto-merge gate is the right tool-layer seam for this rule. `overrideToken` is a string the operator writes into `reviewer-result.json` (out-of-band, via a future MCP tool or by hand) to explicitly accept the residuals; v1 has no override-set tool — the operator hand-edits.

**Schema impact:** `reviewer-result.json` gains an optional `overrideToken?: string`. Existing readers tolerate the extra field (zod `.passthrough()` or explicit `.optional()`). No migration needed.

**Out of scope for this story:** an MCP tool to write `overrideToken` (deferred — operator hand-edits for now). The chat surface for "how to override" — captured in the line text only.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
