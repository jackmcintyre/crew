# Story 3.8: BMad adapter leniency for real-world BMad backlogs

story_shape: user-surface

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator pointing crew at an existing real-world BMad backlog**,
I want **`/crew:scan` to succeed against repos whose BMad-shaped stories have accumulated organic deviations from the v1 reference fixture — specifically letter-suffixed follow-up story IDs (`4-8b`, `5-4b`, `6-13` style), specs with no `Status:` line at all, specs whose `Status:` value sits outside the canonical BMad vocabulary, and unrelated bookkeeping files (retros, `sprint-status.yaml`) sharing the stories directory — and `/crew:status` to stop labelling a workspace with a custom `adapter_config.stories_root` as `mismatched`**,
so that **I can dogfood crew against this repo (and other real BMad backlogs) without first having to mass-rewrite every existing spec to match the reference fixture's strict shape**.

### What this story is, in one sentence

Make the BMad adapter (Story 3.3) tolerate the four real-world deviations surfaced during the first attempted dogfood of `/crew:start` against the `crew` repo's own backlog on 2026-05-25 — letter-suffixed story IDs preserved through the filename + H1 regex + ref, missing `Status:` lines defaulted to `backlog`, unknown `Status:` values downgraded to a per-file warning + a `blocked/` manifest with `blocked_by: status-vocabulary-unknown` instead of halting the whole scan, and non-conforming filenames silently skipped rather than throwing — and fix the cosmetic `/crew:status` "mismatched" label that fires when an operator legitimately configures a custom `adapter_config.stories_root` via Story 3.3b.

### What this story fixes (and why it needs its own story)

Story 3.3 shipped the BMad adapter's v1 reference implementation against a strict-BMad fixture. The fixture is clean: every story has a canonical `Status:` line in the documented vocabulary, every filename matches `<epic>-<story>-<slug>.md` with digits only, and the stories directory contains nothing but stories. Real BMad repos do not look like this. The `crew` repo's own backlog — the first non-fixture target the adapter ever met — accumulated organic deviations across its sprint-orchestrator era and its current AI-Engineering-Team-v1 era:

- **~10 stories with letter-suffixed IDs** (`4-8b`, `4-3b`, `4-3c`, `5-4b`, `6-13`, etc.) authored as follow-up stories within an epic. The current filename regex `/^(\d+)-(\d+)-([a-z0-9-]+)\.md$/` rejects these on the first character after the second hyphen — `4-8b-...` fails because the regex expects `-` immediately after the second digit group, and the H1 regex `/^#\s+Story\s+(\d+)\.(\d+)\s*:\s*(.+?)\s*$/` similarly rejects `# Story 4.8b: ...`. The scan throws `MalformedBmadStoryError` and halts. Result: ~10 follow-up stories are entirely invisible to crew.
- **Specs with no `Status:` line at all.** The parser at `parse-bmad-story.ts` line 79–84 throws `MalformedBmadStoryError` when no `Status:` line is found between the H1 and the first `## ` heading. The epic-25 audit observed 41 of 45 specs in this state at the time of the dogfood (the count has since drifted as new specs landed with a `Status:` line, but the underlying parser rigidity remains — any spec missing the line halts the scan).
- **Specs with a `Status:` value outside the canonical BMad vocabulary** (e.g. `review`, or free-text notes like `revised — re-implement per …`). The parser at line 88–94 throws `MalformedBmadStoryError` on the first unknown value. One bad story halts the entire scan and hides every downstream issue.
- **Files in the stories directory that are NOT story specs** — retro files (`epic-1-retro-2026-05-20.md`), `sprint-status.yaml`, etc. Today the adapter's `readStoriesDir` already filters by the `BMAD_FILENAME_RE` regex at line 87 (so the retro file is silently skipped), but the parser path (used by `readSourceStory` for a specific ref) does not. This story pins the silent-skip invariant explicitly and adds a test so future refactors don't regress it.
- **`/crew:status` labels a custom `adapter_config.stories_root` as `mismatched`** because `BmadAdapter.detect()` (line 198–216) only checks the default `_bmad-output/planning-artifacts/stories` path, never the configured override. Story 3.3b moved adapter config binding into `resolveWorkspace`, but `detect()` was not updated to honour the binding. Result: a legitimately configured workspace looks broken on `/crew:status`. This confused the first dogfood operator into thinking the install was wrong.

This story closes all five deviations in one pass. It is the final story in Epic 3 — after it lands, the backlog layer can drain a real BMad repo end-to-end without a pre-flight mass rewrite of every spec. Without this story, Epic 3 is paper-complete but unusable against any backlog older than the fixture.

### This story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`. The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- (b) Modify any spec file in the `crew` repo's own backlog to make it conform. The whole point of the story is that the adapter MUST handle existing files as-is. The dev agent MUST NOT "fix" any of the letter-suffixed, status-less, or non-canonical-status specs under `_bmad-output/implementation-artifacts/` during implementation.
- (c) Change the canonical BMad status vocabulary itself (`backlog`, `ready-for-dev`, `in-progress`, `done`, `optional`, `contexted`). The `BmadStatus` type in `map-bmad-status.ts` is unchanged. The unknown-status path produces a `blocked/` manifest with `blocked_by: status-vocabulary-unknown` — it does NOT silently add new statuses to the type, and it does NOT route the story into a normal execution state.
- (d) Add a new execution state (`to-do`, `in-progress`, `blocked`, `done` is the v1 vocabulary; this story does not introduce a fifth). Unknown-status stories go to `blocked/` — same directory the discipline-gate violations route to per Story 3.5.
- (e) Change the `ExecutionManifestSchema` (`schemas/execution-manifest.ts`). The existing `blocked_by` field already accepts arbitrary string reasons; `status-vocabulary-unknown` is just a new value, not a schema change.
- (f) Implement an authoring-side editor / fixer for non-conforming BMad specs. The plugin remains read-only against the BMad source tree per `planning-adapter-model.md` §Two-layer model. The operator still owns their BMad files.
- (g) Change the ref-namespace shape (`bmad:<epic>.<story>`). Letter-suffixed refs follow the existing pattern with the letter appended: `bmad:4.8b`, `bmad:5.4b`, `bmad:6.13`. The dot remains the separator; the letter, if present, is part of the story portion. The execution-manifest filename mirrors the ref (`bmad:4.8b.yaml`).
- (h) Sort letter-suffixed stories in any new way. Sort order is preserved by digit-first, then letter-suffix-alphabetical-within-the-same-digits (so `4.8`, `4.8b`, `4.8c`, `4.9`). The existing numeric sort in `listSourceStories` extends to a tiebreak on the suffix.
- (i) Change the `MalformedBmadStoryError` path for genuinely-malformed files (e.g. no H1, H1 numbering disagrees with filename, no `## Acceptance Criteria` section with valid AC headings). Those remain hard failures. The leniency in this story is scoped exactly to the four deviations enumerated above.
- (j) Add a per-deviation telemetry surface beyond the existing pino plumbing. The unknown-status warning emits via the same scan-output channel as other scan messages (Story 3.2's `scan-sources` text output); no new telemetry event types are introduced in v1.
- (k) Re-author or modify the BMad spike report at `plugins/crew/docs/spikes/bmad-format.md`. The spike documents the canonical shape; this story documents the leniency in code + the install README, not by rewriting the spike. (If the spike is touched, it is to add a brief "real-world deviations" appendix referencing this story — not to mutate the canonical-shape documentation itself.)
- (l) Touch the native adapter. Native stories are authored by the planner against the native-adapter schema; deviation-tolerance does not apply.

---

## Acceptance Criteria

> AC1–AC5 are from the epic with `user-surface` tagging applied per `plugins/crew/docs/user-surface-acs.md`. AC6 is the epic's integration AC.

**AC1 (user-surface):**
**Given** a target repo whose `<stories_root>` contains a spec file with a letter-suffixed story ID (e.g. `4-8b-deterministic-seam-hardening.md`, `5-4b-paused-for-human-surface.md`, `6-13-persona-files-version-controlled.md`) whose H1 matches `# Story <epic>.<story-with-letter>: <title>` (e.g. `# Story 4.8b: Deterministic seam hardening`),
**When** the operator runs `/crew:scan`,
**Then** the file parses successfully, the resulting `SourceStory.ref` preserves the letter suffix as `bmad:<epic>.<story><letter>` (e.g. `bmad:4.8b`), the execution manifest is written at `<target-repo>/.crew/state/<lifecycle-state>/bmad:<epic>.<story><letter>.yaml` (e.g. `.crew/state/to-do/bmad:4.8b.yaml`), and the scan output reported by `/crew:scan` includes the letter-suffixed ref in the list of newly-scanned refs. _(closes the gap that hides ~10 follow-up stories from crew; epic AC1)_
<!-- User-surface: AC1 names `/crew:scan` (rubric i — slash command literal) and the file path `<target-repo>/.crew/state/<lifecycle-state>/bmad:<epic>.<story><letter>.yaml` (rubric iii — a path the operator opens by name per docs to confirm the manifest landed). The operator observes the letter-suffixed ref appearing in the scan output in chat. -->

**AC2:**
**Given** a BMad spec file whose preamble (between the H1 and the first `## ` heading) contains NO `Status:` line at all,
**When** the BMad adapter parses the file,
**Then** the parser MUST NOT throw `MalformedBmadStoryError` for the missing line; it MUST treat the story as if `Status: backlog` were present (mapping to execution state `to-do` via `mapBmadStatusToExecution`), and the resulting `SourceStory.raw_frontmatter.status` MUST equal the literal string `"backlog"` so downstream consumers see the same shape they would for an explicitly-stated `Status: backlog` story. _(handles the cohort of specs in this repo that have no `Status:` field; epic AC2)_
<!-- Not user-surface: AC2 governs internal adapter parsing behaviour. The operator observes the downstream effect — the story appears in their backlog — but that observation is covered by AC1's `/crew:scan` surface and AC6's integration test. The AC's load-bearing assertions are on the `SourceStory` shape returned by the parser, which is substrate. -->

**AC3 (user-surface):**
**Given** a BMad spec file whose `Status:` value sits outside the canonical vocabulary (`backlog`, `ready-for-dev`, `in-progress`, `done`, `optional`, `contexted`) — e.g. `Status: review`, `Status: revised — re-implement per ...`, `Status: needs-product-review`,
**When** the operator runs `/crew:scan`,
**Then** the adapter MUST emit exactly one warning to the scan output for that file, of the verbatim form `BMad story <relative-path-from-stories-root>: unrecognised Status value '<value>' — treating as blocked (status-vocabulary-unknown). Add a recognised status or correct the typo.` (with `<relative-path-from-stories-root>` and `<value>` substituted), MUST write an execution manifest under `<target-repo>/.crew/state/blocked/<ref>.yaml` carrying `blocked_by: status-vocabulary-unknown` AND `blocked_details: { unrecognised_status: "<value>" }`, AND MUST continue the scan — every other story in the directory MUST be processed exactly as if the bad file were not there. The scan MUST NOT halt; the scan's exit shape (success / failure) is determined only by genuinely-fatal errors (missing H1, AC-section malformed, etc.), not by unknown-status files. _(robustness; today the scan halts on the first malformed file, hiding all downstream issues; epic AC3)_
<!-- User-surface: AC3 names `/crew:scan` (rubric i — slash command literal). The warning string is observable in the scan output the operator reads in chat, and the verbatim format is the user-surface contract. The `.crew/state/blocked/<ref>.yaml` path is also operator-openable per docs. -->

**AC4:**
**Given** a file in the configured `<stories_root>` directory whose filename does NOT match the BMad-story filename pattern (`<epic>-<story>[<letter>]-<slug>.md`) — e.g. `epic-1-retro-2026-05-20.md`, `sprint-status.yaml`, `README.md`, `.DS_Store`,
**When** the BMad adapter scans,
**Then** the file MUST be silently skipped: no warning emitted, no error thrown, no manifest written. `listSourceStories()` MUST NOT include the file in its returned array, and `readSourceStory()` on a ref pointing at a non-conforming filename MUST throw the existing `UnknownBmadRefError` (not `MalformedBmadStoryError`). _(retros and bookkeeping files legitimately live in the same directory; epic AC4)_
<!-- Not user-surface: AC4 governs internal adapter filtering behaviour. The operator does not observe a skip — they observe the absence of a spurious error, but the assertion is on the adapter's return shape, which is substrate. -->

**AC5 (user-surface):**
**Given** a target repo whose `.crew/config.yaml` declares `adapter: bmad` AND sets `adapter_config.stories_root` to a value that differs from `BmadAdapter.defaultConfig().stories_root` (the canonical default `_bmad-output/planning-artifacts/stories`) — for example `adapter_config.stories_root: "_bmad-output/implementation-artifacts"`,
**When** the operator runs `/crew:status`,
**Then** the `adapter:` line in the rendered status MUST read `adapter: bmad (ok)` — NOT `adapter: bmad (mismatched)`. The `BmadAdapter.detect()` method MUST honour the configured `adapter_config.stories_root` when present (falling back to `defaultConfig().stories_root` only when no config is supplied), and MUST return `true` whenever the configured path contains at least one BMad-shaped file. _(cosmetic, but it confused the first-dogfood operator into thinking the setup was broken; epic AC5)_
<!-- User-surface: AC5 names `/crew:status` (rubric i — slash command literal) and the rendered chat text `adapter: bmad (ok)` (rubric iv — chat output the operator observes). The `.crew/config.yaml` path is also operator-edited per docs. -->

**AC6:**
vitest covers each of AC1–AC5 against a new fixture directory mirroring this repo's actual messy state — specifically: at least one letter-suffixed file (e.g. `4-8b-foo.md`), at least one spec with no `Status:` line, at least one spec with a free-text `Status:` value, at least one non-conforming filename (e.g. `epic-1-retro-2026-05-20.md`), and a canonical clean spec (control). The fixture lives under `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-messy-repo/` and mirrors the layout of the existing `sample-target-repo` fixture. The test suite MUST scan the fixture end-to-end and assert: (a) the letter-suffixed spec produces a `to-do/bmad:<epic>.<story><letter>.yaml` manifest with the ref preserved; (b) the no-`Status:` spec produces a `to-do/<ref>.yaml` manifest with `raw_frontmatter.status === "backlog"`; (c) the free-text-`Status:` spec produces a `blocked/<ref>.yaml` manifest with `blocked_by: "status-vocabulary-unknown"` AND `blocked_details.unrecognised_status` equal to the verbatim source value, AND the scan-output array of warnings contains exactly one entry matching the verbatim AC3 format string for that file; (d) the non-conforming filename does NOT appear anywhere in `listSourceStories()` output, no warning is emitted for it, and no manifest is written for it; (e) the clean control spec produces its expected `to-do/<ref>.yaml` manifest unchanged from the pre-3.8 behaviour; (f) a second back-to-back scan of the same fixture is idempotent — mtime stable on all five manifests, no duplicate warnings emitted. Additionally, a focused unit test on `BmadAdapter.detect()` MUST seed a tmpdir with a custom `stories_root` (e.g. `custom-stories-root/`) containing one BMad-shaped file, invoke `detect()` against a workspace whose `adapter_config.stories_root` points at that custom path, and assert `detect()` returns `true` (pinning AC5's substrate side; the operator-visible `/crew:status` surface side is covered by an integration test against `getStatus()`). _(epic AC6)_
<!-- Not user-surface: AC6 is the integration-test surface. Tests are not observed by the operator. -->

---

## Behavioural contract

Story 3.8 has three deliverables: (1) the BMad parser (`parse-bmad-story.ts`) gains tolerance for letter-suffixed IDs and missing / non-canonical Status values; (2) the BMad adapter (`adapters/bmad/index.ts`) gains the warning-and-continue path for unknown-status files and the custom-`stories_root` honour in `detect()`; (3) `scan-sources` (`tools/scan-sources.ts`) surfaces the warnings to its output and routes unknown-status files into `blocked/` with the new `blocked_by` reason. Each is bound by the invariants below. None of these is LLM-driven; the contract is enforceable in code and the integration tests pin it.

### `parseBmadStory` parser (pure code — `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts`)

- **MUST** widen the filename regex from `/^(\d+)-(\d+)-([a-z0-9-]+)\.md$/` to `/^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$/` so a single lowercase letter MAY follow the second digit group. Multiple letters (`4-8bc-...`) are NOT supported in v1 — the regex captures a single letter or nothing.
- **MUST** widen the H1 regex from `/^#\s+Story\s+(\d+)\.(\d+)\s*:\s*(.+?)\s*$/` to `/^#\s+Story\s+(\d+)\.(\d+)([a-z]?)\s*:\s*(.+?)\s*$/` to mirror the filename regex.
- **MUST** require the H1's letter suffix (or absence thereof) to match the filename's letter suffix exactly. Mismatch (e.g. filename `4-8b-foo.md`, H1 `# Story 4.8: Foo`) throws `MalformedBmadStoryError` with the existing "H1 numbering disagrees with filename" reason, extended to mention the letter suffix.
- **MUST** preserve the letter suffix in the returned `SourceStory.ref` as `bmad:<epic>.<story><letter>` (e.g. `bmad:4.8b`). When no letter is present, the ref shape is unchanged (`bmad:<epic>.<story>`). Backward compatibility: existing letter-less specs produce byte-identical refs to pre-3.8.
- **MUST**, when no `Status:` line is found between the H1 and the first `## ` heading, default `statusValue` to the literal string `"backlog"` and proceed. The `raw_frontmatter.status` field MUST be set to `"backlog"` (the defaulted value), not omitted.
- **MUST**, when a `Status:` line IS found but its value is not in the canonical vocabulary (`backlog`, `ready-for-dev`, `in-progress`, `done`, `optional`, `contexted`), NOT throw `MalformedBmadStoryError`. Instead, the parser MUST return a `SourceStory` augmented with a new optional field `parseAdvisory: { kind: "unknown-status"; rawValue: string }` on the returned object (Zod schema for `SourceStory` is extended additively — `parseAdvisory` is `.optional()`). The caller (the adapter) handles routing this advisory into the blocked-manifest path; the parser itself is layer-agnostic.
- **MUST** preserve every other validation it currently performs: H1 presence, H1 numbering / filename agreement (extended for letter suffix), AC-section parseability, dependency parsing. Genuinely-malformed files still throw `MalformedBmadStoryError`. The leniency is scoped exactly to the two deviations above.
- **MUST** be deterministic: identical input bytes produce identical `SourceStory` output (including the `source_hash` and the `parseAdvisory` field's presence / absence).
- **MUST NEVER** mutate any field other than what is explicitly described. The advisory is the only new field. `mapBmadStatusToExecution` is NOT called from the parser; it is the adapter's concern.

### `BmadAdapter` (pure code — `plugins/crew/mcp-server/src/adapters/bmad/index.ts`)

- **MUST** export the existing `BMAD_FILENAME_RE` regex (currently `/^\d+-\d+-[a-z0-9-]+\.md$/`) widened to `/^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/` to mirror the parser's filename widening. This regex governs `readStoriesDir` / `readStoriesDirSync` filtering; the widening is what makes letter-suffixed files visible to `listSourceStories` in the first place.
- **MUST**, in `listSourceStories()`, for each parsed `SourceStory` whose `parseAdvisory.kind === "unknown-status"`, set a new internal flag on the returned story that the calling tool (`scan-sources`) reads to route the story into the `blocked/` manifest path with `blocked_by: status-vocabulary-unknown`. The mechanism MAY be either (i) the `parseAdvisory` field on `SourceStory` (preferred — surfaces upward through the same channel for both the adapter integration tests and the scan-sources path), OR (ii) a separate per-story warning emitted via a new `warnings: string[]` field on the `listSourceStories()` return shape. Recommended default: keep `parseAdvisory` on `SourceStory` and have `scan-sources` consume it; this avoids a return-shape change to the adapter interface.
- **MUST** update `BmadAdapter.detect(targetRepo: string)` to accept an optional second argument `(targetRepo: string, adapterConfig?: { stories_root?: string })` OR, equivalently, to honour the bound `currentContext` if set. The recommended default per the existing `configureBmadAdapter` pattern: keep the `detect` signature as `(targetRepo: string)` (preserves the `PlanningAdapter` interface) and instead have `detect` consult the bound `currentContext.storiesRoot` when present, falling back to `DEFAULT_STORIES_ROOT` only when no context has been bound. The `resolveWorkspace` → `validateActiveAdapter` chain (Story 3.3b) already binds the context before `validateActiveAdapter` calls `detect`, so the wiring works for the `/crew:status` surface.
- **MUST**, in the sort order applied at the end of `listSourceStories()`, extend the existing numeric comparator to break ties on the letter suffix. The order MUST be: `4.8` < `4.8b` < `4.8c` < `4.9`. Empty-string suffix sorts before any letter; letters sort alphabetically. (Implementation: extend the `raw_frontmatter["id"]` parse from `"4.8"` to `"4.8b"`, split into `[epic, storyPortion]`, then split `storyPortion` into `[digits, letter]` for the tie-break.)
- **MUST** preserve the AmbiguousBmadRefError invariant — two files claiming the same `bmad:<ref>` (now including letter suffix) still throws. The letter suffix is part of the ref namespace; `4-8` and `4-8b` are DIFFERENT refs, not duplicates.
- **MUST NEVER** silently skip a file whose filename matches the (widened) pattern but whose contents are malformed. Filename-match files still go through the full parser; malformed-contents files still throw. The skip is exclusively for filename-mismatch (e.g. `epic-1-retro-...md`).
- **MUST NEVER** mutate the source story file. The adapter is read-only against the BMad tree.

### `scan-sources` tool (pure code — `plugins/crew/mcp-server/src/tools/scan-sources.ts`)

- **MUST** consume the `parseAdvisory` field (or equivalent per the recommended default above) on each `SourceStory` returned by `BmadAdapter.listSourceStories()`. For each story whose advisory is `{ kind: "unknown-status", rawValue }`, the tool MUST:
  - Emit a warning to its output of the verbatim form: `BMad story <relative-path>: unrecognised Status value '<rawValue>' — treating as blocked (status-vocabulary-unknown). Add a recognised status or correct the typo.` where `<relative-path>` is the spec file path relative to `<target-repo>/<stories_root>` (forward slashes, no leading dot or slash).
  - Write the execution manifest into `.crew/state/blocked/<ref>.yaml` (NOT `to-do/`), with `status: "blocked"`, `blocked_by: "status-vocabulary-unknown"`, and `blocked_details: { unrecognised_status: rawValue }`. The `source_hash`, `source_path`, `acceptance_criteria`, `depends_on`, and other fields are populated exactly as for a normal scan.
  - Continue processing the rest of the scan. The unknown-status file MUST NOT cause the scan to exit non-zero or to skip downstream stories.
- **MUST** make the warning-emission idempotent. A second back-to-back `/crew:scan` against the same source MUST NOT emit a duplicate warning UNLESS the source story's `source_hash` has changed (i.e. the operator edited the file). On no source change, the existing manifest in `blocked/` is not rewritten (mtime stable) and no warning is emitted. The mechanism: compare the existing on-disk manifest's `blocked_by` and `blocked_details.unrecognised_status` against the new values; if both match, no rewrite, no warning. If either differs, rewrite and warn once.
- **MUST** preserve every existing Story 3.2 / Story 3.5 invariant: idempotent re-scan when nothing changed; source-hash refresh when source bytes change (now extending the same refresh to `blocked/` manifests when their `blocked_details` would change); operator-edits in `to-do/` and `blocked/` preserved on hash refresh (Story 3.7).
- **MUST NEVER** route an unknown-status story into `to-do/` or `done/`. The only routing target is `blocked/`. (The existing `validateAgainstDiscipline` path for state-mutating-no-integration-AC also routes to `blocked/` per Story 3.5; both reasons coexist on the same `blocked_by` field as alternative string values.)
- **MUST NEVER** halt the scan on a single unknown-status file. Every other story in the directory continues processing.

### `getStatus` / `BmadAdapter.detect` interaction (pure code — `tools/get-status.ts` + `adapters/bmad/index.ts`)

- **MUST**, when `BmadAdapter.detect()` is called from `validateActiveAdapter()` against a workspace whose `adapter_config.stories_root` differs from `DEFAULT_STORIES_ROOT`, honour the configured override. The implementation point is `BmadAdapter.detect()` itself — `validateActiveAdapter` calls `workspace.activeAdapter.detect(workspace.targetRepoRoot)` (no config passed); the adapter MUST read the config from its bound `currentContext` (set by `configureBmadAdapter` inside `resolveWorkspace` per Story 3.3b).
- **MUST**, when `detect()` runs with NO bound context (cold call from `registry.detect()` during adapter resolution), fall back to `DEFAULT_STORIES_ROOT` exactly as today. This preserves the cold-resolution path (an operator with no `adapter:` configured can still have crew detect BMad against the default path).
- **MUST** preserve the `getStatus` algorithm: hard failures still propagate; `StaleWorkspaceConfigError` still downgrades to `adapter.state = "mismatched"`. The only change is that `StaleWorkspaceConfigError` SHOULD NOT fire for the legitimate-custom-path case. (Other genuinely-stale cases — operator deletes the BMad tree, swaps adapters — still throw and still downgrade.)
- **MUST NEVER** silently mask a genuinely-stale configuration. If `detect()` honours the custom `stories_root` but the path does not exist OR contains zero BMad-shaped files, `detect()` returns `false` and the mismatched label still surfaces. The fix is "honour the override", not "always return true".

### Negative-capability invariants

- **MUST NEVER** modify any file under `_bmad-output/implementation-artifacts/`. The dev agent does not "fix" any existing letter-suffixed, status-less, or non-canonical-status spec to make tests pass. The fixture lives under `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-messy-repo/` and is the sole test surface.
- **MUST NEVER** modify any spec file in the `crew` repo's own backlog. The point of this story is the adapter tolerates the existing files; the existing files are the inputs.
- **MUST NEVER** add new BMad status values to the `BmadStatus` type or to `mapBmadStatusToExecution`. The canonical vocabulary is preserved; unknown statuses route to `blocked/`.
- **MUST NEVER** delete a non-conforming file from the stories directory. The skip is filter-on-read, not delete-on-disk.
- **MUST NEVER** call `gh`, the network, the shell, or any process outside the MCP server.
- **MUST NEVER** weaken the existing `MalformedBmadStoryError` for genuinely-malformed files (missing H1, AC-section unparseable, etc.). The leniency window is scoped exactly to the four deviations enumerated above.
- **MUST NEVER** swallow the existing `AmbiguousBmadRefError` — two files at the same ref (including letter suffix) still throws.

---

## Tasks / Subtasks

- [ ] **Task 1 — Widen `parseBmadStory` for letter suffixes + missing Status + unknown Status (AC: 1, 2, 3)**
  - [ ] 1.1 Edit `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts`. Update `filenameMatch` regex to `/^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$/` so the third capture group is the optional single-letter suffix and the fourth is the slug.
  - [ ] 1.2 Update the H1 regex to `/^#\s+Story\s+(\d+)\.(\d+)([a-z]?)\s*:\s*(.+?)\s*$/`. Capture group 3 is the optional letter suffix.
  - [ ] 1.3 Extend the H1-vs-filename agreement check to compare letter suffixes. If filename has `4-8b` but H1 has `4.8`, OR vice versa, throw `MalformedBmadStoryError` with a reason that names both the digit-and-letter form on each side.
  - [ ] 1.4 Compute the new ref form: `bmad:<epicFromName>.<storyFromName><letterFromName>`. When the letter is absent, the ref is unchanged from today.
  - [ ] 1.5 In the Status-line scan, if NO `Status:` line is found between the H1 and the first `## ` heading, set `statusValue = "backlog"` (defaulted value) and proceed. Do NOT throw the existing "no 'Status: <value>' line found" error.
  - [ ] 1.6 If a `Status:` line IS found but `isKnownBmadStatus(statusValue)` returns false, do NOT throw `MalformedBmadStoryError`. Instead, set `parseAdvisory = { kind: "unknown-status", rawValue: statusValue }` on the returned `SourceStory`. For the purposes of `raw_frontmatter.status` and `mapBmadStatusToExecution`, treat the story as if `Status: backlog` (route to `to-do`) — the routing to `blocked/` is the calling tool's concern in Task 3.
  - [ ] 1.7 Add the optional `parseAdvisory` field to the `SourceStory` type in `adapters/adapter.ts` (or to the BMad-adapter-local return shape — confer with the existing interface). Recommended default: add it to `SourceStory` as `parseAdvisory?: { kind: "unknown-status"; rawValue: string }` so other adapters (future Linear / GitHub Issues) have the same shape for similar deviations. The field is optional and additive — no Zod / type-narrowing changes for existing callers.
  - [ ] 1.8 The `raw_frontmatter.status` field, when `Status:` was missing, MUST equal the literal `"backlog"` (the defaulted value), so downstream consumers see the same shape as an explicitly-stated `Status: backlog` story. When `Status:` was unknown, `raw_frontmatter.status` MUST equal the rawValue verbatim (so the operator-visible reason in `blocked_details.unrecognised_status` matches the on-disk source).
  - [ ] 1.9 Preserve every other parser behaviour: H1 presence, AC-section parseability, dependency parsing, ship-gate tag detection, source-hash computation. The leniency is scoped.

- [ ] **Task 2 — Widen `BmadAdapter` filename filter + sort + custom-`stories_root` honour in `detect()` (AC: 1, 4, 5)**
  - [ ] 2.1 Edit `plugins/crew/mcp-server/src/adapters/bmad/index.ts`. Widen the `BMAD_FILENAME_RE` constant from `/^\d+-\d+-[a-z0-9-]+\.md$/` to `/^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/`. This widens both `readStoriesDir` (the live path) and `readStoriesDirSync` (the cold-cache path) simultaneously.
  - [ ] 2.2 Extend the sort comparator at the end of `listSourceStories()`. Parse `raw_frontmatter["id"]` (now potentially `"4.8b"`) by splitting on `.`, then peeling the trailing letter off the story portion. Compare: epic-digits → story-digits → letter (empty < `a` < `b` < `c` …). Pin the order with the AC6 test on a fixture containing `4.8`, `4.8b`, `4.8c`, `4.9`.
  - [ ] 2.3 Update `epicStoryFromFilename(file)` and `parseRef(ref)` to handle letter suffixes. `epicStoryFromFilename` now returns `{ epic: number; story: number; letter: string }` (letter is `""` when absent). `parseRef` accepts `bmad:<epic>.<story><letter>` and returns the same shape.
  - [ ] 2.4 Update `buildRefIndex` to key on the canonical letter-suffixed ref. Two files at the same letter-suffixed ref still trigger `AmbiguousBmadRefError`.
  - [ ] 2.5 Update `BmadAdapter.detect(targetRepo)` to honour the bound context's `storiesRoot` when present. Implementation: at the top of `detect`, if `currentContext !== undefined`, use `absStoriesRoot(currentContext)` as the root to scan; otherwise fall back to `path.join(targetRepo, DEFAULT_STORIES_ROOT)`. The rest of the function (read entries, return true on first `BMAD_FILENAME_RE` match) is unchanged.
  - [ ] 2.6 Add a TSDoc note on `detect()` explaining the bound-context-vs-cold-call branch and citing Story 3.8 + Story 3.3b. Note that the cold-call path (no bound context) is the registry's `detect()` sweep during adapter resolution; the bound path is `validateActiveAdapter`'s post-`resolveWorkspace` call.

- [ ] **Task 3 — `scan-sources` consumes `parseAdvisory` and routes unknown-status to `blocked/` (AC: 3)**
  - [ ] 3.1 Edit `plugins/crew/mcp-server/src/tools/scan-sources.ts`. After fetching `SourceStory[]` from `adapter.listSourceStories()`, iterate over the array; for each story whose `parseAdvisory?.kind === "unknown-status"`, route it into the `blocked/` write path with `status: "blocked"`, `blocked_by: "status-vocabulary-unknown"`, `blocked_details: { unrecognised_status: parseAdvisory.rawValue }`. Other stories route as today.
  - [ ] 3.2 Add the verbatim warning emission. Output channel: the same scan-output text the tool returns to the MCP client (concatenate alongside the existing "scanned N refs" output). Warning format (verbatim, with substitution): `BMad story <relative-path>: unrecognised Status value '<rawValue>' — treating as blocked (status-vocabulary-unknown). Add a recognised status or correct the typo.` where `<relative-path>` is `path.relative(<absStoriesRoot>, story.raw_path)` with forward slashes.
  - [ ] 3.3 Make warning-emission idempotent. Before writing a `blocked/<ref>.yaml` for an unknown-status story, read the existing on-disk manifest (if any) and compare `blocked_by` + `blocked_details.unrecognised_status` against the new values. Match → no rewrite, no warning. Mismatch (or no existing manifest) → rewrite + warn once. The mtime-stable invariant (NFR10) carries forward.
  - [ ] 3.4 Confirm the source-hash refresh behaviour for `blocked/` manifests: when the source's `source_hash` changes but the unknown-status value does not change, the manifest's `source_hash` and `source_path` MUST update (mirroring Story 3.2 AC3 for `to-do/` manifests). When the unknown-status value itself changes (operator edited `Status: review` → `Status: blockety-blah`), the manifest's `blocked_details` updates AND a new warning is emitted.
  - [ ] 3.5 Preserve every other `scan-sources` invariant: idempotency on no source change, source-hash refresh on source change, operator-edits in `to-do/` and `blocked/` preserved (Story 3.7), `validateAgainstDiscipline` routing still produces `blocked_by: "planning-discipline"` for state-mutating-no-integration-AC stories. The two `blocked_by` reasons coexist as independent string values.

- [ ] **Task 4 — Integration test fixture + suite (AC: 6)**
  - [ ] 4.1 Create a new fixture directory at `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-messy-repo/`. Mirror the layout of the existing `sample-target-repo` fixture: `.crew/config.yaml` declares `adapter: bmad` with `adapter_config.stories_root` pointing at the messy stories directory (or use the default — the test seeds whichever is simpler). Under `<stories_root>/`:
    - `1-1-clean-control.md` — a canonical clean spec (H1 `# Story 1.1: Clean control`, `Status: backlog`, valid AC section).
    - `4-8b-letter-suffix.md` — H1 `# Story 4.8b: Letter suffix exercise`, `Status: ready-for-dev`, valid AC section.
    - `2-3-no-status-line.md` — H1 `# Story 2.3: No status line`, NO `Status:` line at all between the H1 and the first `##`, valid AC section.
    - `2-4-unknown-status.md` — H1 `# Story 2.4: Unknown status`, `Status: review` (or any non-canonical value), valid AC section.
    - `epic-1-retro-2026-05-20.md` — a non-story bookkeeping file the adapter MUST silently skip. Contents are irrelevant; the test asserts it is not in `listSourceStories()`.
    - `sprint-status.yaml` — another non-story bookkeeping file the adapter MUST silently skip.
  - [ ] 4.2 Create the integration test at `plugins/crew/mcp-server/src/adapters/bmad/__tests__/messy-repo.integration.test.ts`. Tests:
    - **(a) Letter-suffix end-to-end:** invoke `scan-sources` against the fixture; assert `<target-repo>/.crew/state/to-do/bmad:4.8b.yaml` exists with `ref: "bmad:4.8b"` and `source_path` pointing at the letter-suffixed file.
    - **(b) Missing-Status defaults to backlog:** assert `<target-repo>/.crew/state/to-do/bmad:2.3.yaml` exists with `raw_frontmatter.status === "backlog"` (or equivalent surfaced field — confer with the existing manifest schema's representation of source status).
    - **(c) Unknown-Status → blocked:** assert `<target-repo>/.crew/state/blocked/bmad:2.4.yaml` exists with `blocked_by: "status-vocabulary-unknown"` AND `blocked_details.unrecognised_status === "review"` (or the fixture's literal value). Assert the scan-output text contains exactly one warning matching the verbatim AC3 format string (use regex with the substituted path + value, anchored).
    - **(d) Non-conforming filename silently skipped:** assert `listSourceStories()` returned array does NOT contain any entry pointing at `epic-1-retro-2026-05-20.md` or `sprint-status.yaml`. Assert no manifest is written for either. Assert no warning is emitted for either (warnings array is empty for those files).
    - **(e) Clean control unchanged:** assert `<target-repo>/.crew/state/to-do/bmad:1.1.yaml` exists with the expected pre-3.8 shape.
    - **(f) Idempotency:** run `scan-sources` a second time back-to-back; assert every manifest's mtime is stable; assert the second-run scan output emits zero new warnings (the unknown-status warning fired exactly once across the two runs).
  - [ ] 4.3 Add a focused unit test for the parser at `plugins/crew/mcp-server/src/adapters/bmad/__tests__/parse-bmad-story.leniency.test.ts`:
    - (1) Letter-suffix filename + H1 → ref preserves suffix, no throw.
    - (2) Letter-suffix filename, letter-less H1 (mismatch) → throws `MalformedBmadStoryError` citing the mismatch.
    - (3) No `Status:` line → returns `SourceStory` with `raw_frontmatter.status === "backlog"`, no throw, no `parseAdvisory`.
    - (4) Unknown `Status:` value → returns `SourceStory` with `parseAdvisory.kind === "unknown-status"` and `parseAdvisory.rawValue` equal to the source value, no throw.
    - (5) Canonical clean spec → returns the same `SourceStory` shape as pre-3.8 (byte-equivalent `ref`, `source_hash`, etc. — used as a regression pin).
  - [ ] 4.4 Add a focused unit test for `BmadAdapter.detect()` at `plugins/crew/mcp-server/src/adapters/bmad/__tests__/detect-custom-stories-root.test.ts`:
    - (1) Seed a tmpdir with `custom-stories/` containing one BMad-shaped file (e.g. `1-1-canary.md`).
    - (2) Call `configureBmadAdapter({ targetRepo: tmpdir, storiesRoot: "custom-stories" })`.
    - (3) Call `BmadAdapter.detect(tmpdir)`.
    - (4) Assert `detect` returns `true`.
    - (5) For the negative case: re-run with `storiesRoot: "nonexistent"`; assert `detect` returns `false`.
    - (6) For the cold-call case: `resetBmadAdapter()`, then `detect(tmpdir)`; assert `detect` returns `false` (no `_bmad-output/planning-artifacts/stories` in the tmpdir).

- [ ] **Task 5 — End-to-end `/crew:status` test for the custom-`stories_root` no-mismatch fix (AC: 5)**
  - [ ] 5.1 Add an integration test at `plugins/crew/mcp-server/src/tools/__tests__/get-status.custom-stories-root.integration.test.ts` (or co-located with the existing `get-status` test):
    - Seed a tmpdir target repo with `.crew/config.yaml` declaring `adapter: bmad` and `adapter_config.stories_root: "custom-stories"`.
    - Seed `custom-stories/1-1-canary.md` with a clean BMad-shaped spec.
    - Call `getStatus({ targetRepoRoot: tmpdir })`.
    - Assert `report.adapter.state === "ok"` and `report.adapter.name === "bmad"`.
    - Render via `renderStatus(report)`; assert the adapter line equals `adapter: bmad (ok)` (not `mismatched`).
  - [ ] 5.2 Add the negative regression pin: same seed but with a stories root that does NOT exist (`adapter_config.stories_root: "nonexistent-stories"`). Assert `report.adapter.state === "mismatched"` — the fix is "honour the override", not "always pass".

- [ ] **Task 6 — Documentation (AC: 1, 3, 5)**
  - [ ] 6.1 Edit `plugins/crew/docs/README-install.md`. Add a one-paragraph section under an existing "Adapter configuration" heading (or create one if absent) explaining: (i) custom `adapter_config.stories_root` is honoured by both `/crew:scan` and `/crew:status`; (ii) letter-suffixed story IDs are first-class refs (cite the format `bmad:<epic>.<story><letter>`); (iii) specs without a `Status:` line default to `backlog`; (iv) specs with an unrecognised `Status:` value are routed to `blocked/` with `blocked_by: status-vocabulary-unknown` and the scan emits a per-file warning; (v) non-story files (retros, `sprint-status.yaml`, etc.) sharing the stories directory are silently skipped.
  - [ ] 6.2 Optionally append a short "Real-world deviations" appendix to `plugins/crew/docs/spikes/bmad-format.md` (the BMad-format spike report from Story 3.3) summarising the four deviations and pointing at Story 3.8 as the authoritative implementation reference. Recommended default: yes — the spike is otherwise out of date the moment this story lands, and the appendix keeps the documentation trail tidy.

- [ ] **Task 7 — Wire-up and build (AC: all)**
  - [ ] 7.1 Confirm no new exports are needed beyond the existing barrel re-exports in `plugins/crew/mcp-server/src/adapters/bmad/index.ts`. The `parseAdvisory` field is part of the existing `SourceStory` type; no new symbol needs registration.
  - [ ] 7.2 Rebuild `plugins/crew/mcp-server/dist/` and commit per `CLAUDE.md` §Process notes. CI fails on drift.
  - [ ] 7.3 Confirm no regression in existing tests: the existing `sample-target-repo` fixture suite (Story 3.3), the `scan-sources` idempotency suite (Story 3.2), the `validateAgainstDiscipline` suite (Story 3.5), the operator-edit-preservation suite (Story 3.7), and the `get-status` happy-path suite (Story 1.7). Letter-suffix-less specs MUST produce byte-identical manifests to pre-3.8.
  - [ ] 7.4 Confirm the existing `sample-malformed-repo` fixture (under `adapters/bmad/fixtures/sample-malformed-repo/`) still triggers `MalformedBmadStoryError` where it should — the leniency widening MUST NOT swallow genuinely-malformed-H1 or AC-section-malformed cases.

---

## Architecture compliance

- `PlanningAdapter` interface from `mcp-server/src/adapters/adapter.ts` is unchanged in signature. The optional `parseAdvisory` field on `SourceStory` is an additive extension; existing callers are not broken.
- The execution-manifest schema (`schemas/execution-manifest.ts`, Story 3.2) is unchanged. `blocked_by` already accepts arbitrary string reasons; `"status-vocabulary-unknown"` is a new value, not a schema change. `blocked_details` already exists as an open record for per-reason context.
- The state-machine directory layout (Story 1.6 / Story 3.2) is unchanged. Unknown-status stories route to `blocked/` — the same directory discipline-violation stories route to per Story 3.5.
- `planning-adapter-model.md` §Two-layer model is the binding source: the BMad source tree is read-only; the plugin's manifest layer is the plugin's own. This story preserves both invariants — no source-tree write, no schema change to the manifest layer.
- The BMad-format spike at `plugins/crew/docs/spikes/bmad-format.md` (Story 3.3) documents the canonical shape; this story documents the leniency adjacent to it (Task 6.2 appendix).
- Story 3.3b's "adapter config bound in `resolveWorkspace`" invariant is the basis for the `detect()` honour-custom-`stories_root` fix — `validateActiveAdapter` calls `detect()` AFTER `resolveWorkspace` has bound the context, so the adapter has the override in hand when needed.
- Story 3.5's `validateAgainstDiscipline` is unchanged. The unknown-status path runs BEFORE `validateAgainstDiscipline` (a story with unknown status is routed to `blocked/` with `blocked_by: status-vocabulary-unknown` and the discipline gate never runs on it — there's nothing the gate could do that the unknown-status routing doesn't already cover).
- Story 3.7's operator-edit allowance is unchanged. Operators MAY hand-edit a `blocked/<ref>.yaml` manifest with `blocked_by: status-vocabulary-unknown` exactly as for any other blocked manifest; the next scan honours the hand-edit unless the source's hash changes.
- The atomic-write contract (`atomicWriteFile` from `lib/managed-fs.ts`, Story 1.6) is the binding write primitive — `scan-sources` already uses it; no new writes are introduced.
- `architecture-validation-results.md` does NOT identify this gap explicitly (the gap surfaced in the wild during dogfood, after the architecture was validated against the strict fixture). The validation report's "Open questions" appendix MAY be amended in a follow-up to call out real-world-BMad-tolerance as an explicit Story 3.3 follow-on; not in scope for this story.

## Library / framework requirements

- **`zod`** — already a dep. Reused for the new `parseAdvisory` field's optional shape. No version bump.
- **No new runtime deps.** Regex widening, sort-comparator extension, and YAML field additions are all in-tree.
- **No new test deps.** vitest is the runner; existing tmpdir helpers handle fixture seeding.

## File-structure requirements

NEW files (do not exist today):

- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-messy-repo/` — new fixture directory mirroring the layout of `sample-target-repo` with the four deviation cases + the clean control + the non-story bookkeeping files (Task 4.1).
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/messy-repo.integration.test.ts` (Task 4.2).
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/parse-bmad-story.leniency.test.ts` (Task 4.3).
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/detect-custom-stories-root.test.ts` (Task 4.4).
- `plugins/crew/mcp-server/src/tools/__tests__/get-status.custom-stories-root.integration.test.ts` (Task 5.1).

UPDATE files (exist today; story modifies):

- `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts` — widen filename regex + H1 regex, default missing Status to `backlog`, downgrade unknown Status to `parseAdvisory` (Task 1).
- `plugins/crew/mcp-server/src/adapters/bmad/index.ts` — widen `BMAD_FILENAME_RE`, extend sort comparator, honour bound `currentContext.storiesRoot` in `detect()` (Task 2).
- `plugins/crew/mcp-server/src/adapters/adapter.ts` — add optional `parseAdvisory?: { kind: "unknown-status"; rawValue: string }` field to the `SourceStory` type (Task 1.7).
- `plugins/crew/mcp-server/src/tools/scan-sources.ts` — consume `parseAdvisory`, route to `blocked/`, emit verbatim warning, idempotent on re-scan (Task 3).
- `plugins/crew/docs/README-install.md` — adapter-configuration / leniency section (Task 6.1).
- `plugins/crew/docs/spikes/bmad-format.md` — optional "Real-world deviations" appendix (Task 6.2).
- `plugins/crew/mcp-server/dist/` — rebuild and commit per `CLAUDE.md` §Process notes (Task 7.2).

NO files to delete.

## Testing requirements

- vitest is the test runner (precedent: every existing `*.test.ts` in the MCP server tree).
- The four new test files (Task 4.2, 4.3, 4.4, 5.1) are deterministic — pure file-read + parser / adapter / tool calls. No LLM, no network. Each fixture is tmpdir-based or seeded under `adapters/bmad/fixtures/`.
- The idempotency assertion in Task 4.2 (f) uses `fs.stat().mtimeMs` (mirrors the existing `scan-sources` idempotency contract from Story 3.2 NFR10).
- The verbatim-warning-format assertion in Task 4.2 (c) uses a regex with the substituted relative path + raw value, anchored to start-of-line and end-of-line. The format string is the contract — the test is the pin.
- The regression pin in Task 7.3 — letter-suffix-less specs produce byte-identical manifests to pre-3.8 — is exercised by re-running the existing `sample-target-repo` fixture suite (Story 3.3) and asserting no output drift. No new test code required; the existing suite is the pin.
- The `sample-malformed-repo` fixture (Task 7.4) still throws `MalformedBmadStoryError` for its existing genuine-malformation cases (no H1, AC-section unparseable). The leniency widening MUST NOT mask these.

## Previous-story intelligence

- **Story 3.1** landed the `PlanningAdapter` interface and the registry. The optional `parseAdvisory` field on `SourceStory` is the only interface-adjacent change; it is additive and does not affect existing callers.
- **Story 3.2** landed `scan-sources`, the execution-manifest schema, and source-hash capture. This story extends `scan-sources` to consume `parseAdvisory` and route to `blocked/`; the underlying schema and write primitive are unchanged.
- **Story 3.3** landed the BMad adapter against a strict-BMad fixture. This story is the deliberate follow-on that brings the adapter from "works on the fixture" to "works on real-world BMad backlogs". The Story 3.3 spike (`plugins/crew/docs/spikes/bmad-format.md`) documents the canonical shape; this story adds the leniency annotation.
- **Story 3.3b** moved adapter-config binding into `resolveWorkspace`. The `detect()` honour-`currentContext.storiesRoot` fix in Task 2.5 leans directly on this — the bound context is the source of truth for the configured override.
- **Story 3.4** landed the native adapter, the planner subagent, and the `/crew:plan` skill. This story is BMad-adapter-only; native is untouched.
- **Story 3.5** landed `validatePlannerBacklog` and the discipline gate. The unknown-status routing in this story produces `blocked_by: "status-vocabulary-unknown"` alongside Story 3.5's `blocked_by: "planning-discipline"` — two independent string values on the same field.
- **Story 3.6** landed `/crew:plan` re-open mode, `markWithdrawn`, and `isClaimable`. This story does not interact with the discard flow; the `withdrawn` field is preserved through unknown-status routing.
- **Story 3.7** landed the planner's plain-language guideline and the `detectInProgressHandEdit` guard. This story does not interact with the in-progress guard; the leniency widening is for `to-do/` and `blocked/` only.
- **Story 1.7** landed `/crew:status` and the `StatusReport`. The custom-`stories_root` no-mismatch fix in Task 2.5 / Task 5.1 lights up the `adapter.state = "ok"` path for a previously-broken configuration.
- **Story 1.8** introduced the `user-surface` AC tag convention. This story tags AC1, AC3, and AC5 as `user-surface` (each names a slash command — `/crew:scan` for AC1 and AC3, `/crew:status` for AC5). AC2 (parser-internal default), AC4 (filename-filter substrate), AC6 (integration test) are not user-surface.
- **`bugfix-1` retro lesson:** silent breakage shipped under green ACs. The leniency widening here is the OPPOSITE failure mode — refusal-to-tolerate masquerading as discipline. The unknown-status warning-and-continue path is the cure: surface the deviation, do not swallow it, do not halt on it.
- **Pre-PR smoke gate (Story 1.8):** AC1, AC3, AC5 are `user-surface`, so the gate requires either `automated_e2e_verified` events from the Task 4 + Task 5 integration tests, OR `user_surface_verified` events with verbatim Claude Code output of `/crew:scan` + `/crew:status` against this repo's own backlog. The Task 4 and Task 5 integration tests deterministically cover AC1's letter-suffixed-ref-in-scan-output assertion, AC3's warning-string-and-blocked-manifest assertion, and AC5's `adapter: bmad (ok)` assertion — so the automated path is the recommended default; operator-paste is the fallback.

## Project-context reference

- **Authoritative PRD:** `_bmad-output/planning-artifacts/prd-crew-v1/` (sharded). Functional requirements cited: FR9 (execution-manifest projection via adapter), FR13 (typed errors on malformed inputs), NFR10 (idempotent re-scan).
- **Authoritative architecture:** `_bmad-output/planning-artifacts/architecture/planning-adapter-model.md` (§Two-layer model, §BMad adapter), `core-architectural-decisions.md` (atomic state-machine moves), `project-structure-boundaries.md` (BMad-fixture paths under `adapters/bmad/fixtures/`).
- **User-surface AC convention:** `plugins/crew/docs/user-surface-acs.md` (the gate-binding rubric and tag regex `^\*\*AC(\d+)\s*\(user-surface\)\s*:\*\*`).
- **BMad-format spike:** `plugins/crew/docs/spikes/bmad-format.md` (Story 3.3) — the canonical shape this story extends to tolerate real-world deviations.
- **Build-output rule:** project `CLAUDE.md` §Process notes — `plugins/crew/mcp-server/dist/` must be rebuilt and committed in the same change. CI fails on drift.
- **Communication style:** per project `CLAUDE.md` §How to talk to Jack — terse, PM-language, recommend defaults, no engineering-judgement asks at the spec-author layer.
- **Negative-capability anchor:** `sprint-status.yaml` and everything under `_bmad-output/implementation-artifacts/` is owned by the orchestrator. This story MUST NOT touch any of it, including the messy specs that motivated it.
- **Memory-pinned conventions:** dependency versions default to latest stable resolved by pnpm (no new deps in this story); no `cd` into subdirs; never amend or skip hooks; never commit to local main.

---

## Story completion status

Status: ready-for-dev

Notes for the dev agent:

- Six ACs total (AC1–AC5 from the epic + AC6 integration).
- ACs tagged `user-surface`: AC1, AC3, AC5 (each names a slash command — `/crew:scan` for AC1 and AC3, `/crew:status` for AC5, plus operator-openable `.crew/state/` paths per docs). AC2, AC4, AC6 are substrate.
- The Behavioural contract section is required for `user-surface` stories per the spec brief and IS present — see § Behavioural contract above. The parser widening (Task 1) is the load-bearing carrier for AC1 + AC2; the adapter widening + `detect()` honour-override (Task 2) is the load-bearing carrier for AC1 (filename filter) + AC5; the scan-sources warning-and-continue path (Task 3) is the load-bearing carrier for AC3.
- Do NOT modify `sprint-status.yaml` or any file under `_bmad-output/implementation-artifacts/` during implementation. The orchestrator owns status. The fixture lives under `adapters/bmad/fixtures/sample-messy-repo/` and is the only test surface.
- Two design defaults the dev agent should follow without asking:
  - When extending `SourceStory` with `parseAdvisory`, keep it optional and additive — do NOT introduce a new top-level field on the adapter interface. The field's presence is the routing signal; absence is the default path.
  - When emitting the unknown-status warning, prefer concatenating to the existing scan-output string over introducing a new structured-warnings array. The MCP tool's return shape is text; a single `\n`-delimited string with one line per warning matches the existing scan-output pattern and minimises consumer churn.
- The structural-anchor / content-structure requirement for user-surface stories is satisfied by AC3's verbatim warning-string assertion (Task 4.2 (c)) and AC5's verbatim `adapter: bmad (ok)` rendering assertion (Task 5.1). Both are deterministic; neither depends on LLM behaviour.
- No new MCP tool ships in this story. No new error type ships. No new schema field ships. The change surface is regex widening, comparator extension, scan-sources routing, `detect()` config honour, and one optional field on `SourceStory`.
- The `crew` repo's own backlog under `_bmad-output/implementation-artifacts/` is the motivating input but MUST NOT be modified by the dev agent. The fixture under `sample-messy-repo/` is the test substrate; the real backlog is the production target the merged change unblocks.
