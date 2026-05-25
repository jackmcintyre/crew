# Story 4.13: Typed error-class assertions in dev-outcome tests

story_shape: substrate

Status: ready-for-dev

## Story

As a maintainer,
I want the AC5d and AC5e assertions in `process-dev-transcript.test.ts` to use `.rejects.toBeInstanceOf(DevOutcomeFileMalformedError)` rather than substring matching on error messages,
So that the tests are resistant to error-message refactors and assert the typed error contract directly.

Context: surfaced as an Info-tier reviewer note on PR #122 (Story 4.8b's retro). Promoted to its own story to serve as the first crew dogfood — a deliberately tiny, low-risk pilot for the `/crew:start` loop now that 4-8b's handoff-parser hardening is in.

## Acceptance Criteria

**AC1:**
**Given** the AC5d test case in `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts` (`processDevTranscript with dev-outcome.json containing malformed JSON throws DevOutcomeFileMalformedError`),
**When** the test runs,
**Then** the assertion uses `.rejects.toBeInstanceOf(DevOutcomeFileMalformedError)` instead of `.rejects.toThrow("dev-outcome.json")`, and `DevOutcomeFileMalformedError` is imported from `../../errors.js` at the top of the test file.

vitest: processDevTranscript with dev-outcome.json containing malformed JSON throws DevOutcomeFileMalformedError

**AC2:**
**Given** the AC5e test case in the same file (`processDevTranscript with dev-outcome.json missing prNumber field throws DevOutcomeFileMalformedError`),
**When** the test runs,
**Then** the assertion uses `.rejects.toBeInstanceOf(DevOutcomeFileMalformedError)` instead of substring matching.

vitest: processDevTranscript with dev-outcome.json missing prNumber field throws DevOutcomeFileMalformedError

**AC3 (integration):**
**Given** AC1 and AC2 are implemented,
**When** `pnpm test` runs from `plugins/crew/mcp-server`,
**Then** the full vitest suite passes and no production code is modified.

vitest: process-dev-transcript

**AC4 (substrate):**
**Given** Epic 4 stories 4-10b, 4-11, and 4-12 add prose steps to one or more SKILL.md files,
**When** this cleanup story runs,
**Then** `plugins/crew/mcp-server/src/__tests__/start-skill-content.test.ts` (and the equivalent test for any other SKILL.md that grew new prose this epic) is extended with one structural-anchor assertion per new step — matching the existing anchor-test pattern. _(retro carry-forward #7 — see Retro Amendments below)_

vitest: start-skill-content covers Epic 4 new prose anchors

## Tasks / Subtasks

Implementation order is not load-bearing — both ACs can be addressed in any order.

- [ ] **Task 1: Add import (if missing).** Open `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts`. If `DevOutcomeFileMalformedError` is not already imported from `../../errors.js`, add it to the existing errors import line or as a new import.

- [ ] **Task 2: Update AC5d assertion (AC1).** Locate the AC5d test case (the one asserting malformed JSON in `dev-outcome.json` throws). Change `.rejects.toThrow("dev-outcome.json")` (or whatever substring is currently asserted) to `.rejects.toBeInstanceOf(DevOutcomeFileMalformedError)`.

- [ ] **Task 3: Update AC5e assertion (AC2).** Locate the AC5e test case (missing `prNumber` field). Apply the same change.

- [ ] **Task 4: Run the suite.** `cd plugins/crew/mcp-server && pnpm test`. Confirm all tests pass (expect 959+ green). If the suite was already 959, you should see 959 again; the count should not change.

## Dev Notes

**Scope is intentionally narrow.** This story touches exactly two assertion lines (and one import line, if needed). Do NOT modify production code, `errors.ts`, `read-dev-outcome-file.ts`, or `process-dev-transcript.ts`. Do NOT modify other test files. Do NOT modify `sprint-status.yaml`.

**File and line references:**
- Test file: `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts`
- Tests added in commit `a3956cd` (PR #122). Search for the literal string `dev-outcome.json` in the test file to locate AC5d/5e blocks.
- `DevOutcomeFileMalformedError` is exported from `plugins/crew/mcp-server/src/errors.ts` (added in the same PR).

**Why typed-instance over substring:** A typed `.toBeInstanceOf` check asserts the production code's error-class contract directly. Substring matching on `.message` couples the test to the human-readable error wording — a refactor that improves the message (e.g. adding context) silently breaks the test. The typed check only fails if the error class changes, which is what we actually care about.

**Locked files (do not modify):**
- `plugins/crew/mcp-server/src/errors.ts`
- `plugins/crew/mcp-server/src/lib/read-dev-outcome-file.ts`
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts`
- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts`
- Any file under `plugins/crew/mcp-server/dist/` (rebuild via `pnpm build` if anything regenerates).

**Testing standards:** vitest. Run from `plugins/crew/mcp-server`. The change is assertion-shape only; no fixtures change, no stubs change, no new test cases needed.

**Previous story intelligence:** PR #122 (Story 4.8b) added these tests with substring assertions. The reviewer flagged the substring approach as Info-tier and shipped it; this story closes that note. See the PR retro comment at https://github.com/jackmcintyre/crew/pull/122#issuecomment-4528928199.

## Retro Amendments — 2026-05-25

Added during the mid-epic-4 retrospective ([epic-4-retro-2026-05-25.md](epic-4-retro-2026-05-25.md), carry-forward #7). AC4 lives in `## Acceptance Criteria` above; the why-and-context lives here. AC3 was also rewritten into Given/When/Then form so the discipline parser keeps it separate from AC2 (the parser was previously bundling AC3's prose into AC2's text block, hiding the integration-tagged AC).

**Why AC4 exists:** Locked-phrase grammar drift has three fresh examples this epic (4.6, 4.8, 4.10b reviewer Lows). The pattern of "new prose ships with no anchor test" is the root cause. This AC closes the gap retroactively for Epic 4 prose; the longer-term move (locked phrases out of prose, into config) is deferred to Epic 6.

**Scope marker:** this AC only covers prose added by stories 4-10b / 4-11 / 4-12. The dev agent runs `git log --since="2026-05-23" -- '**/SKILL.md'` (or equivalent — last 3 stories' diffs) to enumerate added steps, then writes one assertion per step. If any of those stories shipped without prose additions, the AC is satisfied trivially.

**Out of scope for this story:**
- A general "every new SKILL.md step must have an anchor test" lint (deferred — needs its own discipline-gate work).
- Moving locked phrases to config (Epic 6 carry-forward).

## Dev Agent Record

_(Populated by the dev agent during implementation.)_

### Agent model used

### Debug log references

### Completion notes

### File list

### Change log
