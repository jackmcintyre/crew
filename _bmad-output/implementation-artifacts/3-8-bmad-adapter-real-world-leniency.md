# Story 3.8: BMad adapter leniency for real-world BMad backlogs

story_shape: substrate

Status: ready-for-dev

## Story

As a plugin operator pointing crew at an existing BMad backlog,
I want the BMad adapter to handle the deviations real BMad repos accumulate (letter-suffixed follow-up story IDs, missing or non-canonical `Status:` values, non-conforming filenames mixed into the stories directory),
So that `/crew:scan` succeeds against repos like this one without first requiring a mass rewrite of every existing spec.

### Context: why this story exists

Surfaced on 2026-05-25 during the first attempted dogfood of `/crew:start` against this repo's own backlog. The adapter's v1 reference implementation (Story 3.3) was written against a strict-BMad fixture (`fixtures/sample-target-repo`); this repo's `_bmad-output/implementation-artifacts/` accumulated organic deviations during Epics 1 and 2:

- ~10 stories with letter-suffixed IDs (`4-8b-...md`, `5-4b-...md`, `6-13-...md`). The current filename regex `^\d+-\d+-[a-z0-9-]+\.md$` rejects them outright, so they are silently dropped from the scan and invisible to crew.
- 41 of 45 specs have no `Status:` line at all (the spec-authoring routine emits Status conditionally; the BMad-create-story skill writes a leading `Status:` line on some templates but not others). The adapter today throws `MalformedBmadStoryError` on the first missing-Status file, halting the whole scan.
- A handful of files (`epic-1-retro-2026-05-20.md`, `sprint-status.yaml`) legitimately share the directory but are not story specs. They fail the filename regex and are silently skipped today — that part already works and must be preserved.
- One spec carries a free-text Status note (e.g. `Status: revised — re-implement per ...`). Today: parser throws on the first unknown value, scan halts.

The scan halted before any manifest landed in `.crew/state/to-do/`, so the dev loop had nothing to claim. This story makes the adapter accept reality so a non-engineer operator can point `/crew:scan` at an organic BMad backlog without first rewriting every spec.

## What this story does NOT do

- Does NOT change the canonical BMad spec shape documented in `plugins/crew/docs/spikes/bmad-format.md`. The H1 contract, `## Acceptance Criteria`, AC heading shape, and `Dependencies` parsing are unchanged. Only the parser's tolerance of authoring-time omissions and out-of-vocabulary values widens.
- Does NOT add a new adapter or change the `PlanningAdapter` interface (Story 3.1's contract). The adapter registry remains as-is.
- Does NOT change `resolveWorkspace` or the `adapter_config` precedence rules (Story 3.3b's contract).
- Does NOT migrate or rewrite any spec file in this repo. Migration is a separate operator task — the adapter just tolerates the current state.
- Does NOT add a "fix-up" or "lint" command for BMad backlogs.
- Does NOT enforce planning-discipline on the leniency-handled cases. A status-less or unknown-status story still flows through `validateAgainstDiscipline` afterwards in the normal path (Story 3.5). A spec that has no Status line but ALSO violates discipline (e.g. missing integration AC) still surfaces a discipline violation through the existing path.

## Deferred work

- A `/crew:plan migrate-bmad-backlog` action that rewrites organic specs to the strict shape. Not in scope; flagged for a future planning conversation if operators ask for it.
- Tightening `validateAgainstDiscipline` so it also flags `Status:`-less specs. Out of scope — discipline today operates on parsed `SourceStory` objects and does not see the raw on-disk state. If we want to enforce a Status line, add a discipline rule in a later story.
- A first-class `BmadStatusVocabularyUnknown` discipline violation reason. The current story emits a structured warning + blocks the story with `blocked_by: status-vocabulary-unknown`; lifting that into the discipline framework is a follow-up if and when discipline gains a `warn`-level surface.

## Acceptance Criteria

<!-- AC1: filename regex hardening — adapter internal, no user-visible surface. Not user-surface. -->
**AC1:**

**Given** a stories directory containing a spec file with a letter-suffixed story ID (e.g. `4-8b-bmad-create-story-…md`, `5-4b-…md`, `6-13-…md`),
**When** `BmadAdapter.listSourceStories()` runs,
**Then** the file is parsed successfully, the returned `SourceStory.ref` preserves the letter suffix (e.g. `bmad:4.8b`, NOT `bmad:4.8`), `raw_frontmatter.id` is `"4.8b"`, and any manifest written downstream by `scan-sources` keys off the suffixed ref so `.crew/state/to-do/bmad:4.8b.yaml` (or the canonical encoded form) lands without collision against `bmad:4.8`. _(closes the gap that hides ~10 follow-up stories from crew)_

<!-- AC2: default-status behaviour — adapter internal. Not user-surface. -->
**AC2:**

**Given** a spec file with NO `Status:` line between the H1 and the first `##` section heading,
**When** the adapter parses,
**Then** the parser does NOT throw, the resulting `SourceStory.raw_frontmatter.status` is `"backlog"` (the documented default), `mapBmadStatusToExecution("backlog")` returns `"to-do"`, and downstream `scan-sources` writes the manifest under `.crew/state/to-do/`. _(handles the 41 of 45 specs in this repo that have no Status field)_

<!-- AC3: unknown-status leniency — adapter internal; surfaces as scan output, but that surface is downstream and already in Story 3.2's contract. Not user-surface here. -->
**AC3:**

**Given** a spec file with a `Status:` value outside the canonical BMad vocabulary (e.g. `Status: review`, `Status: revised — re-implement per ...`),
**When** the adapter parses,
**Then** the parser does NOT throw, the returned `SourceStory` carries `raw_frontmatter.status_unknown: { raw: "<value>", reason: "status-vocabulary-unknown" }`, and the calling `scan-sources` path lands the story's manifest in `.crew/state/blocked/<ref>.yaml` with `blocked_by: "status-vocabulary-unknown"`. The scan emits a single structured warning per offending file naming the path and the unrecognised value, and the scan CONTINUES — it does NOT halt on the first bad file. _(robustness; today the scan halts on the first malformed file, hiding all downstream issues)_

<!-- AC4: silent skip of non-story filenames — preserves existing behaviour, just affirms it under the new fixture. Not user-surface. -->
**AC4:**

**Given** a file in the stories directory whose filename does NOT match the (newly widened) BMad story-spec pattern (e.g. `epic-1-retro-2026-05-20.md`, `sprint-status.yaml`, `index.md`),
**When** the adapter scans,
**Then** the file is silently skipped — no warning emitted, no error thrown, no manifest written. The story-spec ref-index built in `buildRefIndex` does not include the skipped file. _(retros and bookkeeping files legitimately live in the same directory)_

<!-- AC5: this AC drops a label from `/crew:status` output that an operator observes. Per user-surface-acs.md §(i) and §(iv), this is observable behaviour on a slash command — tagging user-surface. The change is a label suppression, not new behaviour. -->
**AC5 (user-surface):**

**Given** a target repo whose `.crew/config.yaml` declares `adapter: bmad` with an explicit `adapter_config.stories_root` that points at a directory containing BMad-shaped story files (e.g. `_bmad-output/implementation-artifacts`),
**And** `BmadAdapter.defaultConfig().stories_root` differs from that value (e.g. the default is `_bmad-output/planning-artifacts/stories`),
**When** the operator runs `/crew:status`,
**Then** the `adapter:` line reads `adapter: bmad (ok)`, NOT `adapter: bmad (mismatched)`. The configured `stories_root` is treated as authoritative per Story 3.3b — the adapter's `detect()` returns true against the configured root, `validateActiveAdapter` does not throw `StaleWorkspaceConfigError`, and the operator sees no misleading "mismatched" cue. _(cosmetic, but it confused the first-dogfood operator into thinking the setup was broken)_

<!-- AC6: integration test against fixture mirroring this repo's actual messy state. Adapter-internal, not user-surface. -->
**AC6 (integration):**

**Given** a vitest fixture directory at `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/` containing AT LEAST:
- one happy-path file (`3-1-canonical-story.md`, `Status: backlog`, valid H1, valid ACs);
- one letter-suffixed file (`4-8b-follow-up-story.md`, `Status: backlog`);
- one status-less file (`5-1-no-status.md`, no `Status:` line);
- one free-text-status file (`5-2-free-text-status.md`, `Status: revised — re-implement per 4.6 retro`);
- one retro-shaped file (`epic-1-retro-2026-05-20.md`, NOT a story);
- one bookkeeping file (`sprint-status.yaml`);

**When** the test calls `configureBmadAdapter` against that fixture and invokes `BmadAdapter.listSourceStories()` followed by the `scan-sources` flow (or its in-test equivalent that exercises the `to-do/`/`blocked/` write paths),
**Then** the test asserts:
1. `listSourceStories()` returns exactly 4 stories (`bmad:3.1`, `bmad:4.8b`, `bmad:5.1`, `bmad:5.2`) — neither the retro file nor the YAML appears;
2. Manifests for `bmad:3.1`, `bmad:4.8b`, and `bmad:5.1` land under `.crew/state/to-do/`;
3. The manifest for `bmad:5.2` lands under `.crew/state/blocked/` with `blocked_by: "status-vocabulary-unknown"`;
4. The scan output (or returned structured-warnings collection) contains exactly one warning naming `5-2-free-text-status.md` and the raw value `revised — re-implement per 4.6 retro`;
5. No error is thrown by the scan; the run completes end-to-end against the fixture.

The fixture lives under `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/` (parallel to `sample-target-repo` and `sample-malformed-repo`). The test sits next to `parse-bmad-story.ship-gate.test.ts` in `__tests__/`.

## Tasks / Subtasks

Author tasks in load-bearing order. The dev MUST complete the tasks top-to-bottom; later tasks depend on the seams the earlier tasks land.

- [ ] **Task 1: Widen the BMad filename regex to accept letter-suffixed story IDs (AC1).**
  - [ ] 1.1 In `plugins/crew/mcp-server/src/adapters/bmad/index.ts`, change `BMAD_FILENAME_RE` from `/^\d+-\d+-[a-z0-9-]+\.md$/` to `/^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/`. The third-character optional `[a-z]` after the second number captures the `b`, `c` suffix shape observed in this repo. (Pick the narrow letter class to keep collision risk low — full `[a-z0-9-]?` would swallow too much.)
  - [ ] 1.2 In `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts`, change the filename regex on line 17 from `/^(\d+)-(\d+)-([a-z0-9-]+)\.md$/` to `/^(\d+)-(\d+)([a-z]?)-([a-z0-9-]+)\.md$/`. Capture the optional suffix as group 3 (slug becomes group 4).
  - [ ] 1.3 In `parse-bmad-story.ts`, compute `storyFromName = filenameMatch[2]! + (filenameMatch[3] ?? "")` so a `4-8b-…md` file yields `storyFromName = "4.8b"` for the rest of the parser.
  - [ ] 1.4 Update the H1 numbering check (current line 42) so the H1 regex tolerates a letter suffix too: `/^#\s+Story\s+(\d+)\.(\d+[a-z]?)\s*:\s*(.+?)\s*$/`. The cross-check `epicFromH1 !== epicFromName || storyFromH1 !== storyFromName` still applies — both sides now carry the suffix.
  - [ ] 1.5 In `parse-bmad-story.ts`, update `raw_frontmatter.id` to be `${epicFromName}.${storyFromName}` (already correct shape, just confirm the suffix flows through).
  - [ ] 1.6 In `parse-bmad-story.ts`, set `ref: \`bmad:${epicFromName}.${storyFromName}\`` so a `4-8b-…md` file returns `ref: "bmad:4.8b"`.
  - [ ] 1.7 In `index.ts`, update `parseRef` (line 153) so the ref regex tolerates a letter suffix on the story number: `/^bmad:(\d+)\.(\d+[a-z]?)$/`. The parsed `story` field becomes a string, not a number (numeric parsing breaks here — propagate the string through `parseRef`'s return type and `buildRefIndex`).
  - [ ] 1.8 In `index.ts`, update `epicStoryFromFilename` (line 159) so it returns `{ epic: number; story: string }` capturing the suffix; the ref string built in `buildRefIndex` then preserves the suffix.
  - [ ] 1.9 In `index.ts`, update the `listSourceStories` sort (line 238 onwards): comparing `as` and `bs` as numbers no longer works because `"8b"` is non-numeric. Sort by `(epic, storyNumericPart, storySuffix)` — extract the numeric prefix and the suffix into two keys.
  - [ ] 1.10 Add a unit test in `__tests__/` covering: a `4-8b-foo.md` file parses with `ref: "bmad:4.8b"` and `raw_frontmatter.id: "4.8b"`; a `4-8-foo.md` file alongside it parses as `bmad:4.8` and does NOT collide. The two appear in `listSourceStories` output in the order `(4.8, 4.8b)`.

- [ ] **Task 2: Default `Status:` to `backlog` when the line is absent (AC2).**
  - [ ] 2.1 In `parse-bmad-story.ts`, change the missing-Status branch (current lines 79–84) from throwing `MalformedBmadStoryError` to setting `statusValue = "backlog"` and leaving a comment citing this story.
  - [ ] 2.2 Set `raw_frontmatter.status_defaulted: true` when the status was missing-and-defaulted, so downstream callers (Story 3.5 discipline, telemetry) can observe the case if they care. The field is absent when the spec carried an explicit Status.
  - [ ] 2.3 Add a unit test: a file with no `Status:` line parses successfully, `raw_frontmatter.status === "backlog"`, `raw_frontmatter.status_defaulted === true`.
  - [ ] 2.4 Add a unit test: a file WITH an explicit `Status: ready-for-dev` parses with `raw_frontmatter.status === "ready-for-dev"` and no `status_defaulted` field present — confirms we did not regress the happy path.

- [ ] **Task 3: Treat unknown `Status:` values as warnings, not errors (AC3).**
  - [ ] 3.1 In `parse-bmad-story.ts`, change the unknown-status branch (current lines 88–94) from throwing to: set `statusValue = "backlog"` for the purpose of execution mapping, AND attach `raw_frontmatter.status_unknown = { raw: <originalValue>, reason: "status-vocabulary-unknown" }`.
  - [ ] 3.2 The parser still returns a valid `SourceStory`. The decision to route the story to `blocked/` is made by the caller (`scan-sources`), not the parser, so this story stays consistent with Story 3.5's pattern (parser surfaces facts; scan-sources surfaces verdicts).
  - [ ] 3.3 In the `scan-sources` flow (Story 3.2's `scanSources` tool — locate via `plugins/crew/mcp-server/src/tools/scan-sources.ts` or equivalent), after the parsed `SourceStory` returns, check for `raw_frontmatter.status_unknown`. If present:
    - Write the manifest under `.crew/state/blocked/<ref>.yaml` (NOT `to-do/`).
    - Set `blocked_by: "status-vocabulary-unknown"` and include the raw value in the manifest's `blocked_detail` field (use whatever field name Story 3.5's blocked-manifest pattern established — read the file before deciding).
    - Append a structured warning to the scan output naming the file path and the raw value.
  - [ ] 3.4 The scan loop MUST continue iterating through remaining files after writing a blocked manifest — verify by reading `scan-sources.ts` and confirming the loop does not break/return on individual failures.
  - [ ] 3.5 Add a unit test on the parser: a file with `Status: review` parses, `raw_frontmatter.status_unknown.raw === "review"`, no throw.
  - [ ] 3.6 Add an integration test on `scan-sources`: a fixture with one unknown-status file produces a `.crew/state/blocked/bmad:5.2.yaml` manifest with `blocked_by: "status-vocabulary-unknown"` and a warning in the scan output.

- [ ] **Task 4: Confirm non-conforming filenames are silently skipped (AC4) and the new fixture exercises this.**
  - [ ] 4.1 The current `readStoriesDir` already skips non-matching filenames silently (see `index.ts` lines 102–119). Verify the widened regex from Task 1 does not accidentally start matching `epic-1-retro-2026-05-20.md` (it shouldn't — leading `epic-` doesn't match `\d+-\d+`).
  - [ ] 4.2 Verify that `sprint-status.yaml` is skipped (`.yaml` extension fails the regex).
  - [ ] 4.3 No code change expected in this task — it is a regression-protection assertion. The new fixture in Task 6 carries these files and the integration test asserts they don't appear in `listSourceStories` output.

- [ ] **Task 5: Drop the `(mismatched)` label when explicit `adapter_config.stories_root` is set (AC5).**
  - [ ] 5.1 The root cause: `BmadAdapter.detect()` (lines 198–216 of `index.ts`) hardcodes `DEFAULT_STORIES_ROOT` and ignores the configured `stories_root`. When the operator configures a non-default root, `validateActiveAdapter` calls `detect(targetRepo)` which returns false against the default path → `StaleWorkspaceConfigError` → `/crew:status` projects `state: "mismatched"`.
  - [ ] 5.2 Fix path A (preferred — minimal, no interface change): teach `BmadAdapter.detect()` to consult `currentContext?.storiesRoot` if it has been configured for this `targetRepo`; otherwise fall back to `DEFAULT_STORIES_ROOT`. Note `currentContext.targetRepo` is `path.resolve(ctx.targetRepo)`, so compare resolved paths.
    - In `index.ts`, inside `detect(targetRepo)`, before opening `DEFAULT_STORIES_ROOT`, check: if `currentContext` exists and `path.resolve(currentContext.targetRepo) === path.resolve(targetRepo)`, use `absStoriesRoot(currentContext)` as the root to check. Otherwise use the default.
    - This preserves the stateless-detect contract for first-run auto-detect (no context yet → default root) AND lets the second pass through `validateActiveAdapter` (after `configureBmadAdapter` has run inside `resolveWorkspace`) see the configured root.
  - [ ] 5.3 Confirm ordering in `resolveWorkspace`: line 182 of `workspace-resolver.ts` calls `configureBmadAdapter` AFTER schema validation but BEFORE the workspace is returned. `validateActiveAdapter` is called AFTER `resolveWorkspace` returns in `getStatus`, so by the time `validateActiveAdapter` calls `detect`, `currentContext` is set. Verify this ordering before changing detect — if it is wrong, the fix above is a no-op.
  - [ ] 5.4 Add a unit test on `BmadAdapter.detect()`: with `currentContext` configured at a custom `storiesRoot` that contains BMad-shaped files, `detect(targetRepo)` returns `true` even though `DEFAULT_STORIES_ROOT` is empty.
  - [ ] 5.5 Add a unit test on `getStatus` (or `renderStatus`): a workspace whose configured `stories_root` is `_bmad-output/implementation-artifacts` and contains story files yields `adapter.state === "ok"`, NOT `"mismatched"`. The rendered line is `adapter: bmad (ok)`.
  - [ ] 5.6 Negative test: a workspace whose configured `stories_root` points at an EMPTY directory still surfaces `mismatched` — the suppression is conditional on the configured root actually matching, not unconditional. This protects against operator misconfiguration silently passing.

- [ ] **Task 6: Build the real-world fixture and the end-to-end integration test (AC6).**
  - [ ] 6.1 Create `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/` with the six files listed in AC6. Each story file must carry a valid H1 (`# Story N.M: <title>`), `## Acceptance Criteria` with at least one `**ACN (integration):**` block, and a `## Dev Notes` section — i.e. they must pass planning-discipline (Story 3.5) so the test is about leniency, not discipline interaction.
  - [ ] 6.2 The retro file `epic-1-retro-2026-05-20.md` should be 5–10 lines of realistic-looking retro prose — its job is to be a non-story Markdown file in the same directory.
  - [ ] 6.3 The `sprint-status.yaml` file should be 3–5 lines of realistic YAML — it must not be a valid execution manifest; we just need a non-`.md` non-story file in the directory.
  - [ ] 6.4 Add `bmad-adapter-real-world-leniency.integration.test.ts` in `__tests__/`. It configures the adapter against the new fixture, invokes the scan-sources path, and asserts the five sub-assertions in AC6.
  - [ ] 6.5 The integration test MUST run against a freshly-created tmpdir for `.crew/state/` writes (see how `claim-complete-loop.integration.test.ts` builds its sandbox — copy that pattern). Do NOT pollute the fixture directory with state writes.

- [ ] **Task 7: Documentation updates.**
  - [ ] 7.1 Update `plugins/crew/docs/spikes/bmad-format.md`: add a `## Leniency rules (Story 3.8)` section documenting (a) letter-suffixed story IDs are accepted; (b) missing `Status:` defaults to `backlog`; (c) unknown `Status:` values produce a `blocked` manifest with `blocked_by: status-vocabulary-unknown` and a scan warning, NOT a hard parser error; (d) non-conforming filenames in the stories directory are silently skipped.
  - [ ] 7.2 Add a one-paragraph cross-reference in the leniency section pointing back to this story file.
  - [ ] 7.3 No README update required — this story does not change the operator-visible surface beyond AC5's label suppression.

- [ ] **Task 8: Build and commit `dist/`.**
  - [ ] 8.1 Run `pnpm --filter ./plugins/crew/mcp-server build` from the worktree root.
  - [ ] 8.2 Stage the regenerated `plugins/crew/mcp-server/dist/` tree in the same commit as the `src/` changes. CI fails on drift (see `CLAUDE.md` § Plugin build output).

## Dev Notes

### Files to MODIFY

- `plugins/crew/mcp-server/src/adapters/bmad/index.ts`
  - Lines 87 (`BMAD_FILENAME_RE`), 153 (`parseRef`), 159 (`epicStoryFromFilename`), 198–216 (`detect`), 238–245 (sort).
  - This is the main adapter entry point. Read it fully before changing — multiple seams interlock.
- `plugins/crew/mcp-server/src/adapters/bmad/parse-bmad-story.ts`
  - Lines 17 (filename regex), 42 (H1 regex), 53 (numbering cross-check), 79–84 (missing-Status branch), 88–94 (unknown-status branch).
  - Pure parser, no I/O. Easy to unit-test in isolation.
- `plugins/crew/mcp-server/src/tools/scan-sources.ts` (or wherever the scan loop iterates parsed stories and writes manifests — locate via `grep -rn "blocked_by\|to-do\|in-progress" plugins/crew/mcp-server/src/tools/scan-sources*`).
  - Add the `status_unknown` branch that writes to `blocked/` instead of `to-do/`.
- `plugins/crew/docs/spikes/bmad-format.md`
  - Add the leniency-rules section.
- `plugins/crew/mcp-server/dist/` — regenerated by `pnpm build`.

### Files to CREATE

- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/3-1-canonical-story.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/4-8b-follow-up-story.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/5-1-no-status.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/5-2-free-text-status.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/epic-1-retro-2026-05-20.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/sprint-status.yaml`
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/bmad-adapter-real-world-leniency.integration.test.ts`
- Optional small unit-test files alongside `parse-bmad-story.ship-gate.test.ts` for the regex/default-status/unknown-status branches (the dev may collapse these into the integration file if that reads better; preserve test coverage either way).

### Locked files (DO NOT MODIFY)

- `plugins/crew/mcp-server/src/state/workspace-resolver.ts` — Story 3.3b's contract. The configure-on-resolve seam (line 182) is load-bearing; do not touch.
- `plugins/crew/mcp-server/src/adapters/registry.ts` — Story 3.1's contract. This story does not add a new adapter, just hardens BMad.
- `plugins/crew/mcp-server/src/adapters/adapter.ts` — `PlanningAdapter` interface. Do not widen the interface; the AC5 fix is internal to `BmadAdapter`.
- `plugins/crew/mcp-server/src/errors.ts` — no new error class needed (the unknown-status case becomes a structured warning + manifest field, not an error). If you find yourself needing a new typed error, stop and re-read AC3.

### Typed-error pattern

This story DELIBERATELY does NOT add a new `MalformedBmadStoryError` subclass for the unknown-status case. The pattern is:

- The PARSER returns a valid `SourceStory` with `raw_frontmatter.status_unknown: { raw, reason }`.
- The SCAN-LOOP inspects this field and writes a blocked manifest plus a structured warning.

This mirrors Story 3.5's pattern: parsers surface facts as `SourceStory` fields; the calling tool decides routing. If you find yourself wanting to throw an error inside `parse-bmad-story.ts` for the unknown-status case, re-read this section.

### Letter-suffix design — why `[a-z]?` and not `[a-z0-9]*`

The observed shape is `4-8b`, `5-4b`, `6-13` — only a single lowercase letter ever follows the second number, and it only ever follows (not replaces) a digit. `[a-z]?` matches that and nothing else. Wider patterns risk colliding with the `[a-z0-9-]+` slug class.

If a future story observes a different suffix shape (`4-8bb`, `5-4-rev`, …), widen then. For now: narrow.

### `detect()` semantics after AC5

Before this story, `BmadAdapter.detect(targetRepo)` is purely stateless — it asks "does `<targetRepo>/_bmad-output/planning-artifacts/stories/` contain BMad-shaped files?".

After this story, `detect()` adopts a two-step contract:

1. If `currentContext` is set AND `currentContext.targetRepo === path.resolve(targetRepo)`, check the configured `storiesRoot`.
2. Otherwise (first-run auto-detect), check `DEFAULT_STORIES_ROOT`.

This preserves first-run behaviour exactly (no context yet → default) and lets the post-resolve `validateActiveAdapter` call see the configured root. The `detect()` JSDoc on `index.ts` must be updated to reflect this.

### How `scan-sources` writes blocked manifests

Story 3.5 introduced the `blocked/` write path for planning-discipline violations. Read its implementation (`scan-sources.ts` plus the helper Story 3.5 uses to compose blocked manifests) and reuse the exact same write seam for the status-vocabulary-unknown case. Do NOT invent a parallel pathway.

Specifically: the blocked-manifest schema must include `blocked_by` and `blocked_detail` fields (or whatever Story 3.5 named them — read the schema, do not guess). The structured warning emitted to scan output should follow the same shape Story 3.5 emits for discipline violations.

### Plain-language guideline cross-reference

Per Story 3.7's plain-language guideline, the scan warning message for AC3 should be readable by a non-engineer. Suggested text:

> Story `<ref>` at `<path>` has a Status value (`<raw>`) that is not one of the known BMad statuses (backlog, ready-for-dev, in-progress, done, optional, contexted). The story has been blocked with reason `status-vocabulary-unknown` so the scan can continue. Edit the spec's Status line or remove it (Status defaults to `backlog`) and re-run `/crew:scan`.

The dev is free to refine the wording but must keep the plain-language register.

## Previous story intelligence

This story depends on the seams established by several earlier stories. Read these spec files for context before starting:

- **Story 3.1** (`_bmad-output/implementation-artifacts/3-1-planningadapter-interface-and-adapter-registry.md`) — `PlanningAdapter` interface contract. Story 3.8 does NOT widen this interface; understand why before designing the AC5 fix.
- **Story 3.2** (`_bmad-output/implementation-artifacts/3-2-execution-manifest-schema-scan-sources-mcp-tool-and-source-hash-capture.md`) — `scan-sources` MCP tool, manifest schema, and `to-do/` write seam. AC3's blocked-manifest write reuses this seam.
- **Story 3.3** (`_bmad-output/implementation-artifacts/3-3-bmad-adapter-v1-reference-implementation.md`) — the strict BMad adapter Story 3.8 is now relaxing. Pay attention to the original filename-regex and Status-vocabulary design intents to make sure the leniency does not invalidate the design.
- **Story 3.3b** (`_bmad-output/implementation-artifacts/3-3b-adapter-config-seam-move-configurebmadadapter-into-resolveworkspace.md`) — the `configureBmadAdapter`-inside-`resolveWorkspace` seam. AC5's fix relies on this seam having already run before `validateActiveAdapter` is called.
- **Story 3.5** (`_bmad-output/implementation-artifacts/3-5-planning-discipline-validation-at-authoring-and-scan-time.md`) — the `blocked/` manifest pattern and structured-warning shape. AC3 mirrors this pattern.
- **Story 3.7** (`_bmad-output/implementation-artifacts/3-7-plain-language-guideline-and-direct-edit-allowance.md`) — plain-language guideline applied to all operator-facing messages.

### Dogfood failure on 2026-05-25

The triggering incident: Jack attempted `/crew:start` against this repo's own backlog. `/crew:scan` reached the first letter-suffixed file (`4-8b-...md`), the filename regex rejected it, the file was silently skipped. The scan then hit the first status-less file and threw `MalformedBmadStoryError`. The full scan halted; zero manifests landed in `to-do/`. The dev loop spun on an empty queue and exited.

The operator saw `adapter: bmad (mismatched)` on `/crew:status` (because the worktree's `.crew/config.yaml` points `stories_root` at `_bmad-output/implementation-artifacts`, which differs from the default), and interpreted that label as "the plugin is broken" — which it wasn't, structurally. The mismatched label was the first wrong cue, and the missing-Status throw was the actual blocker.

Story 3.8 closes the four defects: letter-suffix tolerance, default-Status, unknown-status leniency, and the misleading mismatched label. AC4 affirms the existing silent-skip behaviour stays correct under the new fixture.

## Testing standards

- **Framework:** vitest. Place unit tests alongside source files using the `.test.ts` suffix; place integration tests under `__tests__/` using `.integration.test.ts`.
- **Isolation:** every test that writes to `.crew/state/` must use a fresh `os.tmpdir()` directory and clean up afterwards. Do NOT write into the fixture directory. See `claim-complete-loop.integration.test.ts` for the established sandbox pattern.
- **Coverage targets:**
  - Parser unit tests: every new branch (letter-suffix, missing-Status, unknown-Status) covered with at least one happy-path and one regression-protection test.
  - Adapter integration test: AC6's five sub-assertions all asserted explicitly.
  - `getStatus` test: AC5's positive case (configured root + present files → ok) AND the negative case (configured root + empty directory → mismatched) both covered.
- **Snapshot tests:** do NOT use snapshot tests for these — the assertions are small enough to be explicit.
- **`pnpm test` must pass** at the end. The story's pre-PR gate runs this.

## Project context reference

- `CLAUDE.md` at the worktree root governs how Jack expects to be talked to — terse, PM framing.
- Plugin build output policy: `plugins/crew/mcp-server/dist/` is committed; rebuild and commit `dist/` in the same change. CI fails on drift.
- Planning discipline (the five rules): inherited from `_bmad-output/_archive/planning-discipline.md`. Every AC in this spec has been written to satisfy them.
