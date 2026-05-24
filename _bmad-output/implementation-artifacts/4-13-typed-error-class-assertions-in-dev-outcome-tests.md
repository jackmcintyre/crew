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

**AC2:**
**Given** the AC5e test case in the same file (`processDevTranscript with dev-outcome.json missing prNumber field throws DevOutcomeFileMalformedError`),
**When** the test runs,
**Then** the assertion uses `.rejects.toBeInstanceOf(DevOutcomeFileMalformedError)` instead of substring matching.

**AC3 (integration):** The full vitest suite passes from `plugins/crew/mcp-server` (`pnpm test`) after the change. No production code modified.

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

## Dev Agent Record

_(Populated by the dev agent during implementation.)_

### Agent model used

### Debug log references

### Completion notes

### File list

### Change log
