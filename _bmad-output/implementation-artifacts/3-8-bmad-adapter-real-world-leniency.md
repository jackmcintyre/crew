# Story 3.8: BMad adapter leniency for real-world BMad backlogs

story_shape: user-surface

Status: backlog

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator pointing crew at an existing BMad-shaped backlog**,
I want **the BMad adapter to absorb the deviations real BMad repos accumulate over time — letter-suffixed follow-up story IDs (`4-8b`, `5-4b`, `6-13`), spec files missing a `Status:` line, spec files carrying a `Status:` value outside the canonical vocabulary, retro and bookkeeping files sharing the stories directory — and the `/crew:status` output to stop labelling the adapter `mismatched` whenever an explicit `adapter_config.stories_root` legitimately points the adapter somewhere other than its default**,
so that **I can run `/crew:scan` and `/crew:status` against my live BMad backlog without first mass-rewriting every existing spec, and the first thing the dogfooding operator sees is not a misleading "looks broken" surface**.

### What this story is, in one sentence

Soften four hard-fail / over-strict surfaces in the BMad adapter and `/crew:status` formatter so the v1 reference implementation (Story 3.3) — which was written against a strict-BMad fixture — survives contact with a real BMad repo whose stories directory has organically diverged from the fixture shape, without compromising the discipline gate (Story 3.5) for stories that DO parse.

### What this story fixes (and why it needs its own story)

Surfaced on 2026-05-25 during the first attempted dogfood of `/crew:start` against the `crew` repo's own backlog (PR #126 captured the scope into the epic). The BMad adapter v1 (Story 3.3) was built against a synthetic fixture that mirrored BMad's idealised authoring shape: every story file is named `<epic>-<story>-<slug>.md` with no letter suffix, every file carries a canonical `Status:` line drawn from the closed BMad vocabulary, and the stories directory contains only story files. Real BMad backlogs — including this repo's own `_bmad-output/implementation-artifacts/` — drift away from the ideal:

- **Letter-suffixed follow-up story IDs.** When a story is decomposed mid-cycle or a follow-up patch is authored, the convention is `4-8b`, `5-4b`, `6-13`-style filenames. About ten such files exist in this repo's backlog. The adapter's filename regex (`^(\d+)-(\d+)-([a-z0-9-]+)\.md$` in `parse-bmad-story.ts`, line 17; same shape in `index.ts`'s `BMAD_FILENAME_RE`, line 87) rejects the letter suffix and surfaces the file as `MalformedBmadStoryError`. With the current scan-sources halt-on-throw behaviour, the very first such file aborts the whole scan and the operator never sees stories further down the list.
- **Missing `Status:` lines.** Forty-one of the forty-five specs in this repo's `_bmad-output/implementation-artifacts/` have no `Status:` line. They were authored by the spec-author-topup routine and similar pre-status-bookkeeping flows; the orchestrator's status lives in `sprint-status.yaml` rather than the spec file. The adapter currently throws `MalformedBmadStoryError` with `reason: "no 'Status: <value>' line found between H1 and the first section heading"` on each one.
- **Non-canonical `Status:` values.** A handful of specs carry free-text status notes (`Status: revised — re-implement per ...`) or values outside the closed BMad vocabulary (`Status: review`). The current `isKnownBmadStatus` check (`parse-bmad-story.ts` line 88, 165–174) throws `MalformedBmadStoryError` with `reason: "unknown Status value '<value>'"`.
- **Non-story files in the stories directory.** This repo's `_bmad-output/implementation-artifacts/` legitimately contains retro files (`epic-1-retro-2026-05-20.md`, `epic-3-retro-2026-05-21.md`), `sprint-status.yaml`, and other bookkeeping. The current `BMAD_FILENAME_RE` filter in `readStoriesDir` (`index.ts` line 87, used at lines 102 and 132) silently skips files that do not match the filename pattern, so retros and `sprint-status.yaml` are NOT the throw source — but the letter-suffix regex (e.g. `4-8b-...md`) is a near-miss that fails the filter as a "story-shaped but malformed" file. Today the filter only catches structurally non-story files; it does not yet skip the silently-disqualified letter-suffix variants from the throwing parser path (because they pass `readStoriesDir`'s gate but fail `parseBmadStory`'s gate). The fix is to widen both regexes consistently so letter-suffixed refs flow through both gates as first-class stories.
- **`/crew:status` mismatch label on adapter-config override.** `validateActiveAdapter` calls `BmadAdapter.detect(targetRepo)`, which scans only the hard-coded `DEFAULT_STORIES_ROOT` (`_bmad-output/planning-artifacts/stories`). On this repo, `.crew/config.yaml` declares `adapter: bmad` with `adapter_config.stories_root: _bmad-output/implementation-artifacts`. The default location is empty, so `detect()` returns false, and `validateActiveAdapter` downgrades the adapter report to `state: "mismatched"`. The status surface then prints `adapter: bmad (mismatched)` — misleading, because the operator's explicit override is the source of truth per Story 3.3b's adapter-config seam. The first dogfooder reads "mismatched" as "the install is broken" and bounces.

Without leniency, the operator cannot dogfood `/crew:start` against the crew repo's own backlog (or any other real BMad backlog with similar drift) — the prerequisite step (`/crew:scan` producing a usable to-do/ tree) halts on the first non-conforming file. The story makes the adapter accept reality while preserving the discipline gate for stories that DO parse: letter-suffixed refs are first-class; missing-status defaults to backlog; unknown-status becomes a per-file warning plus a blocked manifest carrying a new `blocked_by: status-vocabulary-unknown` reason; non-story files are silently skipped; and the `/crew:status` formatter respects an explicit `adapter_config.stories_root` override instead of trumpeting "mismatched".

### This story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Change the `PlanningAdapter` interface signature in `mcp-server/src/adapters/adapter.ts`. Every change in this story is internal to the BMad adapter, the `validateActiveAdapter` / `get-status` composition, or the existing `execution-manifest.ts` `blocked_by` open-string fallback. No new interface method, no new field on `SourceStory`, no new adapter capability flag.
- (c) Change the `ExecutionManifestSchema` shape. The existing `blocked_by` union already accepts an open-string fallback (`schemas/execution-manifest.ts` line 129–137), so `"status-vocabulary-unknown"` lands in that fallback. No new schema field, no new discipline-violation code.
- (d) Mass-rewrite existing specs in `_bmad-output/implementation-artifacts/` to add missing `Status:` lines, normalise free-text values, or rename letter-suffixed files. The whole point of the story is to accept the directory as it stands. The orchestrator's `sprint-status.yaml` remains the source of truth for status; the adapter's per-file `Status:` parse is a best-effort projection.
- (e) Promote letter-suffixed refs to a different ref namespace. `4-8b` parses to `bmad:4.8b` (preserving the literal letter suffix in the story portion of the ref). The ref namespace stays `bmad:` — no `bmad-suffix:` or similar prefix is introduced.
- (f) Implement reconciliation between the per-file `Status:` line and the orchestrator's `sprint-status.yaml`. Story 3.3 AC3 already specifies a reconciliation prompt; this story preserves it for stories whose `Status:` IS canonical. Default-status fallback (this story's AC2) is silent — no reconciliation prompt, no warning — because the absence of a `Status:` line is the dominant case in real backlogs and a per-file warning would drown the operator. Reconciliation for missing-status files is deferred until an operator explicitly requests it.
- (g) Add a CLI flag, config-file knob, or environment variable to gate the leniency. The leniency is the default behaviour for v1; there is no "strict mode" toggle. Discipline failures (Story 3.5 — missing integration AC, missing depends_on, etc.) continue to surface as `discipline-violation` blocks regardless. The leniency is for parser-level deviations only.
- (h) Touch the native adapter, the `/crew:plan` skill, or any planner catalogue prompt. This story is BMad-specific. Native source stories follow a different shape; the native parser's regex set is unchanged.
- (i) Add a structured warning channel or telemetry event for the per-file warnings. Warnings go to the existing scan-output surface (the structured `result.skippedRefs` and `result.warnings` arrays returned by `scanSources`, surfaced through the existing `/crew:scan` text formatter). No new JSONL event, no new pino category — the existing logging seams carry the new warning shape.
- (j) Reorder or move existing manifests in `.crew/state/`. The leniency runs at parse time; the state-machine directory layout (Story 1.6 / Story 3.2) is unchanged. New letter-suffixed refs land in `to-do/<ref>.yaml` like any other ref. Unknown-status refs land in `blocked/<ref>.yaml` carrying the new `blocked_by` value.
- (k) Change the discipline gate's rules or the `validateAgainstDiscipline` flow. Stories that parse continue to flow through Story 3.5's gate; stories that fail at parse time (now: only files that ARE story-shaped but cannot be parsed at all — e.g. truly malformed H1) continue to halt the scan as before. The leniency is for the specific four parse failures named in the ACs, not a blanket "swallow every parser error" downgrade.
- (l) Add a UI affordance for the operator to review the per-file warnings interactively. The warnings appear in the scan output text and in `result.skippedRefs` / `result.warnings`; the operator reads them in the chat surface. No new skill, no new prompt.

---

## Acceptance Criteria

> AC1–AC5 are verbatim from the epic with `user-surface` tagging applied per `plugins/crew/docs/user-surface-acs.md`. AC6 is the epic's integration AC. AC7 is the deterministic content-structure check required by the spec brief (parser regex behaviour is verifiable without an LLM; the structural anchor is the new fixture directory shape and the open-string `blocked_by` reason landing through the existing schema fallback).

**AC1 (user-surface):**
**Given** a target repo with `adapter: bmad` configured and a stories directory containing a spec file whose filename has a letter-suffixed story ID (e.g. `4-8b-foo.md`, `5-4b-bar.md`, `6-13-baz.md`),
**When** I run `/crew:scan`,
**Then** the file parses successfully, the resulting `SourceStory.ref` preserves the letter suffix verbatim (e.g. `bmad:4.8b`, NOT `bmad:4.8` and NOT `bmad:48b`), the manifest written under `<target-repo>/.crew/state/to-do/<ref>.yaml` uses the letter-suffixed ref as its filename (e.g. `bmad:4.8b.yaml`), and the scan-output text returned by the skill names the new ref in `createdRefs` without any per-file warning attached. _(adapter regex hardening; closes the gap that hides ~10 follow-up stories from crew)_
<!-- User-surface: AC1 names the `/crew:scan` slash command (rubric i) and the file path `<target-repo>/.crew/state/to-do/<ref>.yaml` (rubric iii — operator-observable per install docs). -->

**AC2:**
**Given** a BMad-shaped spec file (filename matches `<epic>-<story>[<letter-suffix>]-<slug>.md`, H1 well-formed) that contains NO `Status:` line between the H1 and the first section heading,
**When** `BmadAdapter.listSourceStories()` (or `readSourceStory(ref)`) runs over the file,
**Then** the parser MUST NOT throw; it MUST default `raw_frontmatter.status` to the literal string `"backlog"` and the downstream `mapBmadStatusToExecution` projection MUST place the resulting manifest under `.crew/state/to-do/<ref>.yaml` on the next `scanSources` (i.e. the same lifecycle treatment as an explicit `Status: backlog` spec). No warning is emitted, no per-file diagnostic is logged, and the manifest's `raw_frontmatter.status` field is the literal `"backlog"` value (NOT `null`, NOT `undefined`, NOT absent). _(handles the 41-of-45 specs in this repo with no `Status:` field; absence is the dominant case and warning-on-every-file would drown the operator)_
<!-- Not user-surface: AC2 governs internal `BmadAdapter` parser behaviour and the `raw_frontmatter.status` field shape. The lifecycle treatment is observable transitively via AC1 / AC6 but the AC itself asserts internal parser state. -->

**AC3 (user-surface):**
**Given** a BMad-shaped spec file (filename and H1 both well-formed) whose `Status:` line carries a value NOT in the canonical BMad vocabulary (`backlog`, `ready-for-dev`, `in-progress`, `done`, `optional`, `contexted`) — e.g. `Status: review`, `Status: revised — re-implement per ...`,
**When** `/crew:scan` is invoked,
**Then** the adapter MUST emit a single warning into `scanSources`'s result payload (under a new `warnings: { ref, reason, detail }[]` array on the return shape) naming the file's ref and the unrecognised `Status:` value, the manifest MUST be written into `<target-repo>/.crew/state/blocked/<ref>.yaml` carrying `blocked_by: "status-vocabulary-unknown"` (NOT `"planning-discipline"` and NOT a generic `Error:` shape), the scan MUST continue past the file to the rest of the directory (no halt, no aborted scan), and the `/crew:scan` text formatter MUST surface the warning to the operator with the verbatim shape `WARN bmad:<ref>: unknown Status value '<value>' — manifest blocked with reason status-vocabulary-unknown`. Idempotency: a second `/crew:scan` over an unchanged source produces the same blocked manifest byte-for-byte (mtime stable). _(robustness; today the first such file halts the whole scan)_
<!-- User-surface: AC3 names the `/crew:scan` slash command (rubric i) and the verbatim WARN line the operator reads in the chat surface (rubric iv — UI element observed in Claude Code chat). -->

**AC4:**
**Given** a file in the stories directory whose filename does NOT match the canonical or letter-suffixed BMad spec pattern (e.g. `epic-1-retro-2026-05-20.md`, `sprint-status.yaml`, `README.md`, `.gitignore`, `bmad-format.md`),
**When** `BmadAdapter.listSourceStories()` runs (or the equivalent sync walk via `readStoriesDirSync`),
**Then** the file MUST be silently skipped — no entry in `result.warnings`, no entry in `result.skippedRefs`, no manifest written, no error logged. The directory walk MUST continue without surfacing the skip in any operator-facing channel. _(retros, status bookkeeping, and meta-docs legitimately live in the same directory)_
<!-- Not user-surface: AC4 governs internal `readStoriesDir` filter behaviour; the absence of any operator-facing signal is the point. The operator observes the cumulative effect via AC1 / AC6 (the directory parses end-to-end), not via any per-file surface. -->

**AC5 (user-surface):**
**Given** a target repo whose `.crew/config.yaml` declares `adapter: bmad` AND whose `adapter_config.stories_root` differs from `BmadAdapter.defaultConfig().stories_root` (e.g. the dogfood case where `stories_root: _bmad-output/implementation-artifacts`),
**When** I run `/crew:status`,
**Then** the adapter line in the text output MUST be exactly `adapter: bmad (ok)` and MUST NOT be `adapter: bmad (mismatched)`. The underlying `StatusReport.adapter.state` MUST be the literal string `"ok"`, the `otherMatchingAdapters` field MUST be absent (no downgrade), and the validator's `detect()` call MUST use the configured `stories_root` rather than `BmadAdapter`'s built-in default when an explicit `adapter_config.stories_root` is present. The legitimate `mismatched` surface (the configured adapter detects neither at default nor at the override location) MUST still surface as before when no stories at all are found. _(cosmetic, but it confused the first-dogfood operator into reading the install as broken)_
<!-- User-surface: AC5 names the `/crew:status` slash command (rubric i) and the verbatim adapter-line text the operator reads in chat (rubric iv). -->

**AC6:**
vitest covers each of AC1–AC5 against a single fixture directory mirroring this repo's actual messy state. The fixture lives at `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/` and contains: (a) one canonical spec (e.g. `1-1-canonical.md`) with `Status: backlog` and a well-formed H1; (b) one letter-suffixed spec (e.g. `4-8b-suffixed.md`) with `Status: ready-for-dev`; (c) one no-status spec (e.g. `5-1-no-status.md`) with H1 well-formed and NO `Status:` line; (d) one free-text-status spec (e.g. `6-13-freetext-status.md`) with `Status: revised — re-implement per ...`; (e) one retro file (e.g. `epic-1-retro-2026-05-20.md`); (f) one bookkeeping file (e.g. `sprint-status.yaml`). The integration test MUST scan the fixture end-to-end via the public `scanSources` MCP tool surface and assert: AC1 — the letter-suffixed ref produces `to-do/bmad:4.8b.yaml`; AC2 — the no-status ref produces `to-do/bmad:5.1.yaml` with `raw_frontmatter.status === "backlog"`; AC3 — the free-text-status ref produces `blocked/bmad:6.13.yaml` with `blocked_by === "status-vocabulary-unknown"` and a matching `result.warnings` entry; AC4 — the retro file and `sprint-status.yaml` produce no manifest and no warning; AC5 — running `getStatus` against the fixture with `adapter_config.stories_root: fixtures/messy-backlog` yields `adapter.state === "ok"` (covered via a co-located unit test against `getStatus`, not the integration scan). A second back-to-back scan asserts idempotency: every manifest's mtime is stable, no duplicate warnings, no spurious rewrites.
<!-- Not user-surface: AC6 is the integration-test surface. Tests are not observed by the operator. -->

**AC7:**
**Given** the new fixture directory at `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/`,
**When** the test suite runs and the directory's contents are inspected on disk,
**Then** the directory contains all six fixture file shapes named in AC6 — at least one file per shape, named with the literal slugs `canonical`, `suffixed`, `no-status`, `freetext-status`, `retro`, and `sprint-status` so the fixture's intent is grep-able from CI logs — AND the blocked manifest produced by AC3's free-text-status fixture contains the literal substring `status-vocabulary-unknown` in its `blocked_by` field (the manifest is asserted via `parseExecutionManifest` + a deterministic string match, NOT a behavioural property). This is the structural anchor required by the spec brief because the parser regex changes are verifiable without an LLM; the on-disk fixture shape and the literal `blocked_by` token are the two anchors that future scan-sources or schema changes accidentally clobbering the leniency surface will regress visibly against.
<!-- Not user-surface: AC7 governs an internal fixture directory and a literal substring in a generated manifest; the operator does not observe either directly. It is the structural anchor that pins the parser leniency surface against future drift. -->

---

## Behavioural contract

Story 3.8 has five deliverables: (1) widen `BMAD_FILENAME_RE` and the `parseBmadStory` filename regex to accept letter-suffixed story IDs; (2) default `raw_frontmatter.status` to `"backlog"` when no `Status:` line is found; (3) treat unknown-status values as a soft block with a new `blocked_by: "status-vocabulary-unknown"` reason and a warning, instead of throwing; (4) silently skip non-story files (already partly covered by `BMAD_FILENAME_RE`; widening (1) requires care that retros and bookkeeping STILL miss the new pattern); (5) make `/crew:status` respect an explicit `adapter_config.stories_root` so the `mismatched` label only fires when the configured location actually has no stories. Each is bound by the invariants below. The parser and the formatter are pure code; the integration test asserts the end-to-end shape against the fixture.

### Filename regex widening (`parseBmadStory` + `readStoriesDir` + `epicStoryFromFilename`)

- **MUST** widen the filename regex in `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts` (currently line 17) from `^(\d+)-(\d+)-([a-z0-9-]+)\.md$` to `^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$` — the optional `[a-z]?` capture group is the letter suffix. Adjust the capture group indices in the code that follows: `epicFromName = m[1]`, `storyFromName = m[2]`, `letterSuffix = m[3] ?? ""`, `slug = m[4]`.
- **MUST** widen `BMAD_FILENAME_RE` in `plugins/crew/mcp-server/src/adapters/bmad/index.ts` (currently line 87) to the same shape so `readStoriesDir` accepts letter-suffixed files at directory-walk time. The regex MUST be identical to the one in `parseBmadStory` (single source of truth — extract to a shared constant in `bmad-shared.ts` or `parse-bmad-story.ts` and import; do NOT duplicate the literal regex across modules, otherwise the two surfaces can drift).
- **MUST** widen `epicStoryFromFilename` (currently line 159 of `index.ts`) to extract the optional letter suffix and propagate it. The function's return shape changes from `{ epic: number; story: number } | null` to `{ epic: number; story: number; letterSuffix: string } | null` (or equivalent — `letterSuffix: ""` for non-suffixed refs so the field is always present).
- **MUST** widen the H1 regex in `parseBmadStory` (currently line 42: `/^#\s+Story\s+(\d+)\.(\d+)\s*:\s*(.+?)\s*$/`) to accept an optional letter suffix on the story number — e.g. `/^#\s+Story\s+(\d+)\.(\d+)([a-z]?)\s*:\s*(.+?)\s*$/`. The H1-vs-filename consistency check (currently line 53–66) MUST be updated to also compare the letter suffix; a mismatch between filename `4-8b` and H1 `Story 4.8` (no suffix) is a malformed-story error per the existing pattern.
- **MUST** construct the `SourceStory.ref` as `bmad:<epic>.<story><letterSuffix>` — e.g. `bmad:4.8b`, `bmad:5.1` (no suffix → no trailing letter). The `raw_frontmatter.id` MUST follow the same shape: `4.8b`, `5.1`. The dot separator is preserved; only the story portion gains an optional letter.
- **MUST** update `parseRef` (currently line 153 of `index.ts`: `/^bmad:(\d+)\.(\d+)$/`) to the widened shape `/^bmad:(\d+)\.(\d+)([a-z]?)$/`, with downstream code preserving the letter suffix in the `buildRefIndex` map keys and the `resolveSourcePath` lookup.
- **MUST** update `buildRefIndex`'s map key construction (currently `bmad:${es.epic}.${es.story}`) to include the letter suffix: `bmad:${es.epic}.${es.story}${es.letterSuffix}`. The map's existing ambiguity check (same ref → multiple files → `AmbiguousBmadRefError`) is preserved verbatim, just keyed off the letter-suffix-aware ref.
- **MUST** sort order in `listSourceStories` (currently lines 238–245 of `index.ts`) — the numeric sort by epic then story — MUST become a tri-key sort: epic ascending, story ascending, letter suffix ascending (lexicographic, so `4.8` < `4.8a` < `4.8b`; empty-string suffix sorts before any letter). The sort MUST be deterministic across runs.
- **MUST NEVER** widen the filename regex to accept multi-character letter suffixes (e.g. `4-8bc-...`), Unicode letters, digits-after-letters, or other patterns not observed in the live backlog. The pattern is `[a-z]?` — exactly zero or one lowercase ASCII letter. If real-world drift produces multi-character suffixes later, that's a separate story.
- **MUST NEVER** retroactively rename existing `.crew/state/<state>/<ref>.yaml` manifests. If a previous scan wrote `bmad:4.8.yaml` because the letter suffix was being stripped, the new scan with the widened regex MUST treat the new `bmad:4.8b` ref as a NEW ref — the old `bmad:4.8` manifest (if it existed) remains in `.crew/state/` and is the operator's concern to clean up via `/crew:plan` discard. v1 does NOT auto-migrate.

### Default-status fallback (`parseBmadStory` Status: line scan)

- **MUST**, in `parseBmadStory` (the loop currently at lines 68–84), replace the `throw new MalformedBmadStoryError({ reason: "no 'Status: <value>' line found ..." })` branch with `statusValue = "backlog"` and a code comment citing Story 3.8 AC2. The downstream `isKnownBmadStatus` check then succeeds (since `"backlog"` IS in the canonical vocabulary) and the story proceeds through the rest of the parser as if it had been authored with `Status: backlog`.
- **MUST** still scan for the `Status:` line through the same loop bounds (between H1 and the first `##` section heading) — the default fires only when the loop exits without a match. A spec with an unparseable but PRESENT `Status:` line (e.g. `Status:    ` with trailing whitespace and no value) still throws — the default-fallback is for ABSENCE only, not malformed presence.
- **MUST NOT** emit a warning when the fallback fires. Absence is the dominant case; per-file warnings would drown the operator. The fallback is silent.
- **MUST** preserve the existing `raw_frontmatter.status` shape — the default MUST be the literal string `"backlog"`, not `null` and not `undefined`. Every downstream consumer (`mapBmadStatusToExecution`, `shouldSkipBmadStatus`, the reconciliation surface from Story 3.3) treats `"backlog"` as the canonical "to-do" state, which is the correct lifecycle treatment for a no-status spec.
- **MUST NEVER** treat the default-status as a per-spec source-of-truth claim. The orchestrator's `sprint-status.yaml` remains authoritative for the `crew` repo. The default is a parser-level convenience for the lifecycle projection; reconciliation prompts (Story 3.3 AC3) continue to fire only when the per-file `Status:` is PRESENT and disagrees with the manifest.

### Unknown-status fallback (new `blocked_by: "status-vocabulary-unknown"` reason)

- **MUST**, in `parseBmadStory` (the `isKnownBmadStatus` check at line 88–94), replace the `throw new MalformedBmadStoryError({ reason: "unknown Status value '<value>'" })` branch with a new `SourceStory` shape carrying a sentinel field: the parser MUST still produce a `SourceStory` (so the scan does not halt) but it MUST mark the story for soft-blocking downstream. The recommended implementation is to add a `parse_warning: { reason: "status-vocabulary-unknown"; detail: string } | undefined` optional field to `SourceStory` (`adapter.ts`) and have `parseBmadStory` populate it on unknown-status. The `scanSources` orchestrator then inspects `story.parse_warning` BEFORE the discipline gate and, if present, writes a blocked manifest with `blocked_by: story.parse_warning.reason` and appends to `result.warnings`. (Alternative: keep `SourceStory` shape unchanged and surface the unknown-status path via a typed exception that `scanSources` catches per-story rather than per-scan. Either is acceptable; the AC asserts the operator-observable result, not the wiring.)
- **MUST** ensure the blocked manifest carries `blocked_by: "status-vocabulary-unknown"` exactly — the open-string fallback on `ExecutionManifestSchema.shape.blocked_by` (line 129–137) accepts arbitrary strings, so no schema change is needed. The literal value `"status-vocabulary-unknown"` MUST be defined as a single exported constant (e.g. `BLOCKED_BY_STATUS_VOCABULARY_UNKNOWN` in `parse-bmad-story.ts` or `bmad-shared.ts`) so the parser, scanSources, and tests all reference the same string.
- **MUST** emit a single warning into `scanSources`'s return payload per unknown-status file. The warning shape MUST be `{ ref: string; reason: "status-vocabulary-unknown"; detail: string }` where `detail` is the human-readable unrecognised value. The warning's `reason` and the manifest's `blocked_by` MUST use the same literal string (no `unknownStatus` vs `status-vocabulary-unknown` drift).
- **MUST**, in the `/crew:scan` text formatter (`plugins/crew/skills/scan/SKILL.md` consumes `scanSources`'s text content output — locate the formatter at `mcp-server/src/tools/scan-sources.ts` or its sibling `render-scan-result.ts` if present, or wherever `scanSources` builds the human-readable text block), surface the warning verbatim as `WARN bmad:<ref>: unknown Status value '<value>' — manifest blocked with reason status-vocabulary-unknown` (one line per warning, after the createdRefs / updatedRefs lists and before any final "scan complete" summary).
- **MUST** preserve idempotency: a second back-to-back scan over an unchanged source produces the same blocked manifest bytes (mtime stable), the same `result.warnings` array shape, and the same text-formatter output line. No double-warn, no spurious rewrite.
- **MUST NEVER** suppress an unknown-status warning when the same ref already has a blocked manifest from a prior scan. Each scan that processes the file regenerates the warning (so the operator sees the live state every time they scan).
- **MUST NEVER** treat unknown-status as a discipline violation. `blocked_by: "planning-discipline"` and `blocked_by: "status-vocabulary-unknown"` are independent. A single manifest carries one or the other (whichever fired first); a story whose status is unknown AND whose ACs violate discipline lands as `status-vocabulary-unknown` (the parser-level block precedes the discipline gate).

### Non-story file silent skip (`readStoriesDir` filter)

- **MUST** preserve `BMAD_FILENAME_RE`'s gate behaviour: any file in the stories directory whose name does NOT match the (now-widened) regex is silently skipped — no warning, no log line, no entry in `result.warnings`, no entry in `result.skippedRefs`.
- **MUST** ensure the widened regex from § Filename regex widening does NOT accidentally match retro files (`epic-1-retro-2026-05-20.md`) or `sprint-status.yaml`. Sanity check: the new regex `^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$` starts with `\d+-\d+` so `epic-1-retro-...` (starts with `epic-`) is naturally excluded; `sprint-status.yaml` is also excluded by the `.md` extension requirement. The AC4 test pins these explicitly.
- **MUST NEVER** introduce a generic "warn on every non-story file" behaviour. The silence is the contract — operator-facing surfaces must not be cluttered by files that legitimately co-exist with stories.
- **MUST NEVER** widen the silent-skip rule to also swallow malformed BMad stories (files that DO match the filename regex but fail H1 / Status parsing). Those continue to halt the scan as before for the AC3-unhandled cases (e.g. malformed H1) — the leniency is scoped to the four shapes named in the ACs. A truly broken spec file still surfaces, just not as a per-directory halt-on-first-bad-file failure.

### `/crew:status` adapter-line correctness (`validateActiveAdapter` + `BmadAdapter.detect` + `getStatus`)

- **MUST**, in `BmadAdapter.detect()` (`adapters/bmad/index.ts` line 198), accept an optional `adapterConfig` argument carrying `{ stories_root?: string }` and prefer it over the hard-coded `DEFAULT_STORIES_ROOT` when present. The interface change in `PlanningAdapter.detect` is permissible — the signature becomes `detect(targetRepo: string, adapterConfig?: unknown): Promise<boolean>` — every existing caller passes no config (which is the existing behaviour) and the BMad adapter inspects the optional field via its existing `adapterConfigSchema` for safety.
- **MUST**, in `validateActiveAdapter` (`state/validate-active-adapter.ts` line 31), pass `workspace.adapterConfig` to the `detect()` call so the resolved override is consulted. The cross-check against OTHER adapters (lines 36–42) MUST continue to call those adapters' `detect()` with NO adapterConfig (because they cannot interpret a BMad adapter's config), preserving the existing "did some other adapter claim this repo" check unchanged.
- **MUST**, when the BMad adapter's `detect()` returns true under the configured `stories_root`, route through the existing `state: "ok"` branch in `getStatus` (line 60). The `/crew:status` text formatter line becomes `adapter: bmad (ok)` — no further code change in the formatter is required.
- **MUST** preserve the legitimate `mismatched` surface for the case where the configured `stories_root` is empty/non-existent AND another registered adapter (e.g. native) DOES claim the repo. The downgrade still fires in that case; the leniency is for the legitimate-override case only.
- **MUST** pin the legitimate-mismatched case with an AC6 sub-assertion (or a co-located unit test in the AC6 test file): a config with `adapter: bmad` AND `adapter_config.stories_root: nonexistent/` AND a `.crew/native-stories/` tree (so the native adapter detects) still yields `adapter: bmad (mismatched)` with `otherMatchingAdapters: ["native"]`. The fix is "respect explicit override at the configured location" not "always say ok if BMad is configured".
- **MUST NEVER** change `BmadAdapter`'s `defaultConfig()` return value (line 278) — the default stays `{ stories_root: "_bmad-output/planning-artifacts/stories" }`. The override is per-target-repo config; the adapter's default is unchanged.
- **MUST NEVER** introduce a separate config field to opt into the override-aware detect. The behaviour is the default; no toggle.

### Negative-capability invariants

- **MUST NEVER** modify any file under `_bmad-output/implementation-artifacts/`. The dev agent does not touch `sprint-status.yaml`, retros, or existing spec files. The fixture lives under `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/` — that's the only on-disk story-shape mutation this story makes.
- **MUST NEVER** modify the `ExecutionManifestSchema` shape. The open-string `blocked_by` fallback exists; no new literal union arm, no new field.
- **MUST NEVER** widen the filename regex to accept patterns outside the documented `^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$` shape. Multi-letter suffixes, uppercase, digits-after-letters — all out of scope.
- **MUST NEVER** swallow malformed-H1 errors or other parse errors not named in the ACs. The leniency is precise; a truly broken file still surfaces.
- **MUST NEVER** introduce a CLI flag, env var, or workspace-config knob to gate the leniency. The leniency is the default for v1.
- **MUST NEVER** call `gh`, the network, the shell, or any process outside the MCP server.
- **MUST NEVER** rebuild the dist/ tree without staging it in the same commit (per CLAUDE.md §Process notes).

---

## Tasks / Subtasks

- [ ] **Task 1 — Filename + H1 + ref regex widening (AC: 1, 6, 7)**
  - [ ] 1.1 In `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts`, widen the filename regex at line 17 to include the optional letter suffix. Update capture-group indices for `epicFromName`, `storyFromName`, `letterSuffix`, `slug`. Update the H1 regex (line 42) to accept the optional letter suffix on the story number. Update the H1-vs-filename consistency check (line 53–66) to include the letter suffix in the comparison.
  - [ ] 1.2 Construct `SourceStory.ref` as `bmad:${epicFromName}.${storyFromName}${letterSuffix}`. Construct `raw_frontmatter.id` as `${epicFromName}.${storyFromName}${letterSuffix}`. The dot separator is preserved unchanged.
  - [ ] 1.3 In `plugins/crew/mcp-server/src/adapters/bmad/index.ts`, widen `BMAD_FILENAME_RE` (line 87) to the same shape. Extract the regex into a shared module (e.g. add `export const BMAD_FILENAME_RE` at the top of `parse-bmad-story.ts` and import it from `index.ts`) so the two modules cannot drift.
  - [ ] 1.4 Widen `parseRef` (line 153) and `epicStoryFromFilename` (line 159) to extract and propagate the letter suffix. Update `buildRefIndex` (line 165) to build map keys with the suffix included. Update `listSourceStories`'s sort comparator (lines 238–245) to a tri-key sort (epic, story, letterSuffix lexicographic).
  - [ ] 1.5 Run the existing BMad adapter test suite (`mcp-server/src/adapters/bmad/__tests__/`) and confirm no existing test regresses. Existing fixtures with no letter suffix MUST continue to produce `bmad:<e>.<s>` refs (empty letterSuffix). If a test pinned the old return shape of `epicStoryFromFilename`, update it.

- [ ] **Task 2 — Default-status fallback (AC: 2, 6)**
  - [ ] 2.1 In `parseBmadStory` (the Status-line scan loop at lines 68–84), replace the `throw new MalformedBmadStoryError({ reason: "no 'Status: <value>' line found ..." })` branch with `statusValue = "backlog"`. Add a code comment citing Story 3.8 AC2 immediately above the assignment.
  - [ ] 2.2 Confirm the downstream `isKnownBmadStatus(statusValue)` check (line 88) passes for the new default value. No further code change is required for the lifecycle projection (`mapBmadStatusToExecution` already handles `"backlog"`).
  - [ ] 2.3 Verify `raw_frontmatter.status` carries the literal string `"backlog"` (not `null`, not `undefined`). The existing line `status: statusValue` (line 143) suffices.
  - [ ] 2.4 No warning emission. The fallback is silent by design.

- [ ] **Task 3 — Unknown-status soft-block with `status-vocabulary-unknown` reason (AC: 3, 6, 7)**
  - [ ] 3.1 Choose one of two implementation seams. **Recommended default (parser-level sentinel):** add an optional field `parse_warning: { reason: string; detail: string } | undefined` to `SourceStory` in `adapters/adapter.ts`. In `parseBmadStory`, replace the `throw new MalformedBmadStoryError({ reason: "unknown Status value ..." })` branch (line 88–94) with `statusValue = "backlog"; story.parse_warning = { reason: "status-vocabulary-unknown", detail: <originalValue> }`. The story is then returned with `raw_frontmatter.status = <originalValue>` (preserved for traceability) and the lifecycle projection treats it as `"backlog"`. Downstream in `scanSources`, BEFORE the discipline gate (Step 5, line 357), check `if (story.parse_warning) { write blocked manifest with blocked_by = story.parse_warning.reason; append to result.warnings; continue }`.
  - [ ] 3.2 Define the literal `status-vocabulary-unknown` as a single exported constant — e.g. `export const BLOCKED_BY_STATUS_VOCABULARY_UNKNOWN = "status-vocabulary-unknown"` in `parse-bmad-story.ts`. Reference it from the parser, the `scanSources` write path, the text formatter, and the AC6/AC7 tests. Do NOT inline the literal string in multiple modules.
  - [ ] 3.3 Extend the `scanSources` return shape with `warnings: { ref: string; reason: string; detail: string }[]`. Update the Zod schema (or interface) that types the scanSources output. Existing callers that ignore the new field MUST continue to work; the field is additive.
  - [ ] 3.4 Update the `/crew:scan` text formatter (locate it in `scan-sources.ts` or `render-scan-result.ts` — whichever assembles the text content block returned by the MCP tool handler) to render each warning as one line: `WARN bmad:<ref>: unknown Status value '<value>' — manifest blocked with reason status-vocabulary-unknown`. Warnings appear after createdRefs/updatedRefs and before any "scan complete" summary.
  - [ ] 3.5 Two-pass idempotency: write a unit / integration test that scans the unknown-status fixture twice in a row and asserts (a) the blocked manifest's `fs.stat().mtimeMs` is identical across the two calls; (b) the second scan still surfaces the warning in `result.warnings` (warnings reflect live state on every scan; they are NOT cached).
  - [ ] 3.6 Confirm the discipline gate (Story 3.5) is NOT invoked on a story carrying `parse_warning`. The `parse_warning` block precedes the discipline gate by design (Behavioural contract § unknown-status). A story whose status is unknown does not also surface as a discipline violation in the same scan.

- [ ] **Task 4 — Non-story file silent skip — sanity-check the widened regex (AC: 4, 6)**
  - [ ] 4.1 No code change is expected for this AC beyond Task 1's regex widening — the existing `BMAD_FILENAME_RE` filter already skips files that do not match. Confirm via the AC6 integration test that retro files (`epic-1-retro-2026-05-20.md`) and `sprint-status.yaml` produce NO `result.warnings` entry, NO `result.skippedRefs` entry, and NO manifest.
  - [ ] 4.2 Add an explicit unit test against `readStoriesDir` (or `readStoriesDirSync`) seeding a tmpdir with: one canonical spec, one letter-suffixed spec, one retro file, `sprint-status.yaml`, a `.gitignore`, a `README.md`. Assert the returned array contains only the two `.md` files matching the widened pattern; the four others are absent.
  - [ ] 4.3 No new module, no new helper. The silent-skip contract is the existing filter; this task pins it under Story 3.8.

- [ ] **Task 5 — `/crew:status` adapter-config-aware detect (AC: 5, 6)**
  - [ ] 5.1 Update the `PlanningAdapter.detect` signature in `adapters/adapter.ts` to `detect(targetRepo: string, adapterConfig?: unknown): Promise<boolean>`. Document the optional argument's contract in TSDoc — adapters MAY use it to refine detection; adapters that do not need it MUST ignore it.
  - [ ] 5.2 In `BmadAdapter.detect` (`adapters/bmad/index.ts` line 198), accept the optional `adapterConfig`, safe-parse it via `adapterConfigSchema`, extract `stories_root`, and prefer it over `DEFAULT_STORIES_ROOT` when present. If `adapterConfig` is absent or fails the safe-parse, fall back to `DEFAULT_STORIES_ROOT` (preserving the existing detect-without-config callers, e.g. `validateActiveAdapter`'s cross-check).
  - [ ] 5.3 In `validateActiveAdapter` (`state/validate-active-adapter.ts` line 31), pass `workspace.adapterConfig` to the configured adapter's `detect()` call. The cross-check against other adapters (lines 36–42) MUST continue to call those adapters' `detect()` with no adapterConfig (per the Behavioural contract — other adapters cannot interpret a BMad config).
  - [ ] 5.4 Add a co-located unit test against `getStatus` (or `validateActiveAdapter`) that seeds a tmpdir with `.crew/config.yaml` declaring `adapter: bmad` and `adapter_config.stories_root: subdir/stories/`, places a BMad-shaped story at `<tmpdir>/subdir/stories/1-1-foo.md`, and asserts `getStatus(...)` returns `adapter: { state: "ok", name: "bmad" }`. Co-locate with the existing `get-status.test.ts` (or equivalent).
  - [ ] 5.5 Add a legitimate-mismatched assertion: seed a tmpdir with `.crew/config.yaml` declaring `adapter: bmad` and `adapter_config.stories_root: nonexistent/`, plus a `.crew/native-stories/01ULID.md` so the native adapter detects. Assert `getStatus(...)` returns `adapter: { state: "mismatched", name: "bmad", otherMatchingAdapters: ["native"] }`. This pins the contract that the leniency does NOT mask a real misconfiguration.

- [ ] **Task 6 — Fixture: `messy-backlog/` end-to-end (AC: 6, 7)**
  - [ ] 6.1 Create `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/` containing six files: (a) `1-1-canonical.md` — well-formed H1 (`# Story 1.1: Canonical example`), `Status: backlog`, minimal valid body with one `## Story` + one `## Acceptance Criteria` (one integration AC so discipline passes); (b) `4-8b-suffixed.md` — H1 `# Story 4.8b: Letter-suffixed example`, `Status: ready-for-dev`, minimal valid body; (c) `5-1-no-status.md` — H1 `# Story 5.1: No status line`, NO `Status:` line, minimal valid body; (d) `6-13-freetext-status.md` — H1 `# Story 6.13: Free-text status`, `Status: revised — re-implement per ...`, minimal valid body; (e) `epic-1-retro-2026-05-20.md` — any content (it MUST be skipped silently by the filename filter); (f) `sprint-status.yaml` — any content. All six files are committed to git as test fixtures.
  - [ ] 6.2 Add an integration test at `plugins/crew/mcp-server/src/adapters/bmad/__tests__/messy-backlog.integration.test.ts` that copies the fixture into a tmpdir, points a `.crew/config.yaml` at it (`adapter: bmad` + `adapter_config.stories_root: <fixture-path>`), runs `scanSources`, and asserts the AC1–AC6 outcomes named in AC6 verbatim. Two-pass idempotency is asserted by re-running `scanSources` and confirming every manifest's mtime is stable.
  - [ ] 6.3 Add the AC7 structural anchor inside the same test file (or in a sibling `messy-backlog.shape.test.ts`): a deterministic check that the fixture directory contains files whose names contain the literal slugs `canonical`, `suffixed`, `no-status`, `freetext-status`, `retro`, `sprint-status`; and a check that the blocked manifest written by AC3 contains the literal substring `status-vocabulary-unknown` in its `blocked_by` field (read the manifest via `parseExecutionManifest`, assert the field equals the constant).
  - [ ] 6.4 Co-locate the AC5 `getStatus` test (Task 5.4) with the fixture so the `messy-backlog/` tree is reused for both the integration scan and the status-line assertion.
  - [ ] 6.5 Confirm no existing BMad fixture test regresses against the widened regex. If a fixture's expectation was "this file errors with MalformedBmadStoryError because no Status:", update the expectation (the file now defaults to `"backlog"`); the malformed-status path remains tested via the existing free-text-status fixture.

- [ ] **Task 7 — Documentation and wire-up (AC: 1, 3, 5)**
  - [ ] 7.1 Update `plugins/crew/docs/spikes/bmad-format.md` (the BMad format spike from Story 3.3) — add a section "Real-world leniency (Story 3.8)" naming the four parser-level deviations and the `/crew:status` override fix, with one paragraph each. Cite this story's spec for the binding contract.
  - [ ] 7.2 Update `plugins/crew/docs/README-install.md` if it surfaces BMad parser behaviour. Most likely a one-line bullet under the BMad section: "The adapter accepts letter-suffixed story IDs (e.g. `4-8b`), tolerates missing `Status:` lines (defaults to `backlog`), and surfaces unknown-status values as warnings with a `blocked_by: status-vocabulary-unknown` manifest rather than halting the scan."
  - [ ] 7.3 Rebuild `plugins/crew/mcp-server/dist/` per `CLAUDE.md` §Process notes and commit in the same change. CI fails on drift.
  - [ ] 7.4 Confirm no regression in existing `validateActiveAdapter` / `getStatus` tests. If a test asserted `mismatched` against a config with an explicit override, update the assertion (per AC5 the override now produces `ok`).
  - [ ] 7.5 Confirm no regression in the existing `scan-sources` integration test suite — every existing fixture-driven assertion (idempotency, discipline-gate writes to blocked, source-drift refresh) MUST continue to pass.

---

## Architecture compliance

- `PlanningAdapter` interface signature is widened by ONE backward-compatible optional argument: `detect(targetRepo: string, adapterConfig?: unknown)`. Every existing caller passes no second argument (existing behaviour). Adapters that don't need it ignore it. This is a permissible change because the interface is internal to the MCP server tree and v1 has two adapters (BMad, native); both surfaces are updated in this story.
- `ExecutionManifestSchema` is unchanged. The open-string `blocked_by` fallback at line 129–137 already accepts `"status-vocabulary-unknown"`. No new literal union arm, no new schema field.
- The two-layer model (`planning-adapter-model.md` §Two-layer model) is preserved. Source stories remain in `_bmad-output/planning-artifacts/stories/` (or the configured override); execution manifests live under `.crew/state/`. The leniency operates at the adapter parser surface; the execution layer's contract is unchanged.
- Source-drift handling (Architecture §Source-drift handling, Story 3.2 AC3) is orthogonal. A letter-suffixed ref's `source_hash` refreshes on edit through the same scan-sources path as any other ref. The `parse_warning` sentinel does not interact with drift handling.
- The state-machine directory layout (Story 1.6) is unchanged. Letter-suffixed manifests use the literal ref in their filename (`bmad:4.8b.yaml`). The `atomicWriteFile` primitive is the binding write path for the new blocked manifests as for every other plugin-side write.
- Story 3.5 discipline-gate is unchanged in its rules. Stories with `parse_warning` bypass the gate (because they're already being blocked at parser level); stories without `parse_warning` flow through the gate as before. The two block-reasons (`planning-discipline` and `status-vocabulary-unknown`) are independent and mutually exclusive per manifest.
- Story 3.3b adapter-config seam is the load-bearing precedent for `validateActiveAdapter` getting the configured `adapter_config` at validation time — the config is already on `workspace.adapterConfig` post-Story-3.3b; this story just propagates it one level into `detect()`.
- `architecture-validation-results.md` Gap 1 (planning-discipline at scan time) was closed by Story 3.5 and is unaffected. Gap 3 (FR78 discard semantics) was closed by Story 3.6 and is unaffected. This story does not introduce or close any new architectural gap.
- `bugfix-1` retro lesson — "stories ship under green ACs while hiding silent breakage" — applies via AC4 / AC6: the silent skip is a deliberate, tested behaviour with an integration assertion, not an untested papering-over.

## Library / framework requirements

- **`zod`** — already a dep. Reused for any optional new field on `SourceStory` (`parse_warning`) via `z.object(...).optional()`. No version bump.
- **No new runtime deps.** All four parser-level fixes are pure regex / control-flow changes inside existing modules. The `getStatus` fix is a one-argument propagation through existing functions.
- **No new test deps.** vitest is the runner; existing tmpdir helpers handle fixture seeding.

## File-structure requirements

NEW files (do not exist today):

- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/1-1-canonical.md` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/4-8b-suffixed.md` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/5-1-no-status.md` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/6-13-freetext-status.md` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/epic-1-retro-2026-05-20.md` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/messy-backlog/sprint-status.yaml` (Task 6.1).
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/messy-backlog.integration.test.ts` (Task 6.2 / 6.3).

UPDATE files (exist today; story modifies):

- `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts` — widen filename + H1 regex, default-status fallback, unknown-status parse_warning path, shared `BLOCKED_BY_STATUS_VOCABULARY_UNKNOWN` constant (Tasks 1, 2, 3).
- `plugins/crew/mcp-server/src/adapters/bmad/index.ts` — widen `BMAD_FILENAME_RE`, `parseRef`, `epicStoryFromFilename`, `buildRefIndex`, `listSourceStories` sort comparator; `detect()` accepts optional `adapterConfig` (Tasks 1, 5).
- `plugins/crew/mcp-server/src/adapters/adapter.ts` — widen `PlanningAdapter.detect` signature; optional `parse_warning` field on `SourceStory` (Tasks 3, 5).
- `plugins/crew/mcp-server/src/tools/scan-sources.ts` — `parse_warning`-aware soft-block path BEFORE the discipline gate; `warnings` array on result; text formatter renders WARN lines (Task 3).
- `plugins/crew/mcp-server/src/state/validate-active-adapter.ts` — propagate `workspace.adapterConfig` into the configured adapter's `detect()` call (Task 5).
- `plugins/crew/docs/spikes/bmad-format.md` — real-world leniency section (Task 7.1).
- `plugins/crew/docs/README-install.md` — leniency bullet under BMad section (Task 7.2).
- `plugins/crew/mcp-server/dist/` — rebuild and commit per `CLAUDE.md` §Process notes (Task 7.3).

NO files to delete.

## Testing requirements

- vitest is the test runner (precedent: every existing `*.test.ts` in the MCP server tree).
- The integration test (`messy-backlog.integration.test.ts`) is the load-bearing AC6 surface. It copies the fixture into a tmpdir, drives `scanSources` end-to-end via the MCP tool surface, and asserts the create/blocked/skipped/warnings shape for each AC. Two-pass idempotency is asserted via `fs.stat().mtimeMs` on every manifest.
- The AC7 anchor test is co-located and is a pure file-read + literal-substring assertion (no LLM, no orchestration).
- Per-task unit tests cover narrower seams: regex widening on `parseBmadStory` (Task 1.5); default-status fallback against a no-status fixture (Task 2); unknown-status parse_warning path against a free-text-status fixture (Task 3.5); silent-skip filter against retros + bookkeeping (Task 4.2); `getStatus` with the `messy-backlog/` fixture (Task 5.4) and with a legitimate-mismatched fixture (Task 5.5).
- The legitimate-mismatched assertion (Task 5.5) is REQUIRED — it pins the contract that AC5's leniency does NOT mask a real misconfiguration.
- No new test harness is needed. The existing scan-sources test pattern (tmpdir seed → invoke `scanSources` → assert result shape + on-disk manifests) is the precedent.
- Every regex change MUST have a paired test covering both the new shape AND a negative case (a near-miss that MUST still be rejected, e.g. `4-8bc-foo.md` — multi-letter suffix — MUST NOT parse).
- Idempotency on the unknown-status path is asserted explicitly via mtime stability. The same contract `scan-sources` honours for canonical specs extends to blocked manifests under the new reason.

## Previous-story intelligence

- **Story 3.1** landed `PlanningAdapter` interface + registry. This story widens `PlanningAdapter.detect` by ONE optional argument — a backward-compatible signature change.
- **Story 3.2** landed `scan-sources` + the execution-manifest schema with the open-string `blocked_by` fallback. This story exploits the open-string fallback for `"status-vocabulary-unknown"`; no schema change is needed.
- **Story 3.3** landed `BmadAdapter` v1 against a strict fixture. Story 3.8 is the explicit "Story 3.3 reference impl meets real backlog" follow-up — the four parser-level fixes correspond one-to-one with the four deviations the strict fixture did not represent.
- **Story 3.3b** moved adapter-config seam into `resolveWorkspace`. `workspace.adapterConfig` is already populated at validate-time; this story propagates it through to `detect()`.
- **Story 3.4** landed the native adapter + `/crew:plan`. No interaction — this story is BMad-specific.
- **Story 3.5** landed the discipline gate + `validatePlannerBacklog`. The discipline gate runs only on stories WITHOUT `parse_warning`; the unknown-status soft-block precedes it. Stories that pass the parser flow through the gate unchanged.
- **Story 3.6** landed `/crew:plan` re-open + `markWithdrawn` + `isClaimable`. The `withdrawn` semantics are orthogonal to this story — a withdrawn manifest with `blocked_by: status-vocabulary-unknown` is still withdrawn (and still skipped by the dev loop's `isClaimable` filter).
- **Story 3.7** landed the plain-language guideline + `detectInProgressHandEdit`. Orthogonal — Story 3.7 is operator-facing prompt + in-progress guard; this story is parser leniency + status formatter.
- **Story 1.6 / Story 1.8 / Story 1.11** — atomic-rename, user-surface AC tag, dev:install loop. AC1, AC3, AC5 are tagged `user-surface` per rubric (i) and (iv); AC2, AC4, AC6, AC7 are substrate. Pre-PR smoke gate coverage required for AC1, AC3, AC5 — the integration test (AC6) drives `/crew:scan` end-to-end against the fixture (`automated_e2e_verified` event), and the AC5 unit test against `getStatus` drives `/crew:status` programmatically. AC3's chat-side WARN-line observable is covered by the text-formatter assertion in AC6.
- **`bugfix-1` retro lesson:** stories ship under green ACs while hiding silent breakage. The AC4 silent-skip is deliberate; AC6 pins it. The AC2 silent default is deliberate; AC6 pins it. The AC3 warning is the operator-facing breadcrumb so the leniency does NOT hide real malformations.
- **PR #126 context:** the epic-side scope was captured on 2026-05-25; the spec authoring is now this story. Read PR #126's description for the source-of-truth narrative of what surfaced during the first dogfood attempt.

## Project-context reference

- **Authoritative PRD:** `_bmad-output/planning-artifacts/prd-crew-v1/` (sharded). No new FR is introduced; this story is the implementation-leniency follow-up for FR3 (scan-sources) and the cosmetic fix for FR-implied `/crew:status` correctness.
- **Authoritative architecture:** `_bmad-output/planning-artifacts/architecture/planning-adapter-model.md` (§Two-layer model — adapter parses source, manifests are owned by the plugin), `core-architectural-decisions.md` (atomic state-machine moves), `project-structure-boundaries.md` (BMad adapter file locations).
- **BMad format spike:** `plugins/crew/docs/spikes/bmad-format.md` — the binding doc for BMad's source shape from Story 3.3. Update under Task 7.1 with the real-world leniency section.
- **User-surface AC convention:** `plugins/crew/docs/user-surface-acs.md` — the gate-binding rubric. AC1, AC3, AC5 carry the `(user-surface)` tag.
- **Build-output rule:** project `CLAUDE.md` §Process notes — `plugins/crew/mcp-server/dist/` must be rebuilt and committed in the same change. CI fails on drift.
- **Communication style:** per project `CLAUDE.md` §How to talk to Jack — terse, PM-language, recommend defaults, no engineering-judgement asks at the spec-author layer.
- **Negative-capability anchor:** `sprint-status.yaml` and everything under `_bmad-output/implementation-artifacts/` is owned by the orchestrator. This story MUST NOT touch any of it (except authoring this spec file, which is the orchestrator's authoring routine writing into the dedicated spec location).
- **Memory-pinned conventions:** dependency versions default to latest stable resolved by pnpm (no new deps); never amend or skip hooks; never commit to local main.

---

## Story completion status

Status: backlog

Authored by the spec-author-topup routine on 2026-05-24.

Notes for the dev agent:
- Seven ACs total (AC1–AC5 verbatim from the epic + AC6 the epic's integration AC + AC7 the deterministic content-structure anchor required by the spec brief).
- ACs tagged `user-surface`: AC1, AC3, AC5. AC2, AC4, AC6, AC7 are substrate (internal parser behaviour, silent-skip absence-of-signal, integration tests, on-disk fixture / literal-substring anchor).
- The Behavioural contract section is required for `user-surface` stories per the spec brief and IS present — see § Behavioural contract above. The five subsections (filename regex widening, default-status fallback, unknown-status soft-block, non-story silent skip, `/crew:status` override-aware detect) are the load-bearing carriers for the five operator-observable surfaces.
- Do NOT modify `sprint-status.yaml` or any file under `_bmad-output/implementation-artifacts/` during implementation. The orchestrator owns status. The only on-disk surface this story authors outside its own modules is the `messy-backlog/` fixture directory.
- Recommended implementation seam for Task 3 is the parser-level `parse_warning` sentinel on `SourceStory`. The alternative (typed exception caught per-story in `scanSources`) is acceptable but introduces a control-flow split; the sentinel is the simpler shape.
- The widened filename regex MUST be extracted into a single exported constant shared between `parseBmadStory` and `index.ts`'s `BMAD_FILENAME_RE`. Inline duplication is the path to silent drift.
- The fixture under `messy-backlog/` is the load-bearing AC6 surface; every shape named in AC6 MUST be physically present in the committed fixture directory. CI greenness depends on the fixture matching the integration test's expectations exactly.
- The AC5 fix has TWO required tests: the leniency case (override → ok) and the legitimate-mismatched case (override + native detects → mismatched). The pair pins the contract that AC5 does NOT mask real misconfiguration.
- After implementation, the next dogfood of `/crew:start` against the crew repo's own backlog SHOULD succeed end-to-end at the scan + status step. If it does not, surface the regression rather than papering over with further leniency — the four shapes named here are exhaustive for v1; new shapes get new stories.
