# Story 4.9b: Risk-tier classifier code, evidence stamping, and fallback

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator**,
I want **each story stamped with a deterministic `risk_tier` (`low | medium | high`) derived from path patterns, change-type signals, and diff size by walking the rules loaded via `lookupRiskTieringSpec` (Story 4.9), with the result mirrored into the verdict comment alongside its supporting evidence**,
so that **the auto-merge gate in Story 4.10b has a single machine-authoritative input (the manifest's `risk_tier` field) and the reviewer/operator have a single source of truth in the PR comment for *why* that tier was assigned — without anyone making a vibes call mid-cycle or paraphrasing the rule that matched**.

### What this story is, in one sentence

Add `classifyRiskTier` (pure function + `classify-risk-tier` MCP tool) that consumes a `prDiff` plus the `RiskTieringSpec` loaded by Story 4.9, returns `{ tier, matched_rule, evidence: { paths, change_types, diff_size } }`, with `tier: medium, matched_rule: "fallback"` when no rule matches; widen `ExecutionManifestSchema` with an optional `risk_tier` enum field; stamp the in-progress manifest via the existing `manifest-io` write surface inside `runReviewerSession`; widen `ReviewerResultFileShape` with three optional risk-evidence fields and render a new `## Risk tier` section in `composeSummaryBody` when present.

### What this story does (and why it needs its own story)

Story 4.9 shipped the format, schema, and loader for `docs/risk-tiering.md` — the substrate. It explicitly deferred the consumer: classifier code, the manifest stamp, the evidence block in the verdict comment, and the v1 call site that wires the classifier into a reviewer pass. All four are this story's job.

Three reasons the consumer is a separate story rather than folded into 4.9:

1. **Different review surface.** The loader is a pure file-shape + Zod story. The classifier carries rule-walking order, fallback semantics, path-matching library choice (`picomatch`), change-type detection heuristics from a diff, and an integer-line-count derivation. The two have different failure modes and different test shapes; reviewing them under one PR would double the burden on the human eyeball gate.

2. **Lock-conflict surface lands here, not in 4.9.** The classifier's v1 caller lives in `runReviewerSession` (locked by Story 4.6) and surfaces evidence via `composeSummaryBody` and `ReviewerResultFileShape` (also locked-adjacent). Concentrating those declared exceptions in one story keeps 4.9 a clean substrate landing.

3. **Architecture pin lands in two places.** The architecture's pattern §11 calls for risk-tier output to be stamped to **both** the manifest frontmatter (long-lived; consumed by Story 4.10b's auto-merge gate) and the verdict comment body (operator-visible; the "why" trail). Both writes are tied to the same classifier call — coupling them under one story prevents drift between the two surfaces.

This story explicitly DOES change the manifest schema (adds an optional `risk_tier` field). FR10 has always pinned `risk_tier` as a story-frontmatter field; Story 4.9's spec §What this story does NOT (m) asserted the field "is already declared by Story 3.5 / Story 3.7's `ExecutionManifest` schema as an enum `low | medium | high`" — that assertion is incorrect against the current `schemas/execution-manifest.ts`, which carries `claimed_by`, `rework_count`, `blocked_by`, etc. but no `risk_tier`. This story adds the field, additively and optionally, so historical `to-do/` and `in-progress/` manifests parse unchanged. The widening follows the same shape as Story 4.1's `claimed_by` and Story 4.3's `rework_count` additions — both routine additive growths against the `.strict()` schema.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Modify the risk-tiering spec format, schema, validator, or loader from Story 4.9. The classifier is a pure consumer of the `RiskTieringSpec` returned by `lookupRiskTieringSpec`; it does NOT re-parse, re-validate, or otherwise reach behind the loader's contract. If the loader's return shape needs to change, that is a Story 4.9 revision, not a Story 4.9b change.
- (c) Implement the auto-merge gate or any caller that reads `manifest.risk_tier` to decide a merge action. Story 4.10b owns that. v1 of this story stamps the field; nothing else in v1 reads it.
- (d) Implement the agreement-metric helper or any consumer of `reviewer.verdict` telemetry. Story 4.10 owns it.
- (e) Add `revert` change-type detection. The classifier's `detectChangeTypes(prDiff)` helper covers `migration`, `schema`, and `dep-bump` via filename-pattern heuristics in v1 (see § Implementation strategy for the matrix). `revert` requires PR-title or commit-message signal that is not present in `gh pr-diff` stdout — a follow-up story can extend the helper without changing the classifier or the spec schema.
- (f) Cache the loader's output or the classifier's result across reviewer runs. Each `runReviewerSession` call loads the spec fresh and re-classifies. Story 4.9 §Deferred work (i) already calls out caching as deferred; this story does not introduce one.
- (g) Emit telemetry events for classification. Story 4.12 owns the telemetry seam (`reviewer.risk-tier-classified` event with the evidence payload). A future telemetry hook layered onto this story's `classify-risk-tier` MCP tool is the cheap follow-up.
- (h) Surface `risk_tier` in any CLI or slash-command output (e.g. `/crew:status`). Operator visibility in v1 is via the PR verdict comment's new `## Risk tier` section only. Other surfaces (status command, watch loop) are scoped to their own stories.
- (i) Backfill `risk_tier` on historical `done/` manifests. v1 stamps prospectively on stories newly entering the reviewer pipeline; pre-existing `done/<ref>.yaml` files remain unmodified. The agreement-metric helper (Story 4.10) treats absence as "not classifiable" (already declared in its own AC).
- (j) Persist the classifier's intermediate `evidence` object as a separate file (e.g. `risk-tier.json` in the session directory). The evidence is captured twice — verbatim in the verdict comment body (via `composeSummaryBody`) and as the populated optional fields on `ReviewerResultFileShape` (the existing `reviewer-result.json` session file). A third persisted artefact would be triple bookkeeping.
- (k) Add a separate `gh pr-view` fetch for PR-title-based signals. The classifier reads only from `prDiff` (already fetched by `runReviewerSession` at the existing `gh pr-diff` call site). No new `gh` permission is required; no new network round-trip.
- (l) Modify the `ReviewerResultFileShape` consumers in `processReviewerTranscript`, `postReviewerComments`, or `runReviewerSession`'s caller in SKILL.md beyond the additive shape widening. The three new fields are optional (`riskTier?`, `riskMatchedRule?`, `riskEvidence?`); existing consumers that read only the previously-declared fields are unchanged.
- (m) Pre-create or rewrite the `risk-tiering.md` shipped default. Story 4.9 ships the default file. This story consumes it via `lookupRiskTieringSpec`.
- (n) Add `picomatch`, `minimatch`, or any glob library as a top-level plugin dependency without a `package.json` change. The classifier needs a glob matcher (Story 4.9 §What this story does NOT (p) explicitly punted the dependency to here). v1 adds `picomatch` (the lightest, dependency-free option used by Vite, Vitest, and Rollup) to `plugins/crew/mcp-server/package.json` `dependencies`. Build-step impact is acknowledged in Task 7.
- (o) Change the locked-phrase grammar from Story 4.3 (handoff phrase) or Story 4.6b (verdict line grammar). The risk-tier evidence block appears in the summary body BEFORE the verdict line and the version-stamp footer; it does not alter their position, wording, or the footer marker (`<!-- crew:verdict:<pluginVersion>:<ref> -->`).
- (p) Define what a `none-of-the-above` PR (e.g. a binary-only change with zero text-line diff) does beyond falling through to the existing `fallback_tier: medium` branch. A diff with `diff_size: 0`, no path-pattern match, and an empty `change_types` set matches no rule and falls back — exactly as architecture-pin specifies.
- (q) Reject PRs whose diff is unparseable or empty. An unparseable or empty diff yields `paths: []`, `change_types: []`, `diff_size: 0`, no rule matches, fallback fires — the operator gets `tier: medium, matched_rule: "fallback"` rather than a hard error. Architecture-aligned: classification is best-effort; the manifest gets stamped regardless.
- (r) Add a `verdict_idempotency` reconsideration step. Story 4.7's idempotent-rerun handler (PATCH vs POST path) is preserved unchanged. On a NEEDS CHANGES → rework → re-review cycle, the classifier re-runs against the refreshed `prDiff` and the manifest's `risk_tier` is updated in place; the verdict comment's `## Risk tier` section reflects the most recent run.
- (s) Cross-validate that the matched rule's tier (`low`/`high`) is consistent with `fallback_tier: medium`. The schema in Story 4.9 already validates `fallback_tier` is literally `"medium"`; the classifier trusts the loaded spec.

### Deferred work

- **`revert` change-type detection.** Needs PR-title or commit-list signal (e.g. messages beginning with `Revert ` or PRs created by GitHub's "Revert" button). A follow-up story adds a `gh pr view --json title,commits` fetch and folds the result into `detectChangeTypes`. Out of scope here.
- **Risk-tier telemetry event.** Story 4.12 owns `reviewer.risk-tier-classified` JSONL emission with the evidence payload, so retros and the agreement metric can correlate verdict outcomes with classifier inputs.
- **Risk-tier in `/crew:status` output.** A future Epic 5 story surfaces `risk_tier` alongside `claimed_by` in the per-story status line.
- **Caching.** Re-loading the spec and re-classifying on every reviewer run is fine at v1 throughput. A future story can add a per-session-cached classifier if profiling shows it matters.
- **Multi-rule evidence stamping.** v1 stamps the FIRST matched rule (declaration order within the rule list). A future story may extend the evidence block with "also matched: …" entries when multiple rules fire.

---

## Acceptance Criteria

> AC1, AC2, AC3 are verbatim from the epic. AC4 is the integration suite. Per `plugins/crew/docs/user-surface-acs.md`, this story is **substrate**: the deliverable is an internal classifier, an additive manifest field, and a render-only extension of an existing summary body. The new verdict-comment section IS operator-visible, but it is not a slash command, an operator-typed CLI command, a path the docs ask the user to copy, or a Claude Code UI element — per the rubric's strict-membership rule (i)–(iv), no AC triggers the `(user-surface)` tag.

**AC1:**
**Given** a story's diff and the loaded spec from Story 4.9,
**When** `classify-risk-tier` runs,
**Then** it returns `{ tier: "low" | "medium" | "high", matched_rule: <rule-id>, evidence: { paths, change_types, diff_size } }`. _(FR40a)_

<!-- Not user-surface: AC1 describes the return shape of an internal MCP tool / pure function. The operator does not invoke it directly. -->

**AC2:**
**Given** a diff matching no declared rule,
**When** the classifier runs,
**Then** it returns `tier: "medium"` with `matched_rule: "fallback"`. _(FR40a fallback)_

<!-- Not user-surface: AC2 describes the fallback branch of the classifier; same internal surface as AC1. -->

**AC3:**
**Given** a classified story,
**When** the result lands,
**Then** `risk_tier` is stamped in the manifest and the evidence block is recorded in the verdict comment body. _(Pattern §11)_

<!-- Not user-surface: AC3 describes two internal write surfaces — the YAML manifest file and the PR verdict comment composed by composeSummaryBody. The PR comment is operator-readable but is not a slash command, a verbatim-typed CLI command, an install-doc-cited path, or a Claude Code UI element per the user-surface-acs.md rubric. -->

**AC4 (integration):**
vitest covers four classification branches (path match, change-type match, size match, fallback) and asserts evidence is stamped both places.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

### Expanded acceptance specifics (folded into AC1–AC4 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** Classifier contract and walking order:

- (1a) **Function signature (pure).** `classifyRiskTier(input: { spec: RiskTieringSpec; prDiff: string }): RiskTierClassification` where:
  ```ts
  type RiskTierClassification = {
    tier: "low" | "medium" | "high";
    matched_rule: string;            // rule id, or literal "fallback"
    evidence: {
      paths: string[];               // sorted unique file paths from prDiff
      change_types: ChangeType[];    // sorted unique change types detected; subset of ["migration", "schema", "dep-bump"]
      diff_size: number;             // total lines added + lines deleted (excludes headers)
    };
  };
  ```
  `ChangeType` is imported from `schemas/risk-tiering-spec.ts` (Story 4.9). The classifier does NOT touch the filesystem, does NOT call any MCP tool, and does NOT emit telemetry — pure I/O-free function.

- (1b) **Diff parsing — `paths`.** Extract by regex `/^diff --git a\/(.+?) b\/(.+?)$/gm` on `prDiff`. Take the `b/` capture (target path — handles renames). Deduplicate, sort lexicographically. An empty `prDiff` (or one with no `diff --git` headers) yields `paths: []` — never errors.

- (1c) **Diff parsing — `diff_size`.** Count lines beginning with a single `+` or `-` that are NOT diff metadata headers (`+++`, `---`). Algorithm: split `prDiff` on `\n`; for each line, increment if `line.startsWith("+") && !line.startsWith("+++")` OR `line.startsWith("-") && !line.startsWith("---")`. Returns 0 on empty diff. Binary-content markers (`Binary files a/foo and b/foo differ`) contribute zero.

- (1d) **Diff parsing — `change_types`.** Pure helper `detectChangeTypes(paths: string[]): ChangeType[]` (also exported from the classifier module for AC4 reuse). Filename-pattern matrix (case-insensitive on the regex side, applied to the `b/` target path; matches are additive):
  - **`migration`** — path matches any of: `^(.*/)?migrations?/`, `\.sql$`, `^(.*/)?alembic/versions/`, `^(.*/)?db/migrate/`.
  - **`schema`** — path matches any of: `(?:^|/)schema(?:\.|/)`, `\.prisma$`, `^(.*/)?graphql/schema`, `\.proto$`.
  - **`dep-bump`** — path matches any of: `(?:^|/)package(?:-lock)?\.json$`, `(?:^|/)pnpm-lock\.yaml$`, `(?:^|/)yarn\.lock$`, `(?:^|/)requirements\.txt$`, `(?:^|/)Pipfile(?:\.lock)?$`, `(?:^|/)poetry\.lock$`, `(?:^|/)Cargo\.lock$`, `(?:^|/)go\.(?:mod|sum)$`, `(?:^|/)Gemfile\.lock$`.
  - **`revert`** — NOT detected in v1 (see §Deferred work). The helper never returns `"revert"` in v1, even though the type allows it.
  Result is deduplicated and sorted (declaration order from the matrix above is the canonical sort: `migration < schema < dep-bump`; uses `[...]` then `.sort()` with the canonical-order comparator).

- (1e) **Rule-walking order.** Iterate tiers in the order `high → medium → low` (highest tier first, so a PR matching both a `low` docs-only rule AND a `high` migration rule classifies as `high` — the more conservative tier wins). Within each tier, walk rules in declaration order from `spec.tiers[<tier>] ?? []`. Return the FIRST rule whose match-function returns true. If no rule matches, return fallback (AC2).

- (1f) **Per-rule match function.** A rule matches the PR iff EVERY signal-field declared by the rule matches (AND across declared fields; absent fields do not constrain). Per-field semantics:
  - `path_patterns?: string[]` — if declared, at least ONE entry must match at least ONE path in `evidence.paths` via `picomatch` with `{ dot: true }`. Picomatch is invoked once per pattern via `picomatch(pattern, { dot: true })`; the returned predicate is applied to each path.
  - `change_types?: ChangeType[]` — if declared, at least ONE entry must appear in `evidence.change_types`.
  - `diff_size_thresholds?: { min_lines_changed?: number; max_lines_changed?: number }` — if declared, `evidence.diff_size` must satisfy `(min === undefined || size >= min) && (max === undefined || size <= max)`.
  - A rule with no signal fields cannot be authored (Story 4.9 §AC1 unpacked (1c) raises at load time). The matcher does not re-validate.

- (1g) **Match-function purity guarantees.** No throws on well-formed inputs. A glob that fails `picomatch` compilation (e.g. malformed `path_patterns` entry that the loader stored as opaque per Story 4.9 §What this story does NOT (f)) propagates the picomatch error uncaught — this surfaces a Story-4.9 spec authoring bug at reviewer time, which is the architecturally-intended diagnostic path.

- (1h) **`matched_rule` is the rule's `id`.** No prefix, no tier qualifier. The architecture-pin pattern §11 example uses raw `<rule-id from risk-tiering.md>`. v1 stamps the unmodified string.

**AC2 unpacked.** Fallback semantics:

- (2a) **Trigger condition.** No rule in any tier matches per AC1 (1e)–(1f) walk.

- (2b) **Return shape.** `{ tier: "medium", matched_rule: "fallback", evidence }`. The `evidence` block is the same one computed in AC1 (1b)–(1d) — the diff WAS parsed; it just didn't match any rule. The fallback tier is hard-coded to `"medium"` to match the loader's `fallback_tier: medium` invariant from Story 4.9 (the schema requires it to be literally `"medium"`). The classifier reads `spec.fallback_tier` for the value rather than hard-coding — this defends against a future Story 4.9 widening (e.g. allowing `fallback_tier: low` for repos that opt in).

- (2c) **`matched_rule` literal.** The string `"fallback"` exactly. Never a rule id; never empty. This is the sentinel architecture pattern §11 names verbatim.

- (2d) **Empty-diff edge case.** An empty `prDiff` produces `evidence: { paths: [], change_types: [], diff_size: 0 }`, no rule matches, fallback fires. The classifier does NOT short-circuit on empty diffs; the full walk runs and yields fallback by exhaustion — preserves the invariant that fallback is reachable only via "no rule matched".

**AC3 unpacked.** Two stamping surfaces:

**Surface 1: manifest field stamp.**

- (3a) **Schema widening.** `ExecutionManifestSchema` in `plugins/crew/mcp-server/src/schemas/execution-manifest.ts` gains:
  ```ts
  risk_tier: z.enum(["low", "medium", "high"]).optional(),
  ```
  Field is `.optional()` so historical `to-do/`, `blocked/`, `in-progress/`, and `done/` manifests (which carry no `risk_tier`) parse unchanged. Schema remains `.strict()`. Field is documented in a JSDoc block matching the convention used by `claimed_by` and `rework_count`: name the producer story (4.9b), name the consumer story (4.10b), name the value enum, note that absence ≡ "not yet classified".

- (3b) **Stamp site.** Inside `runReviewerSession`, after the classifier runs and BEFORE the existing `atomicWriteFile(resultFilePath, ...)` call (around the line that writes `reviewer-result.json`). Algorithm:
  1. Resolve the in-progress manifest path: `<targetRepoRoot>/.crew/state/manifests/in-progress/<ref>.yaml`.
  2. `readManifest(manifestPath)` via the existing `lib/manifest-io.ts` helper.
  3. Set `manifest.risk_tier = classification.tier`.
  4. `writeManifest(manifestPath, manifest)` — same file, atomic write, schema-validated round-trip on next read.
  Manifest path resolution: the in-progress directory convention is already established by `claimStory` (Story 4.1) and `processDevTranscript` (Stories 4.3b / 4.5 / 4.6). The classifier stamps on the in-progress manifest only — never on `to-do/`, `blocked/`, or `done/` directly. If the in-progress manifest is missing at stamp time (an unexpected state — `runReviewerSession` is only called after a successful claim), the stamp step raises the typed `MalformedExecutionManifestError` propagated by `readManifest`; this surfaces a real state-machine bug rather than silently dropping the stamp.

- (3c) **Idempotency on rework.** On a Story 4.3 rework iteration the reviewer re-runs against the refreshed `prDiff`. The classifier produces a fresh classification; the manifest stamp is overwritten in place. No history of prior `risk_tier` values is kept on the manifest — the verdict comment carries the most-recent run's evidence (Surface 2). A future story may add `risk_tier_history` if retro analysis demands it; v1 is single-valued.

- (3d) **Read-back contract.** Downstream consumers (Story 4.10b's auto-merge gate) read `manifest.risk_tier` via `readManifest`. A `done/<ref>.yaml` produced by this story carries `risk_tier` in its YAML body, and the field round-trips through `yaml.stringify(parseExecutionManifest(yaml.parse(raw)))` unchanged (this is the same round-trip invariant the schema docstring already documents for `claimed_by`).

**Surface 2: verdict-comment evidence block.**

- (3e) **`ReviewerResultFileShape` widening.** Three new optional fields on the interface in `run-reviewer-session.ts`:
  ```ts
  /** Risk-tier classifier output (Story 4.9b). Absent on records produced before the classifier shipped. */
  riskTier?: "low" | "medium" | "high";
  /** The matched rule id from risk-tiering.md, or the literal "fallback". Absent iff riskTier is absent. */
  riskMatchedRule?: string;
  /** The evidence block from the classifier's return value. Absent iff riskTier is absent. */
  riskEvidence?: { paths: string[]; change_types: string[]; diff_size: number };
  ```
  All three are populated together (all or none); a session-file with `riskTier` present but `riskMatchedRule` absent is malformed and SHOULD be treated as such by future readers (no v1 reader inspects these fields beyond `composeSummaryBody`'s render). The trio is persisted in the `JSON.stringify` call at the existing write site.

- (3f) **`composeSummaryBody` extension.** In `lib/compose-reviewer-summary.ts`, the body skeleton extends as:
  ```
  # Reviewer summary — ${ref}
  ## Acceptance criteria
  <per-AC lines>
  ## Standards check
  <per-criterion lines>
  [## Manual checks required before merge]
  [## Risk tier]                                   ← NEW: present iff riskTier is set
  <verdict line>

  `standards_version: ...` · `plugin_version: ...`
  <!-- crew:verdict:<pluginVersion>:<ref> -->
  ```
  The new section appears AFTER any `## Manual checks required before merge` section (so manual-check-required ACs remain top-of-page) and BEFORE the verdict line. The section is OMITTED entirely when `result.riskTier` is undefined — preserves the body shape for any historical re-render where the classifier didn't run.

- (3g) **`## Risk tier` section body shape.** When present, the section renders as:
  ```
  ## Risk tier

  - **Tier:** <tier>
  - **Matched rule:** `<matched_rule>`
  - **Diff size:** <diff_size> lines changed
  - **Change types:** <comma-separated change_types, or "none">
  - **Paths matched:** <count> file<s> (first 5 listed; full list elided when > 5)
    - `<path1>`
    - `<path2>`
    ...
  ```
  Path listing: if `evidence.paths.length === 0`, render `- **Paths matched:** none`. If `> 5`, render `- **Paths matched:** N files (showing first 5)` and the first 5 paths as a bulleted sub-list. If `1 ≤ N ≤ 5`, list all paths as a bulleted sub-list. Exact wording above is contract; tests assert on the line shapes.

- (3h) **PATCH-rerun preservation.** Story 4.7's PATCH-vs-POST handler in `postReviewerComments` PATCH-edits the prior verdict review in place. Because `composeSummaryBody` is called on every run with the freshest `ReviewerResultFileShape`, a rework PATCH naturally carries the latest `## Risk tier` block. The footer marker (`<!-- crew:verdict:<pluginVersion>:<ref> -->`) remains the absolute last line; the version-stamp line stays immediately above it; no other Story 4.7 contracts are altered.

- (3i) **Version stamping interaction.** Story 4.7's version-block line (`` `standards_version: ...` · `plugin_version: ...` ``) is unchanged. The risk-tier section does not stamp a `risk_tiering_version`. The spec file's `version:` field IS read by Story 4.9's loader and lives on the returned `RiskTieringSpec` shape, but it is not surfaced in the verdict comment in v1 (the matched-rule id already provides traceability). A follow-up story may add it; out of scope here.

**AC4 unpacked.** Integration test scope:

- (4a) **Test-file layout.** Three vitest test files, mirroring Story 4.9's split:
  - `plugins/crew/mcp-server/src/lib/__tests__/classify-risk-tier.test.ts` — pure-function tests for the four classification branches and edge cases.
  - `plugins/crew/mcp-server/src/lib/__tests__/detect-change-types.test.ts` — pattern-matrix tests for `detectChangeTypes`.
  - `plugins/crew/mcp-server/src/lib/__tests__/compose-reviewer-summary.test.ts` — extends the existing file (if present) or adds new cases for the `## Risk tier` section render shape.
  - A fourth integration test extends `plugins/crew/mcp-server/src/tools/__tests__/run-reviewer-session.test.ts` (or the closest existing file) to assert manifest stamping end-to-end.

- (4b) **(a) Path-match classification branch.** Fixture: spec with one `low` rule declaring `path_patterns: ["docs/**"]`. `prDiff` includes one `diff --git a/docs/foo.md b/docs/foo.md` block. Assert: `{ tier: "low", matched_rule: "<the-rule-id>", evidence: { paths: ["docs/foo.md"], change_types: [], diff_size: <count> } }`.

- (4c) **(b) Change-type-match classification branch.** Fixture: spec with one `high` rule declaring `change_types: ["migration"]`. `prDiff` includes a `db/migrate/2026...sql` path. Assert: classifier returns `tier: "high"`, `matched_rule: "<the-rule-id>"`, `evidence.change_types` contains `"migration"`.

- (4d) **(c) Size-match classification branch.** Fixture: spec with one `high` rule declaring `diff_size_thresholds: { min_lines_changed: 500 }`. `prDiff` includes 600 lines of `+` / `-` changes. Assert: classifier returns `tier: "high"`, `matched_rule: "<the-rule-id>"`, `evidence.diff_size === 600`.

- (4e) **(d) Fallback classification branch (AC2).** Fixture: spec with one `high` rule declaring `path_patterns: ["src/**/migrations/**"]`. `prDiff` touches only `README.md`. Assert: `tier: "medium"`, `matched_rule: "fallback"`, evidence populated from the diff.

- (4f) **Tier-walking-order coverage.** Fixture: spec with BOTH a `low` rule matching `docs/**` AND a `high` rule matching `change_types: ["migration"]`. `prDiff` touches `docs/foo.md` AND `db/migrate/x.sql`. Assert: `tier: "high"` (high wins over low per AC1 (1e)). One extra `it()` in the classifier test file.

- (4g) **Manifest-stamp end-to-end coverage (AC3 surface 1).** Use the existing `runReviewerSession` test fixture (or a minimal tmpdir-fixture variant): write a valid in-progress manifest, stub `gh pr-diff` via `execaImpl` to return a fixture diff that matches a known rule, invoke `runReviewerSession`. Assert: after the call, `readManifest(in-progress/<ref>.yaml).risk_tier === <expected-tier>`. The fixture diff is small enough that the classifier hits a deterministic branch.

- (4h) **Verdict-comment-render coverage (AC3 surface 2).** Two tests in the compose-summary test file:
  - With `riskTier: "low"`, `riskMatchedRule: "low.docs-only"`, and a 3-path `riskEvidence.paths`: assert the rendered body contains `## Risk tier`, contains `- **Tier:** low`, contains `- **Matched rule:** \`low.docs-only\``, contains `- **Paths matched:** 3 files`, and lists each path under it. Assert the verdict line still appears AFTER the section.
  - With `riskTier: undefined`: assert NO `## Risk tier` header appears anywhere in the rendered body — backward-compat for older session records.

- (4i) **Schema round-trip coverage.** Extend `schemas/__tests__/execution-manifest.test.ts` (if present; else add a new test file) with: write a YAML manifest including `risk_tier: medium`; parse via `parseExecutionManifest`; re-stringify via `yaml.stringify`; re-parse; assert `risk_tier === "medium"` round-trips intact. Also assert: a manifest WITHOUT `risk_tier` still parses cleanly (the field stays absent in `.optional()` mode); a manifest with `risk_tier: "extreme"` raises `MalformedExecutionManifestError` (enum violation).

- (4j) **`detectChangeTypes` matrix coverage.** One test per declared pattern family (migration, schema, dep-bump): a sampling of representative paths assert the expected change-type set is produced. One negative case: a path matching none (e.g. `src/foo.ts`) produces `[]`.

- (4k) **Non-regression — existing reviewer pipeline.** All existing `run-reviewer-session.test.ts`, `process-reviewer-transcript.test.ts`, `post-reviewer-comments.test.ts`, and `compose-reviewer-summary.test.ts` (if any) suites pass unchanged when the classifier output is present on `ReviewerResultFileShape`. Existing assertions on body shape may need to tolerate the new `## Risk tier` section in fixtures that populate the new fields — update any rigid full-body string match to a `toContain` or section-aware match.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Add `picomatch` as a dependency** (AC: #1, #4)
  - [ ] 1.1 In `plugins/crew/mcp-server/package.json`, add `"picomatch": "^4.0.2"` to `dependencies` and `"@types/picomatch": "^3.0.1"` to `devDependencies`. Use the latest 4.x release at implementation time; lockfile update belongs to the implementer.
  - [ ] 1.2 `pnpm install` from `plugins/crew/mcp-server/`. Commit the `pnpm-lock.yaml` delta as part of this story.
  - [ ] 1.3 If the install diff to `pnpm-lock.yaml` is non-trivial (more than `picomatch` and its transitive deps appearing for the first time), flag it for human eyeball — unrelated dep changes should not slip in.

- [ ] **Task 2: Widen `ExecutionManifestSchema` with `risk_tier`** (AC: #3, #4i)
  - [ ] 2.1 In `plugins/crew/mcp-server/src/schemas/execution-manifest.ts`, add `risk_tier: z.enum(["low", "medium", "high"]).optional(),` after the `rework_count` field. Match the JSDoc convention used by `claimed_by` (cite producer story 4.9b, consumer story 4.10b, note the absent-≡-unclassified semantics, note that the field round-trips through `yaml.stringify`).
  - [ ] 2.2 Update the schema-level docstring's status-vocabulary paragraph to note the additive widening (mirror the wording used when `claimed_by` and `rework_count` were added). No behavioural change to the parser; the existing `parseExecutionManifest` continues to wrap Zod failures in `MalformedExecutionManifestError`.
  - [ ] 2.3 No `errors.ts` change required — Zod's enum-violation message is funnelled through the existing `MalformedExecutionManifestError` wrapper.

- [ ] **Task 3: Implement `detectChangeTypes` helper** (AC: #1d, #4j)
  - [ ] 3.1 Create `plugins/crew/mcp-server/src/lib/detect-change-types.ts`. Export `detectChangeTypes(paths: string[]): ChangeType[]`.
  - [ ] 3.2 Per AC1 unpacked (1d), implement the pattern matrix as a literal array of `{ type: ChangeType; patterns: RegExp[] }` records. Each path is tested against each record; matches add the type to a `Set<ChangeType>`. Return the set converted to a sorted array using the canonical order `migration < schema < dep-bump`.
  - [ ] 3.3 Add a JSDoc block citing this story key, FR40a, and the v1 limitation (no `revert` detection, see § Deferred work).
  - [ ] 3.4 Export `type ChangeType` re-exported from `schemas/risk-tiering-spec.ts` for one-stop import by the classifier.

- [ ] **Task 4: Implement `classifyRiskTier` pure function** (AC: #1, #2, #4a–4f)
  - [ ] 4.1 Create `plugins/crew/mcp-server/src/lib/classify-risk-tier.ts`. Export `classifyRiskTier(input: { spec: RiskTieringSpec; prDiff: string }): RiskTierClassification`. Export the `RiskTierClassification` type alongside.
  - [ ] 4.2 Diff parsing helpers (private to the module): `parsePaths(prDiff)` returns sorted unique `b/`-side paths via `/^diff --git a\/(.+?) b\/(.+?)$/gm`; `countDiffSize(prDiff)` returns integer per AC1 (1c). Avoid pulling in a diff-parsing library — the format we accept from `gh pr-diff` is a stable subset.
  - [ ] 4.3 Build `evidence`: `{ paths: parsePaths(prDiff), change_types: detectChangeTypes(paths), diff_size: countDiffSize(prDiff) }`.
  - [ ] 4.4 Tier-walking loop per AC1 (1e): iterate `["high", "medium", "low"]`. For each tier, iterate `spec.tiers[tier] ?? []` in declaration order. For each rule, call `matchRule(rule, evidence)` (private helper).
  - [ ] 4.5 `matchRule(rule, evidence)` per AC1 (1f): all declared signal fields must match. Use `picomatch(pattern, { dot: true })` for path patterns — compile once per rule call. Change-type and size checks are integer/array primitives — no library required.
  - [ ] 4.6 On match: return `{ tier, matched_rule: rule.id, evidence }`. On loop exhaustion: return `{ tier: spec.fallback_tier, matched_rule: "fallback", evidence }`.
  - [ ] 4.7 JSDoc block citing this story key, FR40a, Pattern §11, and the rule-walking-order rationale (high-wins-over-low).

- [ ] **Task 5: Register `classify-risk-tier` MCP tool** (AC: #1, #2)
  - [ ] 5.1 Create `plugins/crew/mcp-server/src/tools/classify-risk-tier.ts`. Export `classifyRiskTierTool(opts: { targetRepoRoot: string; pluginRoot?: string; prDiff: string }): Promise<RiskTierClassification>`. The tool loads the spec via `lookupRiskTieringSpec({ targetRepoRoot, pluginRoot: pluginRoot ?? getPluginRoot() })` and delegates to `classifyRiskTier({ spec, prDiff })`.
  - [ ] 5.2 In `plugins/crew/mcp-server/src/tools/register.ts`, append a `server.registerTool({ name: "classify-risk-tier", ... })` call following the existing pattern (input schema via Zod, output schema via Zod, handler invokes the tool). Place it after the most-recently-registered Epic 4 tool. Update any tool-count assertions in the test suite by +1 (search the suite for hard-coded counts).
  - [ ] 5.3 Input schema: `z.object({ targetRepoRoot: z.string(), prDiff: z.string() })`. Output schema mirrors `RiskTierClassification`.
  - [ ] 5.4 No new permission spec needed — the tool reads files via existing helpers (`lookupRiskTieringSpec`, no `gh` call). Confirm `permissions/generalist-reviewer.yaml` does NOT need updating (the reviewer subagent will invoke `classify-risk-tier` via MCP, not via `gh`).

- [ ] **Task 6: Wire classifier into `runReviewerSession` (manifest stamp + result file fields)** (AC: #3, #4g, #4k)
  - [ ] 6.1 In `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`, after the `prDiff` is fetched (existing `gh pr-diff` call) and BEFORE the existing `recommendedVerdict` derivation:
    - Load the risk-tiering spec: `const riskSpec = await lookupRiskTieringSpec({ targetRepoRoot, pluginRoot });`.
    - Classify: `const classification = classifyRiskTier({ spec: riskSpec, prDiff });`.
  - [ ] 6.2 Stamp the in-progress manifest (per AC3 (3b)):
    - `const manifestPath = path.resolve(targetRepoRoot, ".crew", "state", "manifests", "in-progress", \`${ref}.yaml\`);`
    - `const manifest = await readManifest(manifestPath);`
    - `manifest.risk_tier = classification.tier;`
    - `await writeManifest(manifestPath, manifest);`
  - [ ] 6.3 Widen `ReviewerResultFileShape` per AC3 (3e): add three optional fields. Populate them in the `fileProjection` literal:
    - `riskTier: classification.tier,`
    - `riskMatchedRule: classification.matched_rule,`
    - `riskEvidence: classification.evidence,`
  - [ ] 6.4 Widen `ReviewerSessionResult` (the in-memory return shape) symmetrically — same three optional fields, populated from the same `classification` object. Existing tests that destructure the return value are unaffected (the new fields are additive).
  - [ ] 6.5 No SKILL.md change required — the reviewer SKILL.md does not destructure or surface these fields directly; they flow through `reviewer-result.json` to `composeSummaryBody`. (SKILL.md is locked by Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7 — confirm no edit is needed.)

- [ ] **Task 7: Render `## Risk tier` section in `composeSummaryBody`** (AC: #3, #4h)
  - [ ] 7.1 In `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts`, between the manual-checks section logic and the verdict-line push, add a conditional render block: if `result.riskTier !== undefined`, build the `## Risk tier` section per AC3 (3g) and append it to `parts` via `parts.push("", riskTierSection)`. If `result.riskTier === undefined`, skip — preserves backward-compat for any historical re-render.
  - [ ] 7.2 The path-listing branch logic: 0 paths → single-line "none"; 1–5 paths → "<n> file(s)" header + bulleted sub-list; >5 paths → "N files (showing first 5)" + bulleted sub-list of `paths.slice(0, 5)`. Tests pin the exact strings.
  - [ ] 7.3 The verdict line, the version-stamp line, and the footer marker positions are NOT changed. The new section appears immediately before the verdict line; the manual-checks section (if present) appears immediately before the new section. Order from top to bottom: AC section → Standards section → [Manual checks] → [Risk tier] → verdict line → version line → footer marker.
  - [ ] 7.4 Update `ReviewerResultFileShape` import in `compose-reviewer-summary.ts` if needed — the file already imports from `run-reviewer-session.ts` (which is now widened in Task 6.3); no separate import change required, but verify TypeScript is happy with the new fields.

- [ ] **Task 8: Integration test suite** (AC: #4)
  - [ ] 8.1 Create `plugins/crew/mcp-server/src/lib/__tests__/classify-risk-tier.test.ts`. Implement cases (4b)–(4f) per AC4 unpacked. Use literal-string `prDiff` fixtures (small diffs are clearest in-line; large diffs go in a `__fixtures__/` subdir if needed). Each test asserts on the full `RiskTierClassification` object via `toEqual` for deterministic regression coverage.
  - [ ] 8.2 Create `plugins/crew/mcp-server/src/lib/__tests__/detect-change-types.test.ts`. Implement case (4j). One `describe` block per pattern family; one negative `it()` for non-matches.
  - [ ] 8.3 Extend `plugins/crew/mcp-server/src/lib/__tests__/compose-reviewer-summary.test.ts` (or create it if absent) with the two cases in (4h). Use a minimal `ReviewerResultFileShape` fixture with hard-coded `acResults`, `standardsByCriterionId`, etc.
  - [ ] 8.4 Extend `plugins/crew/mcp-server/src/tools/__tests__/run-reviewer-session.test.ts` (or the nearest equivalent integration suite) with the (4g) end-to-end manifest-stamp case. Fixture: tmpdir `targetRepoRoot` with `.crew/state/manifests/in-progress/<ref>.yaml` pre-populated; stub `gh pr-diff` via `execaImpl`; assert post-call `readManifest(...).risk_tier === <expected>`. Also assert the returned `ReviewerSessionResult` carries the new fields.
  - [ ] 8.5 Extend `plugins/crew/mcp-server/src/schemas/__tests__/execution-manifest.test.ts` (or create if absent) with (4i) round-trip and enum-violation coverage.
  - [ ] 8.6 No test asserts on the JSONL telemetry stream — telemetry is Story 4.12's surface.

- [ ] **Task 9: Build, vitest, dist** (AC: all)
  - [ ] 9.1 `pnpm build` (from `plugins/crew/mcp-server/`) passes. TypeScript surfaces no errors from the new files or the widened interface fields.
  - [ ] 9.2 All vitest tests pass — both new tests and the existing suite (no regression). Run `pnpm vitest --run` from `plugins/crew/mcp-server/`.
  - [ ] 9.3 Tool count assertion (if any) bumped by +1 for the new `classify-risk-tier` registration. Grep the test suite for any hardcoded tool count and update it; a JSDoc comment on the assertion should cite this story key.
  - [ ] 9.4 Commit `dist/` per CLAUDE.md. The rebuild picks up the new `lib/`, `tools/`, and `schemas/` files plus the widened `register.ts`.
  - [ ] 9.5 Confirm `canonical-fs-guard.test.ts` still passes — the new manifest write goes through `writeManifest` (already canonical), and no other writes are added.
  - [ ] 9.6 Confirm `pnpm-lock.yaml` diff is bounded to `picomatch` + its transitive deps.

---

## Implementation strategy

### Why `picomatch` (not `minimatch`, not `micromatch`)

`picomatch` is the lightest pure-JS glob matcher with no dependencies. It is the engine inside `micromatch` and the matcher used by Vite, Vitest, Rollup, and `fast-glob` — so it is already transitively present in many of the plugin's dev-dep trees. Pulling it as a direct dependency makes the relationship explicit. `minimatch` is heavier and has Node-version skew; `micromatch` is `picomatch` plus a layer the classifier doesn't need.

### Why diff parsing is local string scanning (not a diff library)

The diff text comes from `gh pr-diff`, which emits standard Git unified-diff format. The two signals we need — file paths and `+`/`-` line counts — are trivially extractable by regex/string scanning. A full diff-parsing library (`parse-diff`, `gitdiff-parser`) would add 1–2 transitive dependencies and a class hierarchy for a 30-line scan job. Story 4.6 establishes a precedent of in-tool diff handling without a library; we follow it.

### Why the classifier walks tiers high → medium → low

The architecture-pin contract is that `risk_tier` drives auto-merge in Story 4.10b: `low` auto-merges, `medium`/`high` pause for human review. The right asymmetry is "if in doubt, pause the human in". If a PR touches both `docs/foo.md` (would-match a `low` docs-only rule) AND `db/migrations/x.sql` (would-match a `high` migration rule), classifying as `low` and auto-merging would be a bad surprise. High wins. Within a tier, declaration order from the spec file is canonical (operator's expressed preference).

### Why change-type detection is filename-pattern-only in v1

The four `change_types` the spec schema admits are `revert | migration | schema | dep-bump`. Three of those (`migration`, `schema`, `dep-bump`) are reliably detectable from filename patterns alone — the conventions are stable across most ecosystems. `revert` is fundamentally a metadata signal (commit message prefix, GitHub's "Revert" button) that the diff stdout doesn't carry. Adding a second `gh pr-view --json title` fetch just for revert-detection in v1 is overkill when no shipped rule in the v1 default file matches on `revert`. The detector stays single-source (the diff text); revert lands in a follow-up alongside its first consuming rule.

### Why the manifest field is `.optional()` rather than required

Historical manifests — `to-do/`, `blocked/`, and any pre-existing `in-progress/` — were written without `risk_tier`. Requiring it in the schema would break those parses. The `.optional()` widening is identical in shape to Story 4.1's `claimed_by` addition and Story 4.3's `rework_count` addition — both shipped as additive, neither broke historical parses. The Story 4.10b consumer treats `manifest.risk_tier === undefined` as "not classified" (already declared in Story 4.10b's epic AC narrative).

### Why the stamp happens inside `runReviewerSession` rather than a separate orchestrator step

The classifier needs the `prDiff` (already fetched inside `runReviewerSession` at the existing `gh pr-diff` site), the `targetRepoRoot` (already a tool input), and the in-progress manifest (path computable from `targetRepoRoot` + `ref`). Adding a separate SKILL.md call site would require a new tool invocation, a new chat-to-MCP round-trip, and a new failure mode (orchestrator could forget to call it). Co-locating with the existing diff fetch makes the classifier's call site a fixed beat of every reviewer pass.

### Why widening locked files is the right call here (not a separate wrapper)

`runReviewerSession` is locked by Story 4.6; `ReviewerResultFileShape` is the persisted projection that file declares. The architecture-pin requires the classifier output to ride this projection so `composeSummaryBody` can render it. The alternatives — adding a parallel `risk-tier.json` session file, or a wrapper tool that calls `runReviewerSession` then mutates the result file post-hoc — both add a coupling surface that's more fragile than additively widening the shape. Story 4.8b set the precedent: when the architecture-pin demands a write inside a locked tool, declare the locked-file change explicitly and ship the additive widening. The risk-tier widening on `runReviewerSession` follows the same pattern (4.8b §What this story does NOT (a)–(c) gives the prose).

### Why the verdict-comment section sits between `## Manual checks required before merge` and the verdict line

The reading order matters for the operator scanning a PR comment: most-actionable-at-top, summary-at-bottom. ACs and standards are the substantive content. Manual checks (if present) are the operator's red-flag list — they belong above any auto-classified meta. Risk-tier is meta about the PR itself — it belongs immediately above the verdict line so the operator's eye flows risk → verdict in one beat. The version stamp and footer marker stay where Story 4.7 placed them.

### Why fallback returns `spec.fallback_tier` rather than a hardcoded `"medium"`

The Story 4.9 schema currently validates `fallback_tier` as literally `"medium"`. The classifier reads from `spec.fallback_tier` rather than hardcoding the literal so a future Story 4.9 widening (e.g. allowing target-repo overrides to set `fallback_tier: low` for an opt-in trust-by-default policy) needs zero classifier change. This is a one-line read-from-spec; the cost of the defensive read is negligible.

---

## Locked files

These files are off-limits to this story. If a change appears necessary, STOP and surface the conflict — do not silently edit.

- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` (Story 4.1 / 4.2)
- `plugins/crew/mcp-server/src/tools/claim-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Story 4.6 revision 2)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Stories 4.6b / 4.7)
- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts` (Story 4.4 / 4.8b)
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Stories 4.3b / 4.5 / 4.6 / 4.8b)
- `plugins/crew/skills/start/SKILL.md` (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7) — no SKILL.md change in this story; the classifier output flows through `reviewer-result.json` to `composeSummaryBody` without prose involvement.
- `plugins/crew/permissions/generalist-reviewer.yaml` (Stories 2.2 / 4.6 / 4.7 / 4.8) — no permission change; `classify-risk-tier` reads files, makes no `gh` call.
- `plugins/crew/mcp-server/src/schemas/risk-tiering-spec.ts` (Story 4.9) — consumed as-is.
- `plugins/crew/mcp-server/src/validators/risk-tiering-spec.ts` (Story 4.9) — consumed as-is.
- `plugins/crew/mcp-server/src/state/lookup-risk-tiering-spec.ts` (Story 4.9) — consumed as-is.
- `plugins/crew/docs/risk-tiering.md` (Story 4.9) — consumed as-is.

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`** (Story 4.6) — Task 6 inserts the classifier call between the `gh pr-diff` fetch and the `recommendedVerdict` derivation, stamps the in-progress manifest via `manifest-io`, and widens `ReviewerResultFileShape` + `ReviewerSessionResult` additively with three optional risk-evidence fields. The Story 4.6 derivation logic, the per-AC runner code, and the existing file-write call are NOT modified. Wiring is load-bearing for AC3 (architecture pattern §11 requires the manifest stamp + verdict evidence to be written by the reviewer's call site).
- **`plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts`** (Story 4.6b / 4.7 — implicit lock from those stories' coverage) — Task 7 adds a new conditional `## Risk tier` section between the optional manual-checks section and the verdict line. No existing section's wording, position, or contract is changed; the footer marker remains the absolute last line.
- **`plugins/crew/mcp-server/src/schemas/execution-manifest.ts`** (Story 3.2 / 3.5) — Task 2 appends an optional `risk_tier` enum field. No existing field is modified. Routine additive growth, same shape as Story 4.1's `claimed_by` and Story 4.3's `rework_count`. FR10 has always pinned `risk_tier` as a manifest-frontmatter field; the deferral of the implementation to this story is consistent with Story 4.9's narrative.
- **`plugins/crew/mcp-server/src/tools/register.ts`** (touched by most Epic-1 through Epic-4 stories) — Task 5.2 appends a `classify-risk-tier` registration. No existing registration is modified.
- **`plugins/crew/mcp-server/package.json` + `pnpm-lock.yaml`** — Task 1 adds `picomatch` and `@types/picomatch`. Routine dep-addition; lockfile diff is bounded.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/lib/classify-risk-tier.ts` (Task 4)
- `plugins/crew/mcp-server/src/lib/detect-change-types.ts` (Task 3)
- `plugins/crew/mcp-server/src/tools/classify-risk-tier.ts` (Task 5.1)
- `plugins/crew/mcp-server/src/lib/__tests__/classify-risk-tier.test.ts` (Task 8.1)
- `plugins/crew/mcp-server/src/lib/__tests__/detect-change-types.test.ts` (Task 8.2)

### Files this story will modify

- `plugins/crew/mcp-server/src/schemas/execution-manifest.ts` (Task 2)
- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Task 6)
- `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts` (Task 7)
- `plugins/crew/mcp-server/src/tools/register.ts` (Task 5.2)
- `plugins/crew/mcp-server/package.json` (Task 1.1)
- `plugins/crew/mcp-server/pnpm-lock.yaml` (Task 1.2)
- `plugins/crew/mcp-server/src/lib/__tests__/compose-reviewer-summary.test.ts` (Task 8.3 — create if absent)
- `plugins/crew/mcp-server/src/tools/__tests__/run-reviewer-session.test.ts` (Task 8.4 — extend)
- `plugins/crew/mcp-server/src/schemas/__tests__/execution-manifest.test.ts` (Task 8.5 — extend or create)
- `plugins/crew/mcp-server/dist/` (Task 9.4; rebuild and commit)

### Current-state notes on files being modified

- **`execution-manifest.ts`** (current state per Story 4.1 / 4.3): schema is `.strict()`, declares `claimed_by` (optional) and `rework_count` (optional). The `risk_tier` widening follows the same shape verbatim. The status enum (`"to-do" | "blocked" | "in-progress" | "done"`) is unchanged.
- **`run-reviewer-session.ts`** (current state per Story 4.6 revision 2 / 4.7): `runReviewerSession` already fetches `prDiff` via `gh pr-diff` (line ~333), derives `recommendedVerdict` (line ~408), writes `reviewer-result.json` (line ~437). Task 6's insertions go between the `prDiff` fetch and the `recommendedVerdict` derivation (classifier call); the manifest-stamp goes immediately after the classifier call; the file-projection widening goes inline in the existing `fileProjection` literal.
- **`compose-reviewer-summary.ts`** (current state per Story 4.7): exports `composeSummaryBody(result, versionInfo)`. The body is assembled via a `parts: string[]` array with `parts.push(...)` calls; the manual-checks section is conditionally appended before the verdict line; the version line and footer marker are unconditionally appended at the end. Task 7 inserts the `## Risk tier` section into this assembly between the manual-checks and the verdict line.
- **`register.ts`** (current state per Story 4.8): contains ~28 `server.registerTool(...)` calls across all MCP tools. Task 5.2 appends one more.

### Testing standards

- vitest with `pnpm vitest --run` from `plugins/crew/mcp-server/`.
- `os.tmpdir() + crypto.randomUUID()` for tmpdir fixtures; `fs.rm(..., { recursive: true })` in `afterEach`.
- For pure-function tests (`classify-risk-tier`, `detect-change-types`): use literal-string fixtures inline; no tmpdirs needed.
- For `compose-reviewer-summary` tests: use a hand-crafted `ReviewerResultFileShape` literal with hard-coded `acResults`, `standardsByCriterionId`, etc. — no need to drive the full reviewer pipeline.
- For the `runReviewerSession` end-to-end test (Task 8.4): pre-populate the in-progress manifest, stub `gh pr-diff` via `execaImpl`, invoke the tool, assert on the post-call manifest state.
- Pin the rule-walking-order test (4f) — without it, a future implementer could swap to low → medium → high walking and silently break the conservative-tier invariant.

### Dependencies

- Story 4.9 (`docs/risk-tiering.md` shipped default + loader + schema + validator + typed errors) — consumed as-is via `lookupRiskTieringSpec`.
- Story 4.6 (`runReviewerSession` — locked, declared exception in Task 6) — provides the call site.
- Story 4.6b / 4.7 (`composeSummaryBody`, `ReviewerResultFileShape`) — extended by Task 6.3 and Task 7.
- Story 4.1 / 4.3 / 4.3b (manifest state machine, `lib/manifest-io.ts`) — `readManifest` / `writeManifest` used by Task 6.2.
- Story 3.2 / 3.5 (`ExecutionManifestSchema`) — additively widened by Task 2.
- Architecture § "Risk-Tier Classification (FR40a) — Spec Format" — pins the high-tier-wins-on-conflict semantics and the fallback contract.
- Architecture § "Risk-Tier Classifier Output Shape" (Pattern §11) — pins the output shape and the two stamping surfaces.
- FR10 (`prd-crew-v1/functional-requirements.md` line 19) — pins `risk_tier` as a story-frontmatter field.
- FR40a — pins the classification-rules requirement.

### Downstream callers (not implemented by this story)

- Story 4.10b: Reads `manifest.risk_tier` to drive the auto-merge gate (`low + agreement ≥ threshold` auto-merges; `medium`/`high` pause).
- Story 4.12: Adds telemetry emission for `reviewer.risk-tier-classified` with the evidence payload.
- Future Epic-5 story: Surfaces `risk_tier` in `/crew:status` output.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.9b`]
- [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`] (§ Risk-Tier Classification)
- [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md`] (§ 11 Risk-Tier Classifier Output Shape)
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] (FR10, FR40, FR40a, FR41)
- [Source: `_bmad-output/implementation-artifacts/4-9-risk-tiering-spec-format-and-override-resolution.md`] (substrate this story consumes)
- [Source: `plugins/crew/mcp-server/src/state/lookup-risk-tiering-spec.ts`] (Story 4.9 loader)
- [Source: `plugins/crew/mcp-server/src/schemas/risk-tiering-spec.ts`] (Story 4.9 schema; `ChangeType` import source)
- [Source: `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`] (Task 6 call site)
- [Source: `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts`] (Task 7 render site)
- [Source: `plugins/crew/mcp-server/src/lib/manifest-io.ts`] (`readManifest` / `writeManifest` for Task 6.2)
- [Source: `plugins/crew/mcp-server/src/schemas/execution-manifest.ts`] (Task 2 widening)
- [Source: `plugins/crew/docs/user-surface-acs.md`] (substrate-vs-user-surface judgement)

---

## Previous story intelligence

### From Story 4.9 (recently authored — direct upstream substrate)

- Ships `RiskTieringSpec` shape, `parseRiskTieringSpec`, `lookupRiskTieringSpec`, `MalformedRiskTieringSpecError`, `ShippedRiskTieringDefaultMissingError`. 4.9b consumes the loader's `Promise<RiskTieringSpec>` directly.
- Picomatch dependency is deliberately deferred to 4.9b (4.9 §What this story does NOT (p)). Task 1 lands it here.
- 4.9's spec asserted (incorrectly) that `risk_tier` was already on `ExecutionManifestSchema`. Task 2 corrects that gap. The widening is additive and risk-free.

### From Story 4.8b (most recent merged — adjacent voice)

- Established the precedent for declared-locked-file exceptions when an architecture-pin requires a write inside a locked tool. 4.8b widened `runDevTerminalAction` (locked by 4.4) with an additive write of `dev-outcome.json`. 4.9b follows the same shape: additive widening of `runReviewerSession` (locked by 4.6) with the classifier call and manifest stamp.
- 4.8b also extended `ReviewerResultFileShape`-adjacent code (session-state JSON file shape on the dev side). 4.9b extends the reviewer side analogously.

### From Story 4.7 (shipped)

- Verdict version stamping convention: the body carries `` `standards_version: ...` · `plugin_version: ...` `` immediately above the footer marker. 4.9b's `## Risk tier` section sits above the verdict line, BELOW the manual-checks section, and ABOVE the version-stamp line — the version-stamp convention is unchanged.
- PATCH-vs-POST handler in `postReviewerComments` is preserved verbatim; the risk-tier section flows through whichever path the existing handler picks on the run.

### From Story 4.6 (shipped — primary call site)

- `runReviewerSession` reads `prDiff` via `gh pr-diff`, derives `recommendedVerdict`, persists `reviewer-result.json`. 4.9b's classifier call goes between the diff fetch and the verdict derivation; the manifest stamp goes immediately after; the file-projection widening goes inline.
- `ReviewerResultFileShape` is the persisted projection; widening it is the architecturally-clean way to surface classifier output to the verdict comment composer.

### From Story 1.3 (shipped — pattern source for the loader call)

- `lookupStandards` / `parseStandardsDoc` / `StandardsDocSchema` triad established the IO+pure-validator+schema separation. Story 4.9 mirrored it for risk-tiering. 4.9b consumes the IO layer (`lookupRiskTieringSpec`) and adds its own pure classifier — same separation, different layer.

### Git intelligence (recent commits)

```
1d292b6 spec(4-9): author spec for risk-tiering spec format and override resolution (#120)
b99347d feat(4): Reviewer labels and negative-capability enforcement (#119)
7885266 spec: 4-8b-deterministic-seam-hardening-handoff-parser-and-pr-url-extraction (#118)
389cf70 feat(4): Verdict version stamping and footer-marker idempotent rerun (#116)
c7d5c74 feat(4): Reviewer posts inline comments and summary verdict (#112)
```

Pattern: Epic 4 commits follow `feat(4.X): <subject>`. Story 4.9b's commit follows `feat(4.9b): <subject>`. Spec commits follow `spec(<key>): <subject>` or `spec: <key>`.

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
