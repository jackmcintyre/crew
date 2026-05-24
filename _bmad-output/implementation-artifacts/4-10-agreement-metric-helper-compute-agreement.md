# Story 4.10: Agreement metric helper (`compute-agreement`)

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin maintainer**,
I want **a deterministic `computeAgreement` helper that reads `.crew/telemetry/<YYYY-MM>.jsonl`, scans `reviewer.verdict` events, and reports the rolling verdict-vs-action agreement ratio over a configurable window (default `last_n_verdicts: 50`), excluding events whose `eventual_merge_action` has not yet resolved**,
so that **the auto-merge gate in Story 4.10b has a single measurable input (the helper's `ratio` return field) to decide whether the reviewer has earned auto-merge authority, rather than a hardcoded threshold or a vibes call — with `null` returned when the window has insufficient resolved data, so the gate can fail-closed rather than auto-merge on a sub-window**.

### What this story is, in one sentence

Add `computeAgreement` (pure-ish IO function in `lib/`, plus a `computeAgreement` MCP tool wrapper) that scans `<targetRepoRoot>/.crew/telemetry/*.jsonl` for `reviewer.verdict` events, filters out unresolved events, computes a verdict-vs-action agreement ratio over the most-recent `last_n_verdicts` resolved events, and returns `{ ratio, agreementCount, windowSize, distribution, malformedLines, malformedFiles }` — or `null` when fewer than `last_n_verdicts` resolved events exist; widen `schemas/telemetry-events.ts` additively with a `ReviewerVerdictEventSchema` joining the discriminated union; mirror the `lib/team-stats.ts` template's ENOENT handling and per-line malformed counters.

### What this story does (and why it needs its own story)

Story 1.5 shipped the telemetry writer; Story 2.6 shipped the FIRST reader (`readTeamTelemetryStats` — fire counts only). Architecture's stats-helper paragraph (`core-architectural-decisions.md` § Telemetry & Observability) pins three stats helpers: `readTeamTelemetryStats` (shipped), `computeAgreement` (this story), and `computeOutcomeStats` (Story 6.x). The `team-stats.ts` docstring states explicitly: *"v1 template for Epic 6's `computeOutcomeStats` and `computeAgreement` helpers — keep small and single-purpose."* This story is that template's first reuse.

Three reasons the agreement helper is its own story rather than folded into 4.10b (the auto-merge gate):

1. **Different review surface.** The helper is a pure aggregator: read JSONL, validate per-line, walk a sliding window, count matches. The auto-merge gate is a decision tree with `gh pr merge` side effects, label writes, and surface-line composition. Reviewing them under one PR doubles the burden — and the helper's test surface (telemetry-shape edge cases, window arithmetic, malformed-line tolerance) is large enough on its own.

2. **Telemetry schema widening lands here, not in 4.10b.** The existing `TelemetryEventSchema` discriminated union admits only `agent.invoke` and `telemetry.invalid` in v1. The reviewer-verdict event schema MUST land before any consumer can read those events. Co-locating the schema with its first reader keeps the writer (Story 4.12) and the gate (Story 4.10b) free of schema-design work.

3. **The "returns `null`" contract is load-bearing.** AC2 (verbatim from the epic) requires `null` for empty / sub-window telemetry. The gate's behaviour on `null` is "pause with insufficient-data reason" (Story 4.10b AC3). Pinning the null contract in this story — including the precise definition of "sub-window" (resolved-events count < `last_n_verdicts`) — gives 4.10b a stable contract to depend on.

This story explicitly DOES widen the telemetry-events schema (additively — `ReviewerVerdictEventSchema` joins the union). The schema is `.strict()` on every event payload (Story 1.5 invariant); this widening preserves that.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Add a CLI command wrapper around `computeAgreement`. Architecture's stats-helpers row says *"exposed as MCP tools **and** CLI commands"* — v1 of this story lands the MCP tool only. A CLI wrapper (e.g. `crew compute-agreement`) is a cheap follow-up but adds a new install surface (slash-command discovery, help text, exit codes) that has no v1 caller. The auto-merge gate (Story 4.10b) and any future operator-facing visibility (Story 5.x) both call the MCP tool. Deferred to a follow-up if/when an operator typing the command directly becomes a real workflow.
- (c) Implement the WRITER of `reviewer.verdict` events. Story 4.12 owns wiring `runReviewerSession` (and / or `postReviewerComments`) to emit a `reviewer.verdict` JSONL event after every posted verdict comment. This story SHIPS the event schema but does NOT call `logTelemetryEvent` from any reviewer code path. The schema is consumed by 4.12 verbatim; no schema change is needed in 4.12.
- (d) Backfill `eventual_merge_action` retroactively when a PR closes. The reviewer comment is written when the verdict is posted (PR still open); the eventual merge action (`merged` / `closed-without-merge` / `superseded-by-rework`) is only known later. v1 of this story treats `eventual_merge_action: null` as "unresolved → exclude from the window". The watch-loop that backfills the field after PR close is owned by Story 4.12 (or a future Epic 5 story that adds a `gh pr-list --state closed` poll). v1 helper does not write telemetry — it only reads.
- (e) Implement the auto-merge gate itself. Story 4.10b consumes this helper's return value. In v1 of this story, NOTHING reads `computeAgreement`'s output other than its own tests and an operator who calls the MCP tool directly.
- (f) Filter the window by `risk_tier`. The epic does not require per-tier filtering; the metric is repo-wide across all verdicts. (Operators may eventually want "agreement on low-tier PRs only" as a more permissive auto-merge gate — that is deferred work. v1 computes ONE ratio across all `reviewer.verdict` events.)
- (g) Cache the helper's output across calls. Each invocation re-reads the JSONL files, re-scans, re-walks the window. The file set is small (one file per month; v1 deployments will have at most a handful) and the helper runs at most once per auto-merge decision. A future story can add caching if profiling shows it matters; v1 stays simple. (Matches the `team-stats.ts` precedent — no caching there either.)
- (h) Resolve a window of fewer than `last_n_verdicts` by relaxing to "use what we have". The contract is strict: if `resolvedCount < last_n_verdicts`, return `null`. The auto-merge gate is the place to interpret null (it pauses with `insufficient-data`); the helper does not silently degrade the contract.
- (i) Allow a `last_n_verdicts` value of `0` or negative. The input schema enforces `last_n_verdicts: z.number().int().positive()` with default 50. A caller passing `0` or `-1` gets a Zod validation error at the MCP-tool boundary (consistent with every other tool's input validation).
- (j) Include `BLOCKED` verdicts in the agreement matrix differently from `NEEDS CHANGES`. Both verdicts are "the reviewer said do-not-merge"; both agree with the actions `closed-without-merge` and `superseded-by-rework`; both disagree with `merged`. The matrix is pinned in AC1 unpacked (1d) below.
- (k) Validate that `standards_version` / `plugin_version` on a `reviewer.verdict` event match the current running plugin. Version fields are recorded for forensic value (Story 4.7 / NFR22); the agreement helper treats them as opaque strings. A future telemetry-replay tool may filter by version; this story does not.
- (l) Emit a telemetry event when the helper runs. The helper is a pure reader; no `compute.agreement` event type exists. If observability of "how often the gate consults the metric" becomes interesting, that is a future Story 4.12-adjacent emission, not this story.
- (m) Update or modify the existing `readTeamTelemetryStats` function or `team-stats.ts`. This story imports `TelemetryEventSchema` from the schemas module (now widened) but does NOT touch `team-stats.ts`. The two helpers coexist; both follow the same template.
- (n) Persona / role permission spec changes. The helper reads files via `fs.readFile` under `<targetRepoRoot>/.crew/telemetry/`; it makes no `gh` call and no canonical-state write. No `permissions/*.yaml` file needs updating. (`canonical-fs-guard.test.ts` continues to pass because no new write path is added.)
- (o) Surface `computeAgreement`'s output in `/crew:status` or any operator-facing slash command. Operator visibility in v1 is via the MCP tool's text response only (which is what Story 4.10b's gate will render into its surface line). A future Epic 5 story may add a `/crew:agreement` operator command; out of scope here.
- (p) Persist the computed ratio anywhere (e.g. `.crew/state/agreement.json`). The helper is pure-read; every call recomputes from JSONL. State persistence would invite staleness bugs (computed before the latest backfill) for negligible runtime savings.
- (q) Detect or reject `reviewer.verdict` events that pre-date the schema widening. v1 deployments have NO existing `reviewer.verdict` events (Story 4.12 is the writer and ships after this story). The schema widening is additive; if a legacy event with a different shape somehow exists, it surfaces as a malformed line (handled per (1g) below) — exactly the behaviour `team-stats.ts` ships for any other malformed line.
- (r) Touch the existing `AgentInvokeEventSchema` or `TelemetryInvalidEventSchema`. The discriminated union grows by one member; the existing members are unchanged. `readTeamTelemetryStats` continues to ignore non-`agent.invoke` valid events (it explicitly opts in via a `type === "agent.invoke"` branch); the widening adds another type the function will encounter and tolerate without counting it as malformed.
- (s) Re-export `TelemetryEvent` (or any union member) from `lib/compute-agreement.ts`. The classifier-style separation stays: schemas live in `schemas/`, IO functions live in `lib/`. Callers that want the type import it from the schema module.

### Deferred work

- **CLI wrapper.** A `crew compute-agreement [--last-n N] [--target-repo PATH]` command surfacing the same return value as JSON or a one-liner. Cheap to add once an operator-typed workflow exists. Architecture's stats-helpers row will then be satisfied in full ("MCP tools and CLI commands").
- **Per-tier agreement filter.** A `risk_tier` parameter narrowing the window to events with a matching stamp. Useful once the team has enough verdict volume that per-tier behaviour diverges. Adds a `risk_tier?` field on the `reviewer.verdict` event payload; v1 schema does not include it (the field can be added additively in a future story without breaking the v1 reader).
- **Eventual-action backfill loop.** A `gh pr list --state closed --search "label:crew"` poll that finds resolved PRs whose `reviewer.verdict` events still carry `eventual_merge_action: null` and rewrites the JSONL line in place (or appends a follow-up `reviewer.verdict.resolved` event — design decision deferred). Owned by Story 4.12 (which ships the writer) or a successor.
- **Time-windowed mode.** Instead of "last N verdicts", an alternative `since: ISO-8601` parameter computing agreement over a calendar window. Deferred until a user-research signal demands it.
- **Caching.** A per-process or filesystem-backed cache of the parsed window. Profiling-driven; v1 stays cache-free.

---

## Acceptance Criteria

> AC1, AC2, AC3 are verbatim from the epic. AC4 is the integration suite. Per `plugins/crew/docs/user-surface-acs.md`, this story is **substrate**: the deliverable is an internal MCP tool consumed only by the future Story 4.10b auto-merge gate. There is no slash command, no operator-typed CLI command, no install-doc-cited path, and no Claude Code UI element in v1. Per the rubric's strict-membership rule (i)–(iv), no AC triggers the `(user-surface)` tag.

**AC1:**
**Given** the telemetry log with `reviewer.verdict` events carrying both `verdict` and `eventual_merge_action`,
**When** `compute-agreement` runs over a configurable rolling window (default `last_n_verdicts: 50`),
**Then** it returns a pure deterministic ratio (agreement count / window size) along with the window's verdict distribution. _(FR67, NFR24)_

<!-- Not user-surface: AC1 describes the return shape of an internal MCP tool / pure function. No operator types the tool name in v1; the auto-merge gate (Story 4.10b) is the v1 caller. -->

**AC2:**
**Given** an empty or sub-window telemetry log,
**When** the helper runs,
**Then** it returns `null` (insufficient data) rather than a misleading zero. _(NFR24)_

<!-- Not user-surface: AC2 describes the null-return branch of the same internal helper. -->

**AC3:**
**Given** a `reviewer.verdict` event whose `eventual_merge_action` has not yet been resolved (PR still open),
**When** the helper computes,
**Then** the unresolved event is excluded from the window. _(FR67)_

<!-- Not user-surface: AC3 describes window-membership semantics of the internal helper. -->

**AC4 (integration):**
vitest seeds telemetry across (a) a fully-resolved window, (b) a partially-resolved window, (c) an empty log; the helper returns the expected values.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

### Expanded acceptance specifics (folded into AC1–AC4 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** Helper contract, agreement matrix, and return shape:

- (1a) **Function signature.** `computeAgreement(opts: { targetRepoRoot: string; lastNVerdicts?: number }): Promise<AgreementMetric | null>` where:
  ```ts
  type AgreementMetric = {
    ratio: number;                  // agreementCount / windowSize, in [0, 1]
    agreementCount: number;         // integer; count of resolved verdicts that agreed with eventual action
    windowSize: number;             // integer; equals the resolved `lastNVerdicts` parameter (exactly)
    distribution: {
      READY_FOR_MERGE: number;      // count of verdicts of this type in the window
      NEEDS_CHANGES: number;
      BLOCKED: number;
    };
    malformedLines: number;         // total JSONL lines that failed JSON.parse or Zod validation
    malformedFiles: number;         // count of files containing >= 1 malformed line
  };
  ```
  `lastNVerdicts` defaults to `50` when omitted. Negative or zero values are rejected at the MCP-tool boundary (Zod `.int().positive()`); the pure function itself is called by validated callers and may assume `lastNVerdicts >= 1`.

- (1b) **JSONL scan algorithm — mirrors `lib/team-stats.ts` exactly.** The function:
  1. Resolves `telemetryDir = <targetRepoRoot>/.crew/telemetry`.
  2. `fs.readdir(telemetryDir)`. On ENOENT → return `null` (no telemetry directory means no resolved events).
  3. For each entry matching `^\d{4}-\d{2}\.jsonl$` (same `MONTH_BUCKET_REGEX` as `team-stats.ts` — copy the constant verbatim into the new module; do NOT import across `lib/` files for a 30-byte regex).
  4. Read the file; split on `\n`; for each non-empty line: `JSON.parse` → `TelemetryEventSchema.safeParse`. On JSON or Zod failure, increment `malformedLines` and set `fileHasMalformation = true`. On success, if `result.data.type === "reviewer.verdict"`, append to a local `verdictEvents: ReviewerVerdictEvent[]` array.
  5. After each file: if `fileHasMalformation`, increment `malformedFiles`.
  6. Iteration order across files MUST be sorted lexicographically (so the chronological ordering by month-bucket name is preserved — `2026-04.jsonl` < `2026-05.jsonl`). Within a file, line order is preserved (JSONL is append-only per Story 1.5).

- (1c) **Window selection.** After scan completes:
  1. Filter `verdictEvents` to those with `data.eventual_merge_action !== null` (the RESOLVED set).
  2. If `resolved.length < lastNVerdicts`, return `null` (AC2 — sub-window).
  3. Take the LAST `lastNVerdicts` resolved events (the most-recent N by file-order-of-arrival). This is `window = resolved.slice(-lastNVerdicts)`.
  4. `windowSize === lastNVerdicts` exactly. (The contract is: the window is full or null; there is no partial window.)

- (1d) **Agreement matrix (pinned).** For each event in `window`, agreement is:
  | verdict | eventual_merge_action | agreement |
  |---|---|---|
  | `READY FOR MERGE` | `merged` | ✓ agree |
  | `READY FOR MERGE` | `closed-without-merge` | ✗ disagree |
  | `READY FOR MERGE` | `superseded-by-rework` | ✗ disagree |
  | `NEEDS CHANGES` | `merged` | ✗ disagree |
  | `NEEDS CHANGES` | `closed-without-merge` | ✓ agree |
  | `NEEDS CHANGES` | `superseded-by-rework` | ✓ agree |
  | `BLOCKED` | `merged` | ✗ disagree |
  | `BLOCKED` | `closed-without-merge` | ✓ agree |
  | `BLOCKED` | `superseded-by-rework` | ✓ agree |
  Rationale: the reviewer says either "merge this" or "do-not-merge this"; the eventual action says either "the PR merged" or "the PR did NOT merge". Agreement is the match between those two binary signals. `NEEDS CHANGES` and `BLOCKED` are functionally the same on the agreement axis — both are do-not-merge verdicts; the distribution counter keeps them separate for forensic value.

- (1e) **`ratio` arithmetic.** `ratio = agreementCount / windowSize`. Because `windowSize === lastNVerdicts >= 1`, the divisor is never zero. `ratio` is a JavaScript Number; no rounding is applied. (Callers display it formatted; the helper returns the raw value.)

- (1f) **`distribution` shape.** Sum of distribution values MUST equal `windowSize`. The keys are EXACTLY `READY_FOR_MERGE`, `NEEDS_CHANGES`, `BLOCKED` — underscored variants of the verdict literals (the verdict literals contain spaces; the keys cannot). The mapping `"READY FOR MERGE" → "READY_FOR_MERGE"` etc. is fixed and tested.

- (1g) **Malformed-line tolerance.** `malformedLines` and `malformedFiles` are SURFACED on the return value but do NOT cause the helper to abort. A run with 99 valid events and 1 malformed line still returns a metric if 99 ≥ `lastNVerdicts`. The contract mirrors `team-stats.ts`: read what you can, tell the caller what you couldn't, never throw on a single bad line. Genuine filesystem errors (EACCES on a file mid-read after readdir succeeded) propagate uncaught — they indicate environmental failure, not data corruption.

- (1h) **`reviewer.verdict` schema (additive — joins the discriminated union).** `schemas/telemetry-events.ts` gains:
  ```ts
  export const ReviewerVerdictEventSchema = TelemetryEventBase.extend({
    type: z.literal("reviewer.verdict"),
    data: z
      .object({
        pr_number: z.number().int().positive(),
        verdict: z.enum(["READY FOR MERGE", "NEEDS CHANGES", "BLOCKED"]),
        standards_version: z.string().min(1),
        plugin_version: z.string().min(1),
        eventual_merge_action: z
          .enum(["merged", "closed-without-merge", "superseded-by-rework"])
          .nullable(),
      })
      .strict(),
  }).strict();
  ```
  And the discriminated union grows by one entry:
  ```ts
  export const TelemetryEventSchema = z.discriminatedUnion("type", [
    AgentInvokeEventSchema,
    TelemetryInvalidEventSchema,
    ReviewerVerdictEventSchema,
  ]);
  ```
  `TelemetryEvent` is re-inferred from the widened union; existing callers (`logTelemetryEvent`, `readTeamTelemetryStats`) compile unchanged because the union grew, not shrunk. The `ReviewerVerdictEvent` type is exported alongside for the helper to import.

- (1i) **Verdict string literals match the locked verdict-line grammar.** Story 4.6b's locked grammar uses literal phrases `READY FOR MERGE`, `NEEDS CHANGES`, `BLOCKED` in verdict-line output. The schema enum here uses the same literals (with spaces). The writer (Story 4.12) is responsible for extracting these from the verdict comment and emitting them verbatim into the JSONL `data.verdict` field; this story does NOT translate or canonicalise them.

**AC2 unpacked.** Null-return semantics:

- (2a) **Trigger conditions.** Return `null` when ANY of:
  - Telemetry directory missing (`fs.readdir` ENOENT).
  - Telemetry directory present but contains no `^\d{4}-\d{2}\.jsonl$` files.
  - JSONL files present but contain zero valid `reviewer.verdict` events.
  - Valid `reviewer.verdict` events exist but ALL have `eventual_merge_action: null` (unresolved).
  - Resolved `reviewer.verdict` events exist but `resolved.length < lastNVerdicts`.

- (2b) **Return type.** The function returns `AgreementMetric | null`. The null branch carries NO companion fields — no `malformedLines`, no partial counts. Rationale: a caller that gets `null` should not be tempted to read a partial result. If a future story wants to surface "how close to a window were we", it can return `{ ratio: null, ... }` instead; v1 is strict null.

- (2c) **Distinct from a zero ratio.** `ratio: 0` (the reviewer was wrong on every resolved verdict in the window) is a valid, fully-populated `AgreementMetric` — the gate should pause with sub-threshold, not with insufficient-data. `null` is the insufficient-data branch. The auto-merge gate (Story 4.10b) treats these distinctly.

- (2d) **Malformed lines do not contribute to "had data".** A telemetry directory containing only malformed lines returns `null` (no resolved verdicts) — but a future operator-facing surface that reads `malformedLines` to flag corruption is a separate concern; this story does not expose malformed counts on the null branch (per (2b)). The (1g) tolerance ensures malformed lines don't prevent valid data from being processed when both are present.

**AC3 unpacked.** Unresolved-event exclusion:

- (3a) **Definition of unresolved.** `event.data.eventual_merge_action === null`. The schema declares the field as `.nullable()`; the writer (Story 4.12) emits `null` at verdict-post time (PR still open) and a future backfill loop overwrites with one of `"merged" | "closed-without-merge" | "superseded-by-rework"` when the PR closes.

- (3b) **Filtering happens BEFORE windowing.** The algorithm filters to `resolved` first, then takes the trailing `lastNVerdicts` slice. This means: 100 valid events, 60 resolved, `lastNVerdicts: 50` → window is the most-recent 50 RESOLVED events (not the most-recent 50 events with 10 dropped). The `windowSize` is always exactly `lastNVerdicts` (or null).

- (3c) **Unresolved events do NOT contribute to malformed counts.** They are valid (the schema allows `eventual_merge_action: null`); they are simply outside the agreement-eligible set. `malformedLines` is for JSON-parse / Zod failures only.

- (3d) **Edge case — most recent event is unresolved.** If the freshest event is `eventual_merge_action: null` and the prior 50 are all resolved, the window is those prior 50; the unresolved one is excluded entirely. The helper does NOT wait, does NOT block, does NOT poll — it reads what's on disk and answers.

**AC4 unpacked.** Integration suite scope:

- (4a) **Test-file layout.** Three vitest test files:
  - `plugins/crew/mcp-server/src/lib/__tests__/compute-agreement.test.ts` — primary integration suite covering the three epic scenarios (fully-resolved, partially-resolved, empty) plus edge cases.
  - `plugins/crew/mcp-server/src/tools/__tests__/compute-agreement.test.ts` — MCP-tool-boundary tests: input validation, error envelope, output-shape pass-through.
  - `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events.test.ts` — extend (or create) to cover the new `ReviewerVerdictEventSchema` parse-success and parse-failure cases.

- (4b) **Fixture pattern.** Tmpdir per `beforeEach` (`os.tmpdir() + crypto.randomUUID()`); helper utility `writeJsonl(targetRepoRoot, month, events)` that creates `<root>/.crew/telemetry/<YYYY-MM>.jsonl` and appends one event per line. `afterEach` cleans via `fs.rm(..., { recursive: true })`. No mocking of `fs`; no clock mocking (the helper has no clock dependency).

- (4c) **(a) Fully-resolved window.** Seed 50 `reviewer.verdict` events, all with `eventual_merge_action` set to a concrete value (mix of `merged` / `closed-without-merge` / `superseded-by-rework`). Construct the fixture so 40 events match the agreement matrix (1d) and 10 do not. Assert: `ratio === 0.8`, `agreementCount === 40`, `windowSize === 50`, `distribution.READY_FOR_MERGE + distribution.NEEDS_CHANGES + distribution.BLOCKED === 50`, `malformedLines === 0`, `malformedFiles === 0`.

- (4d) **(b) Partially-resolved window.** Seed 60 events: 45 with `eventual_merge_action` resolved, 15 with `eventual_merge_action: null`. With `lastNVerdicts: 50` (default), the resolved count is 45 — sub-window. Assert: `computeAgreement` returns `null`. Drop the parameter to `lastNVerdicts: 40`; assert it returns an `AgreementMetric` with `windowSize === 40` and the agreement computed only across the most-recent 40 resolved events (i.e., the 15 unresolved events are excluded entirely — not just elided from the window).

- (4e) **(c) Empty log.** Two sub-cases:
  - No `.crew/telemetry/` directory at all → `null`.
  - Directory present, no `*.jsonl` files → `null`.
  - Directory present, JSONL files present, but no `reviewer.verdict` events (only `agent.invoke` events from Story 1.5) → `null`.
  Each is its own `it()`.

- (4f) **All-unresolved case.** Seed 50 events, all with `eventual_merge_action: null`. Assert: `null`. (Distinguishes "no events" from "all events unresolved" — both return null but via different code paths.)

- (4g) **Cross-file window assembly.** Seed two month-bucket files (`2026-04.jsonl` with 25 resolved events, `2026-05.jsonl` with 30 resolved events). With `lastNVerdicts: 50`, the window spans both files, taking 50 of the combined 55. Assert: `windowSize === 50`; assert that the 5 OLDEST events (from `2026-04.jsonl`) are excluded — i.e., file iteration order is lexicographic AND in-file order is preserved.

- (4h) **Agreement matrix coverage.** One `it()` per row of the matrix in (1d) — nine tests, each seeds exactly one event with a specific `(verdict, eventual_merge_action)` pair plus 49 known-agreeing fillers (so the window is fully resolved). Assert that `agreementCount` rises or doesn't rise according to the matrix. This pins the matrix to a regression-resistant set of assertions.

- (4i) **Malformed-line tolerance.** Seed 50 valid resolved events plus 1 line that is not valid JSON, plus 1 line that is valid JSON but fails the discriminated-union schema (e.g. unknown `type: "compute.agreement"`). Assert: `ratio` is computed over the 50 valid events; `malformedLines === 2`; `malformedFiles === 1`.

- (4j) **Distribution sum invariant.** A property-style test: for any fully-resolved window, `distribution.READY_FOR_MERGE + distribution.NEEDS_CHANGES + distribution.BLOCKED === windowSize`. Either a hand-crafted fixture or three randomised seeds with explicit verdict-mix counts.

- (4k) **MCP-tool boundary coverage** (`tools/__tests__/compute-agreement.test.ts`):
  - Input with `lastNVerdicts: 0` rejected with Zod error envelope.
  - Input with `lastNVerdicts: -5` rejected.
  - Input with `lastNVerdicts: "fifty"` (wrong type) rejected.
  - Valid input returns the helper's output as text (per MCP-tool convention — `JSON.stringify` of the return value, including the `null` branch).
  - Tool name is exactly `computeAgreement` (camelCase, per Implementation-patterns §4 naming rule).

- (4l) **Schema-only coverage** (`schemas/__tests__/telemetry-events.test.ts`):
  - Valid `reviewer.verdict` event with resolved action parses.
  - Valid `reviewer.verdict` event with `eventual_merge_action: null` parses.
  - `verdict` enum violation rejects.
  - `eventual_merge_action` enum violation rejects.
  - Missing `pr_number` rejects.
  - Unknown `data.foo` field rejects (strict mode).
  - `pr_number: 0` rejects (non-positive).
  - Existing `agent.invoke` and `telemetry.invalid` schemas continue to parse — non-regression.

- (4m) **Non-regression — `team-stats.ts` continues to work.** Run the existing `lib/__tests__/team-stats.test.ts` suite (if present at the file path implied by `team-stats.ts`'s location — confirm via filesystem scan; the dev agent should locate the file and ensure no test breaks because the union grew). The widening is additive; the `agent.invoke`-only branch in `team-stats.ts` is unchanged.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Widen `TelemetryEventSchema` with `ReviewerVerdictEventSchema`** (AC: #1h, #4l)
  - [ ] 1.1 In `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`, after `TelemetryInvalidEventSchema` (and BEFORE the `TelemetryEventSchema` discriminated-union declaration), add `ReviewerVerdictEventSchema` per AC1 unpacked (1h). Follow the existing module's `.strict()` discipline on both `TelemetryEventBase.extend(...)` and the inner `data` object.
  - [ ] 1.2 Update the file-level JSDoc to reflect the closed-set v1 addition. The current docstring says *"Closed set in v1. Adding a new event type means adding a new schema entry plus a `type` literal — no implicit extension."* Append a sentence: *"Story 4.10 adds `reviewer.verdict`; Story 4.12 is the writer."*
  - [ ] 1.3 Extend the `TelemetryEventSchema` discriminated union to include the new schema as a third member. Order: `AgentInvokeEventSchema, TelemetryInvalidEventSchema, ReviewerVerdictEventSchema`.
  - [ ] 1.4 Export `ReviewerVerdictEvent` type via `z.infer<typeof ReviewerVerdictEventSchema>` alongside the existing `TelemetryEvent` type.

- [ ] **Task 2: Add the `computeAgreement` helper (pure-ish IO function)** (AC: #1, #2, #3, #4a–4j)
  - [ ] 2.1 Create `plugins/crew/mcp-server/src/lib/compute-agreement.ts`. Mirror `lib/team-stats.ts` structure: JSDoc header citing this story key, FR67, NFR24, and the `team-stats.ts` template lineage; same `MONTH_BUCKET_REGEX` constant declaration (copy the value verbatim — do not import from `team-stats.ts`); same ENOENT-tolerance pattern in the readdir step.
  - [ ] 2.2 Export `AgreementMetric` interface per AC1 unpacked (1a).
  - [ ] 2.3 Export `async function computeAgreement(opts: { targetRepoRoot: string; lastNVerdicts?: number }): Promise<AgreementMetric | null>`. Default `lastNVerdicts` to `50` via parameter destructuring: `const lastNVerdicts = opts.lastNVerdicts ?? 50;`. Defensive check: if `lastNVerdicts < 1`, throw a plain `Error` (the MCP-tool boundary in Task 3 enforces this; the helper is internally consistent if called by validated callers).
  - [ ] 2.4 Scan algorithm per AC1 (1b): `fs.readdir(telemetryDir)`; on ENOENT return `null`; iterate sorted entries matching `MONTH_BUCKET_REGEX`; read each file; split-and-parse; collect `reviewer.verdict` events into a local array; track `malformedLines` / `malformedFiles` as `team-stats.ts` does.
  - [ ] 2.5 After scan: filter to `resolved` (events whose `data.eventual_merge_action !== null`); if `resolved.length < lastNVerdicts`, return `null`; take `window = resolved.slice(-lastNVerdicts)`.
  - [ ] 2.6 Initialise `distribution = { READY_FOR_MERGE: 0, NEEDS_CHANGES: 0, BLOCKED: 0 }`. Implement the matrix from AC1 (1d) as a pure helper: `function isAgreement(verdict, action): boolean` with the nine cases. Assert via TypeScript that all enum members are handled (use a `never` exhaustiveness check on the verdict switch).
  - [ ] 2.7 Walk the window; for each event, increment `distribution[KEY]` (with the verdict-to-key mapping `"READY FOR MERGE" → "READY_FOR_MERGE"` etc.); if `isAgreement(verdict, action)`, increment `agreementCount`.
  - [ ] 2.8 Return `{ ratio: agreementCount / windowSize, agreementCount, windowSize: lastNVerdicts, distribution, malformedLines, malformedFiles }`.
  - [ ] 2.9 Local `isEnoent` helper — copy verbatim from `team-stats.ts` (same module-private helper). Acknowledged duplication; extracting a shared utility is deferred work and adds little value at v1.

- [ ] **Task 3: Add the `computeAgreement` MCP tool wrapper** (AC: #1, #4k)
  - [ ] 3.1 Create `plugins/crew/mcp-server/src/tools/compute-agreement.ts`. Export `async function computeAgreementTool(opts: { targetRepoRoot: string; lastNVerdicts?: number }): Promise<AgreementMetric | null>` that delegates to `computeAgreement` from `lib/`. The thin tool layer exists so the MCP-handler shape (JSON-stringified return, Zod-validated input) is testable independently of the IO logic.
  - [ ] 3.2 In `plugins/crew/mcp-server/src/tools/register.ts`, append a `server.registerTool({ name: "computeAgreement", ... })` call following the existing pattern. Place it after the most-recently-registered Epic 4 tool (currently `applyReviewerLabels` per Story 4.8). Update any tool-count assertions in the test suite by +1 (search `acceptance.test.ts` and `tools/__tests__/` for hard-coded counts).
  - [ ] 3.3 Input schema (Zod): `z.object({ targetRepoRoot: z.string().min(1), lastNVerdicts: z.number().int().positive().optional() })`. Inline the schema in the registration block (matches the convention used by `getStatus` and other simple tools in `register.ts`).
  - [ ] 3.4 Handler body: parse input; call `computeAgreementTool`; return `{ content: [{ type: "text" as const, text: JSON.stringify(result) }] }`. `JSON.stringify(null) === "null"` — the null branch is communicated verbatim to the caller.
  - [ ] 3.5 Tool description string: `"Compute the rolling verdict-vs-action agreement metric over .crew/telemetry/*.jsonl (FR67, NFR24)."` Keep it terse — matches the convention.
  - [ ] 3.6 Add the new tool import at the top of `register.ts`: `import { computeAgreementTool } from "./compute-agreement.js";`.

- [ ] **Task 4: Integration test suite — `lib/__tests__/compute-agreement.test.ts`** (AC: #4a–4j)
  - [ ] 4.1 Create the file. Top-level imports: `vitest`, `node:fs/promises` as `fs`, `node:os`, `node:path`, `node:crypto`, the helper under test, and the `ReviewerVerdictEvent` type from `schemas/telemetry-events.js`.
  - [ ] 4.2 Top-level helper utility `writeJsonl(targetRepoRoot, month, events)`: ensures `.crew/telemetry/`; writes one JSON.stringify per line; terminates each line with `\n` (matches the logger's writer contract from Story 1.5).
  - [ ] 4.3 Top-level helper `verdictEvent(opts: { pr_number; verdict; eventual_merge_action; session_id?; agent?; standards_version?; plugin_version?; ts? })`: returns a `ReviewerVerdictEvent`-shaped object with sensible defaults (`session_id: "01ABCDEFGHJKMNPQRSTVWXYZ00"` static ULID, `agent: "generalist-reviewer"`, `standards_version: "1.0.0"`, `plugin_version: "1.0.0"`, `ts: "2026-05-01T12:00:00.000Z"`).
  - [ ] 4.4 `beforeEach` creates a tmpdir; `afterEach` cleans via `fs.rm(..., { recursive: true })`.
  - [ ] 4.5 Implement test cases (4c) through (4j) per AC4 unpacked. Each `it()` is independent; no shared mutable state across tests.
  - [ ] 4.6 The agreement-matrix coverage in (4h) is implemented as a `describe.each` over the nine matrix rows — keeps the test file scannable.
  - [ ] 4.7 Assert `windowSize === lastNVerdicts` exactly on every fully-populated-window test (defensive against future arithmetic drift).

- [ ] **Task 5: MCP-tool-boundary test suite — `tools/__tests__/compute-agreement.test.ts`** (AC: #4k)
  - [ ] 5.1 Create the file. Import `computeAgreementTool` from `tools/compute-agreement.ts`.
  - [ ] 5.2 Cases per (4k): zero / negative / wrong-type input rejections; valid-input round-trip including the `null` branch; tool-name camelCase assertion (via a string-equality check against the literal `"computeAgreement"` somewhere the registration site is testable — e.g. by importing the registered tool list from `register.ts` if the registration function exposes one, or by re-registering against a test `AiEngineeringTeamServer` and reading the registered name from the spy).
  - [ ] 5.3 If the existing test pattern uses `MockServer` or a test-helper for `registerTool` spying, reuse it. Otherwise, the input-validation tests can be done at the `computeAgreementTool` boundary directly and the registration assertion can be a single `it()` against `register.ts`'s exported state.

- [ ] **Task 6: Schema test suite — `schemas/__tests__/telemetry-events.test.ts`** (AC: #4l)
  - [ ] 6.1 Create or extend the file. If a v1 file exists from Story 1.5, append new `describe("ReviewerVerdictEventSchema", ...)` block; otherwise create the file with `describe`s covering all three schemas (regression coverage for `agent.invoke` and `telemetry.invalid` is cheap insurance).
  - [ ] 6.2 Implement cases per (4l): valid resolved, valid unresolved (`eventual_merge_action: null`), verdict enum violation, action enum violation, missing `pr_number`, unknown field (strict), `pr_number: 0`, plus a non-regression case parsing a valid `AgentInvokeEvent` through the union.
  - [ ] 6.3 Use `safeParse` for failure cases and assert on `result.success === false` plus `result.error.issues[0].path` when the path matters.

- [ ] **Task 7: Tool-count assertion bump** (AC: all)
  - [ ] 7.1 Search the test suite for hardcoded tool counts: `grep -rn "registerTool" plugins/crew/mcp-server/src/__tests__ plugins/crew/mcp-server/src/tools/__tests__ plugins/crew/mcp-server/tests` and any `expect(...).toBe(N)` against a count. Bump by +1 for the new registration.
  - [ ] 7.2 If `acceptance.test.ts` (Story 1.1) asserts a tool count, update it and cite this story key in a JSDoc-style comment.

- [ ] **Task 8: Build, vitest, dist** (AC: all)
  - [ ] 8.1 `pnpm build` (from `plugins/crew/mcp-server/`) passes. TypeScript surfaces no errors from the new files or the widened discriminated union.
  - [ ] 8.2 All vitest tests pass — both new tests AND the existing suite. Run `pnpm vitest --run` from `plugins/crew/mcp-server/`.
  - [ ] 8.3 Confirm `canonical-fs-guard.test.ts` still passes — the new helper only reads `.crew/telemetry/*.jsonl`; no canonical-state-path writes are added.
  - [ ] 8.4 Confirm `team-stats.test.ts` (the existing fire-counts reader) continues to pass — the union widening is additive.
  - [ ] 8.5 Commit `dist/` per CLAUDE.md. The rebuild picks up the new `lib/`, `tools/`, and `schemas/` files plus the widened `register.ts`.

---

## Implementation strategy

### Why mirror `team-stats.ts` exactly (and copy the regex constant)

`team-stats.ts`'s docstring states explicitly: *"v1 template for Epic 6's `computeOutcomeStats` and `computeAgreement` helpers — keep small and single-purpose."* Two helpers will follow this one (this story is the second; `computeOutcomeStats` is the third). The template's value is in its consistency — same ENOENT branch, same per-line parse loop, same malformed-line counter pair, same `isEnoent` private helper. Copying the regex constant (`MONTH_BUCKET_REGEX`) verbatim into the new module — rather than extracting it to a shared `lib/telemetry-bucket.ts` — keeps each helper self-contained at v1. A future refactor can DRY the constant once `computeOutcomeStats` lands and the duplication becomes a real maintenance signal; until then, the three-byte regex is cheaper to copy than to abstract.

### Why the helper returns `AgreementMetric | null` (not `{ ratio: null, ... }`)

The epic AC says verbatim: *"it returns `null` (insufficient data) rather than a misleading zero."* A `{ ratio: null, ... }` shape (with companion fields populated) would tempt a caller to read `malformedLines` or `distribution` from a sub-window — but those values are only meaningful when the window is fully populated. The strict `null` return makes the contract impossible to misuse: either you have a metric, or you don't. The auto-merge gate (Story 4.10b) uses `if (metric === null) pause("insufficient-data")` as a one-liner; no defensive field reads.

### Why "filter to resolved BEFORE taking the trailing N" (not "take trailing N then filter")

The two orderings produce different windows when unresolved events are interleaved:

- **Filter-then-slice (chosen):** Of the resolved set, take the most-recent N. Window size is N or null. This is what the auto-merge gate wants — "give me agreement over the last N PRs whose outcome I know".
- **Slice-then-filter (rejected):** Take the most-recent N events; drop the unresolved ones. Window size is ≤ N. This would mean "the last 50 reviewer verdicts, however many of them resolved" — which conflates "had enough data" with "had enough decisions".

The architecture-pin's intent (FR67: "the rolling verdict-vs-action agreement metric") names the metric as agreement, not as verdict-frequency. Filter-then-slice computes agreement; slice-then-filter would compute a degraded variant. The contract is filter-then-slice, pinned in AC1 unpacked (1c) and AC3 unpacked (3b).

### Why the agreement matrix puts `NEEDS CHANGES` and `BLOCKED` in the same agreement class

Both are "do-not-merge" verdicts. The eventual-action axis is binary: `merged` vs `(closed-without-merge | superseded-by-rework)`. A `NEEDS CHANGES` verdict that resulted in a `merged` PR is a reviewer mistake (the reviewer said "fix this first" and someone merged anyway); a `BLOCKED` verdict that resulted in a `merged` PR is the same mistake category. There is no architectural pin distinguishing the two; the matrix in AC1 (1d) treats them as functionally identical on the agreement axis. The distribution counters keep them separate for forensic value (operators can see "how often does the reviewer block vs ask for changes?").

### Why `eventual_merge_action: null` is the resolved/unresolved discriminator (not a separate `resolved: boolean` flag)

A boolean field would be redundant — the action field already carries the information. Using `null` (rather than e.g. the literal `"pending"`) follows the schema convention from elsewhere in the codebase (e.g. `claimed_by: string | null` in `ExecutionManifestSchema`). The schema is `.nullable()` on the enum; the helper checks `=== null` exactly once.

### Why the MCP tool wrapper is a thin delegate (not the canonical helper)

`team-stats.ts` is consumed by `getTeamSnapshot.ts`, not directly by an MCP tool. `compute-agreement` differs: the architecture pins it as an MCP tool surface (and a CLI surface, deferred). The split between `lib/compute-agreement.ts` (pure-ish IO) and `tools/compute-agreement.ts` (the MCP boundary) lets the lib be reused by Story 4.10b's auto-merge gate WITHOUT routing the gate through an MCP tool call (the gate runs in the same process; a direct function import is cheaper). The wrapper exists only to satisfy the MCP-tool surface and the architecture pin.

### Why no CLI command in v1 (despite the architecture pin)

The architecture's stats-helpers row says *"exposed as MCP tools and CLI commands"*. v1 ships the MCP tool only. Two reasons:

1. **No v1 caller for a CLI surface.** The auto-merge gate (Story 4.10b) calls the helper directly via TypeScript import; an operator running `crew compute-agreement` from a shell is a future workflow, not a v1 one.
2. **CLI surfaces are install-surface decisions.** A CLI command implies discoverability (in `crew --help`), exit-code conventions, output format (JSON vs human-readable), and a place in the README. Each is a real decision that warrants its own focused story. Deferring keeps this story tight to the FR67/NFR24 contract.

Documented in § Deferred work; the architecture pin is partially satisfied (MCP tool side) and the CLI side is a known follow-up.

---

## Locked files

These files are off-limits to this story. If a change appears necessary, STOP and surface the conflict — do not silently edit.

- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` (Story 4.1 / 4.2)
- `plugins/crew/mcp-server/src/tools/claim-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Story 4.6) — this story does NOT wire reviewer emission of `reviewer.verdict` events; that is Story 4.12's job. The schema this story adds is consumed by 4.12.
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Story 4.6 revision 2)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Stories 4.6b / 4.7)
- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts` (Story 4.4 / 4.8b)
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Stories 4.3b / 4.5 / 4.6 / 4.8b)
- `plugins/crew/mcp-server/src/lib/team-stats.ts` (Story 2.6) — the template this story mirrors. Do NOT modify it; copy the patterns into the new file.
- `plugins/crew/mcp-server/src/lib/logger.ts` (Story 1.5) — the writer contract. This story does not write telemetry; the writer of `reviewer.verdict` events is Story 4.12.
- `plugins/crew/skills/start/SKILL.md` (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7) — no SKILL.md change in this story.
- `plugins/crew/permissions/generalist-reviewer.yaml` (Stories 2.2 / 4.6 / 4.7 / 4.8) — no permission change; the helper makes no `gh` call and reads only from `.crew/telemetry/`.

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/schemas/telemetry-events.ts`** (Story 1.5) — Task 1 adds `ReviewerVerdictEventSchema` and extends the `TelemetryEventSchema` discriminated union. No existing schema is modified; the union grows by one member. The file's `.strict()` invariant and PII-free invariant (NFR14) are both preserved (the new payload carries only typed primitives and known string enums; no diff bodies, no comment bodies, no PR descriptions).
- **`plugins/crew/mcp-server/src/tools/register.ts`** (touched by most Epic-1 through Epic-4 stories) — Task 3.2 appends a `computeAgreement` registration. No existing registration is modified. Tool-count assertion (if present elsewhere) is bumped by Task 7.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/lib/compute-agreement.ts` (Task 2)
- `plugins/crew/mcp-server/src/lib/__tests__/compute-agreement.test.ts` (Task 4)
- `plugins/crew/mcp-server/src/tools/compute-agreement.ts` (Task 3.1)
- `plugins/crew/mcp-server/src/tools/__tests__/compute-agreement.test.ts` (Task 5)

### Files this story will modify

- `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` (Task 1)
- `plugins/crew/mcp-server/src/tools/register.ts` (Task 3.2; new import + new registerTool call)
- `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events.test.ts` (Task 6 — extend or create)
- Any test file holding a hardcoded MCP tool count (Task 7.1; identified via grep)
- `plugins/crew/mcp-server/dist/` (Task 8.5; rebuild and commit)

### Current-state notes on files being modified

- **`schemas/telemetry-events.ts`** (current state per Story 1.5): exports `TelemetryEventBase`, `AgentInvokeEventSchema`, `TelemetryInvalidEventSchema`, `TelemetryEventSchema` (discriminated union over the first two), and `TelemetryEvent` type. The file's preamble JSDoc names the closed-set policy and the no-PII invariant. Task 1's widening preserves both — the new event payload contains no string bodies, only typed primitives.
- **`lib/team-stats.ts`** (current state per Story 2.6): exports `readTeamTelemetryStats(opts: { targetRepoRoot: string }): Promise<TeamTelemetryStats>`. The function's docstring says it's the v1 template for this story's helper. Mirror its structure verbatim — same readdir try-block, same per-line parse loop, same `isEnoent` private helper at the bottom.
- **`tools/register.ts`** (current state per Story 4.8): contains ~28 `server.registerTool({...})` calls in a flat function `registerAllTools`. Pattern is consistent — each registration is its own block with name, description, inputSchema (JSON-schema-shaped object), and handler. Task 3.2 appends one more in the same shape.

### Testing standards

- vitest with `pnpm vitest --run` from `plugins/crew/mcp-server/`.
- `os.tmpdir() + crypto.randomUUID()` for tmpdir fixtures; `fs.rm(..., { recursive: true })` in `afterEach`.
- No global mocks. No clock mocking — the helper has no clock dependency.
- For schema tests: `safeParse` with `expect(result.success).toBe(false)` plus path assertions; or `parse` inside a `toThrow` for cases where Zod throwing is the contract.
- Per-event-line fixtures use a small helper `verdictEvent({...})` so test bodies stay readable; the helper is exported from a `__fixtures__/` subdir if more than one test file needs it (otherwise inline at the top of the test file).
- Cross-file window test (4g) is the canary against an implementation that reads only the most-recent file or otherwise mis-orders files.

### Dependencies

- Story 1.5 (`logger.ts` + `telemetry-events.ts` writer contract and discriminated-union pattern) — additively extended by Task 1.
- Story 2.6 (`team-stats.ts` template, FR108 / NFR28 reader pattern) — mirrored verbatim by Task 2.
- Architecture § Telemetry & Observability (`core-architectural-decisions.md` lines ~64–71) — pins stats helpers as MCP tools and CLI commands; this story ships the MCP tool half.
- Architecture § Project Structure (`project-structure-boundaries.md` line ~75) — pins `compute-agreement.ts` under `mcp-server/src/tools/` (this story splits it as `lib/` + `tools/` wrapper for the same reason `team-stats` lives in `lib/`; the MCP-tool surface is still satisfied).
- FR67 (`prd-crew-v1/functional-requirements.md` line ~100) — the rolling-window-agreement requirement.
- NFR24 (`prd-crew-v1/non-functional-requirements.md` line ~42) — the observability commitment.

### Downstream callers (not implemented by this story)

- Story 4.10b: Calls `computeAgreement` from the auto-merge gate. If the return is `null` or `ratio < threshold` (default 0.8 per the epic), the gate pauses with `needs-human` and an `insufficient-data` or `sub-threshold` reason. If `ratio >= threshold` AND `risk_tier === "low"` AND `verdict === "READY FOR MERGE"`, the gate calls `gh pr merge`.
- Story 4.12: Wires `runReviewerSession` (or `postReviewerComments`) to emit a `reviewer.verdict` event after every posted verdict comment. Also owns the eventual-action backfill loop (or schedules it for a successor).
- Future Epic 5 / Epic 6 story: Surfaces `computeAgreement`'s output in `/crew:status` or a dedicated `/crew:agreement` operator command.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.10`]
- [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`] (§ Telemetry & Observability — stats helpers row)
- [Source: `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md`] (line ~75 — `compute-agreement.ts` placement)
- [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md`] (§ 4 MCP Tool Naming; § 5 JSONL Event Schema)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] (FR67)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/non-functional-requirements.md`] (NFR24)
- [Source: `plugins/crew/mcp-server/src/lib/team-stats.ts`] (the template this story mirrors)
- [Source: `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`] (the schema this story extends)
- [Source: `plugins/crew/mcp-server/src/lib/logger.ts`] (writer contract — not modified by this story)
- [Source: `plugins/crew/docs/user-surface-acs.md`] (substrate-vs-user-surface judgement)

---

## Previous story intelligence

### From Story 4.9b (recently authored — adjacent in epic)

- Story 4.9b widens `ExecutionManifestSchema` additively with `risk_tier`. Story 4.10b is the consumer of BOTH 4.9b's `risk_tier` stamp AND this story's `computeAgreement` return value. Coupling between this story and 4.9b is zero at v1 — they ship independently and 4.10b composes them.
- The "additive widening of a `.strict()` schema" pattern from 4.9b applies here verbatim to `TelemetryEventSchema`. Same shape: declare the new schema, extend the discriminated union, re-infer the union type.

### From Story 2.6 (shipped — direct template lineage)

- `readTeamTelemetryStats` ships the v1 template this story mirrors. Same `MONTH_BUCKET_REGEX`, same ENOENT-tolerance, same per-line parse loop, same `(malformedLines, malformedFiles)` counter pair, same `isEnoent` helper. The template's docstring names this story explicitly as the next reuse.
- The split between "reader counts only events whose `type` matches a known branch; other valid event types are tolerated but not aggregated" carries over: `team-stats.ts` ignores `telemetry.invalid` and `reviewer.verdict` events without counting them as malformed. `compute-agreement.ts` ignores `agent.invoke` and `telemetry.invalid` events without counting them as malformed. Same shape, different opt-in branch.

### From Story 1.5 (shipped — schema substrate)

- The `.strict()` discriminated union pattern is the substrate. Schema additions are always: new `.strict()` member → discriminated union grows → `TelemetryEvent` type re-infers. No writer-side change is needed in `logger.ts` because the writer dispatches on the schema-validated `type` field generically.
- The PII-free invariant (NFR14) — no diff bodies, no comment bodies, no PR descriptions in telemetry payloads — is preserved by this story. The `reviewer.verdict` payload carries only `pr_number` (an integer), `verdict` (a known enum), two version strings, and the eventual-action enum.

### From Story 4.7 (shipped — version-stamp convention)

- The reviewer verdict comment body carries `` `standards_version: ...` · `plugin_version: ...` `` for forensic value. The `reviewer.verdict` event payload mirrors this — `standards_version` and `plugin_version` are required string fields. Story 4.12 (the writer) is responsible for extracting these from the rendered comment or from the in-process version state at emission time.

### Git intelligence (recent commits)

```
940f4db feat(3): BMad adapter leniency for real-world BMad backlogs (#129)
9b7bbe0 spec(4-9b): author spec for risk-tier classifier, evidence stamping, and fallback (#123)
7e91670 spec(3-8): author spec for BMad adapter real-world leniency (#127)
2d449dd backlog: Story 3.8 — BMad adapter leniency for real-world backlogs (#126)
c8d8b14 setup(dogfood): wire .crew/config.yaml + author first dogfood story 4-13 (#125)
```

Pattern: Epic 4 commits follow `feat(4.X): <subject>`. Story 4.10's commit follows `feat(4.10): <subject>`. Spec commits follow `spec(<key>): <subject>` or `spec: <key>`.

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
