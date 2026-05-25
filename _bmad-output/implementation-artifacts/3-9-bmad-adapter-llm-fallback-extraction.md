# Story 3.9: BMad adapter LLM fallback extraction

story_shape: substrate

Status: ready-for-dev

## Story

As a plugin operator pointing crew at an organic BMad backlog,
I want `/crew:scan` to fall back to an LLM extractor when the deterministic regex parser cannot parse a drifted story,
So that one drifted story does not halt the scan, no manifest is silently dropped, and I am not asked to fix every drifted spec by hand before crew can ingest the backlog.

### Context: why this story exists

Surfaced on 2026-05-25 during the second dogfood pass after Story 3.8 landed. Story 1-1's AC heading drifted to `**AC1 — title:**` (vs the regex's expected `**ACn:**`), which the regex parser rejects with `MalformedBmadStoryError`. Story 3.8 added per-format leniency rules but not a per-file isolation seam, so a single drifted file outside the documented leniency envelope still halts the scan.

The strategic call (see `/Users/jackmcintyre/.claude/plans/i-feel-like-we-ve-witty-nygaard.md`) is that strict regex parsing of operator prose is structurally brittle for a BMad-first v1 — every drift becomes another patch, and the rate of drift grows with the operator population. The right shape is **deterministic-first, LLM fallback**: regex tells us when our format assumption holds (most of the time); the LLM extractor is the safety net for when it doesn't.

This story is **strictly a superset** of "per-file isolation only" (the simpler Option B in the strategic plan). If we ever disable the LLM fallback, the isolation seam still prevents one bad file from killing the scan.

## What this story does NOT do

- Does **not** change the canonical BMad spec shape. The regex parser and Story 3.8 leniency rules still run first.
- Does **not** change the `PlanningAdapter` interface. The fallback is a BMad-internal concern; other adapters keep their narrow contract.
- Does **not** add a one-shot `/crew:import-bmad` migration command. Stays out of scope (it was Option D in the strategic plan, rejected).
- Does **not** make any live Anthropic call in CI. All tests mock the SDK.
- Does **not** cap the fallback at a hard token budget. The token-budget warning is informational only.
- Does **not** disable the existing `optional` skip in the parser (Story 3.8 contract).

## Deferred work

- A `pnpm crew:lint` (or `/crew:plan migrate-bmad-backlog`) that rewrites drifted stories back to the canonical shape. Out of scope; flagged for a future planning conversation if operators ask.
- Promoting `extracted_by_llm` into the execution-manifest schema as a first-class field. Today the provenance lives in `raw_frontmatter.extracted_by_llm: true` (parser-side); a manifest-side surface is a follow-up if downstream tools need it.
- A first-class budget cap (`max_extractions_per_scan`) configurable via `.crew/config.yaml`. Today only the warning is emitted; a hard cap is a follow-up.

## Acceptance Criteria

<!-- AC1: per-file isolation seam in scan-sources. Adapter-internal, observed via blocked manifest + scan output. Not user-surface. -->
**AC1:**

**Given** a stories directory containing one file whose Markdown shape is outside the regex parser's envelope (e.g. random prose with no H1) AND the `ANTHROPIC_API_KEY` environment variable is unset (so the LLM fallback also fails),
**When** `/crew:scan` runs,
**Then** the offending file is routed to `.crew/state/blocked/<ref>.yaml` with `blocked_by: "unparseable"`. The manifest carries the regex error message and (when applicable) the LLM error message in `discipline_violations[]`. The scan does NOT throw — it completes end-to-end. Other stories in the directory are processed normally.

<!-- AC2: LLM fallback recovers a drifted story. Adapter-internal. Not user-surface. -->
**AC2:**

**Given** a stories directory containing a drifted story (e.g. AC headings shaped as `**AC1 — title:**`) AND a mocked Anthropic client that returns a valid `SourceStory` JSON,
**When** `/crew:scan` runs,
**Then** the regex parser fails for that file, the LLM fallback is invoked exactly once, the recovered `SourceStory` is validated against the extracted-story schema, and a manifest lands under `.crew/state/to-do/<ref>.yaml` like any other story. The ref appears in `ScanResult.extractedByLlmRefs` and `ScanResult.createdRefs`. The recovered story's `raw_frontmatter.extracted_by_llm` is `true`.

<!-- AC3: cache survives across scans. Adapter-internal but the operator-visible effect is "second scan is fast". Not user-surface. -->
**AC3:**

**Given** a story whose LLM-fallback extraction succeeded on a previous scan,
**When** `/crew:scan` runs again with the source file unchanged,
**Then** the LLM is NOT called for that file — the extractor reads the cached `SourceStory` from `.crew/state/extraction-cache/<source_hash>.json` and returns it. If the file's bytes change between scans, the cache key (sha256) changes and the LLM is called again.

<!-- AC4: skip-done at directory walk. Adapter-internal performance/noise filter. Not user-surface. -->
**AC4:**

**Given** a stories directory containing a file whose `Status:` line is `done` or `optional`,
**When** `BmadAdapter.listSourceStories()` (or `listSourceStoriesResilient()`) runs,
**Then** the file is skipped at the directory walk via a cheap status pre-read — `parseBmadStory` is NOT invoked, the LLM fallback is NOT invoked, and the file does not appear in the returned stories array. Belt-and-braces: if `_bmad-output/implementation-artifacts/sprint-status.yaml` exists and lists a story's `<epic>-<story>` key as `done` in `development_status:`, that file is also skipped at the walk.

<!-- AC5: render-side surface. Operator sees these lines in /crew:scan output. Tagging user-surface per user-surface-acs.md §(i). -->
**AC5 (user-surface):**

**Given** a scan that fired the LLM fallback on one or more refs and routed one or more refs to `blocked/` with `blocked_by: "unparseable"`,
**When** the operator runs `/crew:scan`,
**Then** the rendered scan output includes the lines `extracted-by-llm: N ref(s) — <refs> (regex parser failed; LLM fallback recovered the story)` AND `unparseable: M ref(s) — <refs> (both regex parser AND LLM fallback failed — fix the source story and re-run /crew:scan)`. Both lines are present in `renderScanResult()` output and the corresponding fields exist on `ScanResult` (`extractedByLlmRefs`, `unparseableRefs`).

<!-- AC6: integration test against fixture mirroring the three paths. Adapter-internal, not user-surface. -->
**AC6 (integration):**

**Given** a vitest fixture directory at `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/` containing AT LEAST:
- one clean story (`3-1-clean-story.md`, parses via regex);
- one drifted story (`3-2-drifted-em-dash-acs.md`, regex fails, LLM mock returns valid JSON);
- one genuinely broken file (`3-3-genuinely-broken.md`, regex fails AND LLM mock returns non-JSON);

**When** the integration test mocks the Anthropic client seam via `vi.mock` and runs `scanSources` against the fixture,
**Then** the test asserts:
1. The clean story is in `to-do/`; its filename does NOT appear in any LLM mock call.
2. The drifted story is in `to-do/` AND in `ScanResult.extractedByLlmRefs`; the LLM mock was called exactly once for that file.
3. The broken file is in `blocked/` with `blocked_by: "unparseable"` AND in `ScanResult.unparseableRefs`; the rendered scan output names it on an `unparseable:` line.
4. Re-running the scan with no changes does NOT call the LLM mock again for the (successfully-cached) drifted story.
5. A unit-test fixture file with `Status: done` is NOT parsed and NOT extracted — it is filtered at the directory walk.

## Tasks / Subtasks

Author tasks in load-bearing order. The dev MUST complete the tasks top-to-bottom; later tasks depend on the seams the earlier tasks land.

- [x] **Task 1: Per-file isolation seam + new typed error class.**
  - [x] 1.1 Add `BmadLlmExtractionError` to `plugins/crew/mcp-server/src/errors.ts` alongside `MalformedBmadStoryError`. Carries `path`, `reason`, optional `underlying`. Mirror the existing `DomainError` shape.
  - [x] 1.2 Refactor `plugins/crew/mcp-server/src/adapters/bmad/index.ts` to expose `listSourceStoriesResilient()` returning `{ stories, extractedByLlm, unparseable, skippedDone }`. The canonical `listSourceStories()` calls it and returns only `stories` for interface conformance.
  - [x] 1.3 The resilient helper wraps each `parseBmadStory` call in `try/catch`. On `MalformedBmadStoryError`, attempt the LLM fallback (Task 2). On extraction failure, append an entry to `unparseable` with `{ path, refGuess, regexError, llmError }`.
  - [x] 1.4 In `plugins/crew/mcp-server/src/tools/scan-sources.ts`, replace `await activeAdapter.listSourceStories()` (for the BMad adapter only) with `await listSourceStoriesResilient()`. Other adapters keep the narrow path.
  - [x] 1.5 In `scan-sources.ts`, iterate over `resilient.unparseable` BEFORE the main loop and compose a blocked manifest per entry: `blocked_by: "unparseable"`, synthetic `acceptance_criteria` (schema requires `min(1)`), `discipline_violations` carrying both error messages. Use `writeManagedFile` with the `scanSources` MCP tool context. Append each ref to `result.blockedRefs` AND `result.unparseableRefs` AND `result.warnings`.

- [x] **Task 2: LLM-extraction module + Anthropic client seam.**
  - [x] 2.1 Add `@anthropic-ai/sdk` to `plugins/crew/mcp-server/package.json` dependencies. Resolve and pin via `pnpm install`.
  - [x] 2.2 Create `plugins/crew/mcp-server/src/lib/anthropic-client.ts` exposing `getAnthropicClient(): AnthropicClient`, `hasAnthropicKey(): boolean`, and a thin `createMessage({ model, system, userText, maxTokens, temperature })` wrapper. This is the ONLY place in `mcp-server/src/**` that imports the Anthropic SDK directly. Future LLM-using adapters reuse this wrapper.
  - [x] 2.3 Create `plugins/crew/mcp-server/src/adapters/bmad/extract-bmad-story-llm.ts` exposing `extractBmadStoryViaLlm(absPath, fileContents, { targetRepoRoot, client?, primaryModel?, retryModel? })`. Builds a deterministic prompt (temperature 0, structured-output schema described in the system prompt), validates the model's JSON response through a Zod schema mirroring `SourceStory`, throws `BmadLlmExtractionError` on JSON-parse failure, schema-validation failure, or model error.
  - [x] 2.4 Model defaults: `HAIKU_MODEL = "claude-haiku-4-5-20251001"` (primary), `SONNET_MODEL = "claude-sonnet-4-6"` (single retry on Haiku failure). Exported constants for test overrides.
  - [x] 2.5 Cache the recovered `SourceStory` by `source_hash` (sha256 of file bytes) under `.crew/state/extraction-cache/<hash>.json`. Use `writeManagedFile` with `mcpToolContext: { toolName: "extractBmadStoryLlm", role: "operator" }`. A cache hit short-circuits the model call.
  - [x] 2.6 Mark the recovered story's `raw_frontmatter.extracted_by_llm = true` for downstream provenance.

- [x] **Task 3: `ScanResult` + `renderScanResult` updates.**
  - [x] 3.1 Add `extractedByLlmRefs: string[]` and `unparseableRefs: string[]` to the `ScanResult` interface in `scan-sources.ts`.
  - [x] 3.2 In `renderScanResult`, add an `extracted-by-llm: N ref(s) — <refs>` line when the fallback fired AND an `unparseable: N ref(s) — <refs>` line when both paths failed (AC5).
  - [x] 3.3 Populate both fields from `resilient.extractedByLlm` and from the synthesised blocked manifests for unparseable entries.

- [x] **Task 4: Skip done/optional stories at directory walk (bundled).**
  - [x] 4.1 In `BmadAdapter`'s directory walker, add `shouldSkipDoneAtWalk(absFile)` that reads only the first ~4 KB of the file, looks for `Status:`, and returns `true` if the value is `done` or `optional`. Stops scanning after the first `## ` heading. Defensive — IO errors return `false` so the regular parser path still runs.
  - [x] 4.2 Belt-and-braces: also consult `<targetRepo>/_bmad-output/implementation-artifacts/sprint-status.yaml`. If `development_status:` lists a story's `<epic>-<story>` key as `done`, skip the file regardless of its in-file `Status:`. Pre-load this set once per `listSourceStoriesResilient()` call.
  - [x] 4.3 Update the existing `tests/bmad-adapter.test.ts` expectations to reflect that `bmad:2.3` (Status: done in the fixture) is now filtered at the walk (5 stories instead of 6).
  - [x] 4.4 The post-parse `optional` filter in the parser/adapter STAYS as a fallback — defence in depth.

- [x] **Task 5: Token-budget warning.**
  - [x] 5.1 In `scan-sources.ts`, after building the resilient result, if `resilient.extractedByLlm.length > 10`, emit a `console.warn` AND append a warning to `result.warnings`. No hard abort.

- [x] **Task 6: Integration test + fixtures.**
  - [x] 6.1 Create `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/` with three files: `3-1-clean-story.md` (canonical shape), `3-2-drifted-em-dash-acs.md` (drifted AC headings), `3-3-genuinely-broken.md` (no story shape).
  - [x] 6.2 Create `plugins/crew/mcp-server/src/adapters/bmad/__tests__/bmad-adapter-llm-fallback.integration.test.ts`. Mock the Anthropic client seam via `vi.mock` against `../../../lib/anthropic-client.js`. The mock returns valid JSON for the drifted file's content and non-JSON for the broken file's content.
  - [x] 6.3 Assert all six sub-assertions in AC6 explicitly. Use `atomicWriteFile` (never raw `fs.writeFile`) for any test-time writes inside `src/**` — the static fs-write guard forbids the latter.

- [x] **Task 7: Documentation updates.**
  - [x] 7.1 Update `plugins/crew/docs/spikes/bmad-format.md` with a new section describing the two-stage parse (regex first, LLM fallback) and the `blocked_by: "unparseable"` failure mode. Reference this story.
  - [x] 7.2 Update `plugins/crew/docs/README-install.md` with a note on the per-scan token cost for drifted stories, the cache, and the `ANTHROPIC_API_KEY` requirement.

- [x] **Task 8: Build + commit `dist/`.**
  - [x] 8.1 Run `pnpm install && pnpm build` from `plugins/crew/`. Stage the regenerated `plugins/crew/mcp-server/dist/` tree in the same commit as the `src/` changes. CI fails on drift (see `CLAUDE.md` § Plugin build output).
  - [x] 8.2 Run `pnpm test` and confirm all tests pass before opening the PR.

## Dev Notes

### Files to MODIFY

- `plugins/crew/mcp-server/src/errors.ts` — append `BmadLlmExtractionError`.
- `plugins/crew/mcp-server/src/adapters/bmad/index.ts` — add the skip-done helpers, `listSourceStoriesResilient`, wire `listSourceStories` through it.
- `plugins/crew/mcp-server/src/tools/scan-sources.ts` — call the resilient helper for BMad, route unparseable entries to `blocked/`, populate the new fields, render the new lines, emit the budget warning.
- `plugins/crew/mcp-server/package.json` — add `@anthropic-ai/sdk` dependency.
- `plugins/crew/mcp-server/tests/bmad-adapter.test.ts` — update two expectations for the skip-done filter (bmad:2.3 no longer surfaces).
- `plugins/crew/docs/spikes/bmad-format.md` — add the two-stage parse section.
- `plugins/crew/docs/README-install.md` — add the per-scan token cost section.
- `plugins/crew/mcp-server/dist/` — regenerated by `pnpm build`.

### Files to CREATE

- `plugins/crew/mcp-server/src/lib/anthropic-client.ts` — the SDK seam.
- `plugins/crew/mcp-server/src/adapters/bmad/extract-bmad-story-llm.ts` — the extractor.
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-1-clean-story.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-2-drifted-em-dash-acs.md`
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-3-genuinely-broken.md`
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/bmad-adapter-llm-fallback.integration.test.ts`

### Locked files (DO NOT MODIFY)

- `plugins/crew/mcp-server/src/adapters/adapter.ts` — the `PlanningAdapter` interface stays narrow. The fallback is BMad-internal.
- `plugins/crew/mcp-server/src/state/workspace-resolver.ts` — Story 3.3b's contract.
- `plugins/crew/mcp-server/src/lib/managed-fs.ts` — only the canonical-fs writer should land new write paths.

### Why `BmadLlmExtractionError` is a new class

Existing `MalformedBmadStoryError` carries the regex parser's failure mode. The LLM fallback can fail for orthogonal reasons (API key missing, model unreachable, JSON malformed, schema invalid) and the scan-sources blocked-routing path inspects the underlying error to compose a useful manifest. A typed class keeps the error-handling shape explicit; widening `MalformedBmadStoryError` would conflate the two paths.

### Deterministic-first principle

The codebase memory `feedback_default_to_deterministic_seams.md` says: load-bearing decisions live in tool-written artefacts, not LLM prose. This story honours that — the regex parser is the deterministic seam and stays the primary path. The LLM fallback is the safety net, exercised only when the deterministic path throws. The cache key is the file's sha256 (deterministic). Schema validation is deterministic. The only non-deterministic element is the model call itself, which is gated behind a typed error and bounded by a single retry.

### Cache invalidation semantics

The cache key is `sha256(fileContents)`. Any byte change to the source file invalidates the cache. This is correct: if the operator edits a drifted story to fix it, the regex parser handles the next scan and the cache never matters; if the operator edits the file in ways that *don't* fix it, the new bytes hash differently and the LLM is called again. We never serve a stale extraction.

### Mocking the Anthropic SDK in tests

Tests mock the wrapper module (`../../../lib/anthropic-client.js`) via `vi.mock`, not the SDK itself. This keeps the mock surface small (one `createMessage` method) and lets us swap returned content based on the file payload. No `process.env.ANTHROPIC_API_KEY` is required in CI.

## Previous story intelligence

Read for context before starting:

- **Story 3.3** (`_bmad-output/implementation-artifacts/3-3-bmad-adapter-v1-reference-implementation.md`) — the BMad adapter's v1 contract and the strict-parse design intent.
- **Story 3.5** (`_bmad-output/implementation-artifacts/3-5-planning-discipline-validation-at-authoring-and-scan-time.md`) — the `blocked/` manifest pattern (`blocked_by`, `discipline_violations`) that Story 3.9 reuses.
- **Story 3.8** (`_bmad-output/implementation-artifacts/3-8-bmad-adapter-real-world-leniency.md`) — the format-specific leniency rules (letter suffix, missing Status, unknown Status). Story 3.9 sits on top of those, not in place of them.

Strategic plan: `/Users/jackmcintyre/.claude/plans/i-feel-like-we-ve-witty-nygaard.md`.

## Testing standards

- **Framework:** vitest. Integration tests under `src/adapters/bmad/__tests__/*.integration.test.ts`.
- **Isolation:** every test that writes to `.crew/state/` uses a fresh `os.tmpdir()` directory and cleans up. NEVER write to the fixture directory.
- **No live model calls in CI.** Mock the Anthropic client seam via `vi.mock`. No `process.env.ANTHROPIC_API_KEY` required.
- **Static fs-write guard:** the integration test uses `atomicWriteFile` for any test-time writes inside `src/**`. Raw `fs.writeFile` is banned by `tests/canonical-fs-guard.test.ts`.
- **`pnpm test` must pass** at the end.

## Project context reference

- `CLAUDE.md` at the worktree root governs how Jack expects to be talked to — terse, PM framing.
- Plugin build output policy: `plugins/crew/mcp-server/dist/` is committed; rebuild and commit `dist/` in the same change. CI fails on drift.

## Dev Agent Record

### Implementation Notes

Implementation completed in a single pass.

- **Task 1 (per-file isolation + new typed error):** `BmadLlmExtractionError` added to `errors.ts`. `listSourceStoriesResilient()` added as the load-bearing helper; `listSourceStories()` delegates to it.
- **Task 2 (LLM extractor + Anthropic seam):** `@anthropic-ai/sdk@^0.98.0` added. `anthropic-client.ts` exposes `getAnthropicClient()` + `hasAnthropicKey()`. `extract-bmad-story-llm.ts` does Haiku-then-Sonnet with cache write via `writeManagedFile`.
- **Task 3 (ScanResult + render):** `extractedByLlmRefs` and `unparseableRefs` added to `ScanResult`. `renderScanResult` surfaces them on dedicated lines.
- **Task 4 (skip done):** `shouldSkipDoneAtWalk` reads first 4KB; sprint-status.yaml consulted once per call. `bmad-adapter.test.ts` updated to expect 5 stories instead of 6.
- **Task 5 (budget warning):** `console.warn` + `result.warnings` entry when `extractedByLlm.length > 10`.
- **Task 6 (integration test):** Three-file fixture under `sample-llm-fallback-repo/`. Six sub-assertions exercised, Anthropic SDK mocked via `vi.mock`.
- **Task 7 (docs):** `bmad-format.md` and `README-install.md` updated.
- **Task 8 (build/test):** `pnpm build` clean; full test suite passes (987 tests).

### Completion Notes

- All tasks complete; all ACs satisfied.
- Decisions made within the spec envelope:
  - Synthesised `acceptance_criteria` placeholder on unparseable manifests (schema requires `min(1)`).
  - `blocked_detail` not added to the manifest schema (would have widened a `.strict()` schema); detail surfaced via `discipline_violations` instead.
  - `extracted_by_llm: true` lives on `raw_frontmatter`, not on the manifest schema, for the same `.strict()` reason.

## File List

- `plugins/crew/mcp-server/src/errors.ts` (modified)
- `plugins/crew/mcp-server/src/adapters/bmad/index.ts` (modified)
- `plugins/crew/mcp-server/src/tools/scan-sources.ts` (modified)
- `plugins/crew/mcp-server/package.json` (modified)
- `plugins/crew/mcp-server/src/lib/anthropic-client.ts` (created)
- `plugins/crew/mcp-server/src/adapters/bmad/extract-bmad-story-llm.ts` (created)
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-1-clean-story.md` (created)
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-2-drifted-em-dash-acs.md` (created)
- `plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-llm-fallback-repo/3-3-genuinely-broken.md` (created)
- `plugins/crew/mcp-server/src/adapters/bmad/__tests__/bmad-adapter-llm-fallback.integration.test.ts` (created)
- `plugins/crew/mcp-server/tests/bmad-adapter.test.ts` (modified — skip-done expectation)
- `plugins/crew/docs/spikes/bmad-format.md` (modified)
- `plugins/crew/docs/README-install.md` (modified)
- `plugins/crew/mcp-server/dist/` (rebuilt)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — added 3-9 entry)

## Change Log

- 2026-05-25: Story 3.9 spec authored and implemented in one pass. Hybrid regex + LLM fallback for BMad story parsing; skip-done-at-walk bundled. All 987 tests pass.
