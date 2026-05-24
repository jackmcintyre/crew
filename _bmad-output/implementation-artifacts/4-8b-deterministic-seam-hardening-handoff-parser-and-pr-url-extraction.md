# Story 4.8b: Deterministic seam hardening — handoff parser and PR URL extraction

story_shape: substrate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin maintainer**,
I want **the PR number to be captured by machine code (`runDevTerminalAction`) and read from a session file (`dev-outcome.json`) rather than parsed from the dev subagent's LLM-authored transcript**,
so that **`processDevTranscript` never throws `PrUrlNotFoundInDevTranscriptError` because the dev subagent omitted the PR URL from its final message, and the handoff → reviewer-spawn path is reliable without depending on the exact wording of the dev's output beyond the locked handoff phrase**.

### What this story is, in one sentence

Add a `dev-outcome.json` session-state file written atomically by `runDevTerminalAction` after a successful `gh pr create`, and modify `processDevTranscript` to read the PR number from that file rather than scanning the dev transcript with `PR_URL_RE` — replacing a fragile LLM-text regex with a machine-written, machine-read seam.

### What this story does (and why it needs its own story)

Story 4.6 added `PR_URL_RE` scanning to `processDevTranscript` (Task 6.1–6.3 in the 4.6 spec). The approach: the dev subagent calls `runDevTerminalAction`, gets back a `prUrl`, mentions it in its final message, and `processDevTranscript` scans the transcript for any GitHub PR URL pattern and takes the rightmost match.

Two fragility points:

1. **False positives.** The dev transcript may contain PR URLs from the story spec itself (e.g., `[Source: … PR #111]` references in the spec doc the dev reads), from the standards doc, or from the persona body. The regex takes the rightmost match, which is a heuristic — if the dev mentions a second PR URL anywhere after the `runDevTerminalAction`-sourced URL, the heuristic produces the wrong number.

2. **False negatives.** The dev subagent (an LLM) may emit the locked handoff phrase without including the PR URL in its final message — either because the prompt didn't make it mandatory enough, or because the LLM elided it. The current code path is: `parseHandoff` succeeds → `PR_URL_RE` scan finds nothing → `PrUrlNotFoundInDevTranscriptError` propagates uncaught as a `DomainError`. This crashes the inner cycle with a confusing error for the operator.

`runDevTerminalAction` already holds the PR URL deterministically — it is `ghResult.stdout.trim()` from `gh pr create`. The URL is machine-computed, not LLM-generated. The fix is: write it to a session file at tool call time, and read it from that file in `processDevTranscript`.

The "handoff parser" part of the story name addresses the coupling inside `processDevTranscript`: the PR URL extraction is tightly coupled to the handoff parsing step (both live in the same function). Making PR URL extraction file-based makes the handoff-parsing seam self-contained — it checks only the last non-empty line for the locked phrase, and the reviewer's `prNumber` comes from a separate, independent file read. The two seams are now compositional and each is deterministic on its own.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`.
- (b) Change the locked handoff phrase from Story 4.3. The phrase `Handoff to reviewer — story <ref> ready for review.` is unchanged. `parseHandoff` is unchanged. `processDevTranscript`'s handoff phrase check (last-non-empty-line equality) is unchanged.
- (c) Change the dev subagent persona body or its instruction to include the PR URL in its final message. That instruction is good practice for human operators reading the transcript; Story 4.8b only removes the machine dependency on it.
- (d) Change the `runDevTerminalAction` return type. It still returns `{ ok: true, branch, commitSha, prUrl }`. Writing `dev-outcome.json` is an additional side effect, not a change to the return contract.
- (e) Persist the dev transcript to disk. Only the structured `dev-outcome.json` is written. The transcript remains in-memory / discarded per Story 4.3b (k).
- (f) Remove `PR_URL_RE` from `process-dev-transcript.ts`. The regex is kept as a fallback for backward compatibility — a session started before this story is deployed will have no `dev-outcome.json`; the fallback prevents a hard crash on upgrade. On the fallback path, all current error behaviour is preserved (`PrUrlNotFoundInDevTranscriptError` if no URL found).
- (g) Change how `prNumber` flows to the reviewer. SKILL.md prose already stores `prNumber` from the `processDevTranscript` result and passes it to `runReviewerSession`. The type and call site are unchanged.
- (h) Write any file outside `.crew/state/sessions/<sessionUlid>/`. `dev-outcome.json` is written to the session directory, which is already managed state.
- (i) Emit telemetry. Story 4.12 owns telemetry.
- (j) Handle the case where the session directory does not exist when `runDevTerminalAction` tries to write. The session directory is created by `mintSessionUlid` before any tool call. If the directory is missing, `atomicWriteFile` will throw ENOENT — propagate uncaught (existing invariant).
- (k) Change the `runReviewerSession` caller in SKILL.md or its inputs. Only `processDevTranscript`'s internal PR-number resolution changes; the output shape `{ next: "spawn-reviewer", prNumber, reviewerPrompt, chatLog }` is unchanged.
- (l) Add a strict "handoff implies dev-outcome file exists" assertion. `processDevTranscript` checks for the file opportunistically (use if present, fall back otherwise). A strict assertion — refusing to proceed if `parseHandoff` succeeds but no `dev-outcome.json` exists — is deferred work (see § Deferred work).

### Deferred work

- **`PR_URL_RE` fallback removal.** The regex fallback is kept to handle sessions that began before this story deployed. A follow-up story should remove the fallback once all sessions are guaranteed to produce `dev-outcome.json`. Recommend removing after Epic 5 stabilises the session lifecycle.
- **Handoff validation gate.** A future story could assert that `dev-outcome.json` exists whenever `parseHandoff` succeeds — treating its absence as a sign that `runDevTerminalAction` was never called, and blocking the reviewer spawn. v1 treats absence as "fall back to transcript", which is softer but avoids surfacing a new hard error during the stabilisation period.

---

## Acceptance Criteria

> AC1–AC4 describe structural and behavioural changes to internal MCP tools. AC5 is the integration test. Per `plugins/crew/docs/user-surface-acs.md`, this story is `substrate`; no `(user-surface)` tags apply.

**AC1:**
**Given** the `runDevTerminalAction` MCP tool completes a successful `gh pr create` (i.e., `prUrl` is validated as starting with `https://github.com/`),
**When** the tool runs,
**Then** it atomically writes `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/dev-outcome.json` with the shape `{ "prUrl": "<url>", "prNumber": <int>, "branch": "<branch>", "commitSha": "<sha>" }` using `atomicWriteFile` from `lib/managed-fs.ts`, where `prNumber` is parsed as `parseInt(prUrl.split("/pull/")[1]!, 10)`. The write happens before the `return { ok: true, ... }` statement. If the write throws (e.g., session directory missing), the error propagates uncaught before the return. _(seam reliability; replaces the fragile LLM-text extraction path)_

<!-- Not user-surface: AC1 describes a tool's internal file-write side-effect. No operator-visible change. -->

**AC2:**
**Given** `processDevTranscript` is called after a successful `parseHandoff` (i.e., `parseHandoff` returns `{ ok: true }`),
**When** `dev-outcome.json` is present at `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/dev-outcome.json` and contains valid JSON with all required fields,
**Then** `processDevTranscript` reads `prNumber` from the file (without scanning `devTranscript` with `PR_URL_RE`), and returns `{ next: "spawn-reviewer", prNumber: <file-sourced int>, reviewerPrompt, chatLog }`. The `PR_URL_RE` regex loop is not reached on this path.

<!-- Not user-surface: AC2 describes the primary file-read path. Operator-observable behaviour (reviewer spawns with correct PR number) is unchanged. -->

**AC3:**
**Given** `processDevTranscript` is called after a successful `parseHandoff`,
**When** `dev-outcome.json` is NOT present in the session directory (ENOENT),
**Then** `processDevTranscript` falls through to the existing `PR_URL_RE` regex scan of `devTranscript`, and behaves exactly as Story 4.6 Task 6.1–6.3 specified — returning the extracted `prNumber` on match, or throwing `PrUrlNotFoundInDevTranscriptError` if no GitHub PR URL is found. _(backward compatibility fallback — unchanged error surface)_

<!-- Not user-surface: AC3 describes the fallback path. -->

**AC4:**
**Given** `dev-outcome.json` exists in the session directory,
**When** `processDevTranscript` reads it and the file contains malformed JSON or is missing any required field (`prUrl`, `prNumber`, `branch`, `commitSha`),
**Then** `processDevTranscript` throws `DevOutcomeFileMalformedError` (new typed error extending `DomainError`, with fields `{ sessionUlid: string; path: string; cause: unknown }`). The tool does NOT fall back to transcript scanning on a malformed file — a malformed file is a write-seam bug, not a missing-file case; silent fallback would paper over it.

<!-- Not user-surface: AC4 describes error-propagation on a malformed state file. -->

**AC5 (integration):**
vitest covers:

- (5a) **Write path:** `runDevTerminalAction` with a stubbed `gh pr create` returning `https://github.com/jackmcintyre/crew/pull/42` → `dev-outcome.json` is written to the session tmpdir with `{ prUrl: "https://github.com/jackmcintyre/crew/pull/42", prNumber: 42, branch: "<branch>", commitSha: "<sha>" }`.
- (5b) **File-present path:** `processDevTranscript` with a transcript ending in the correct handoff phrase AND `dev-outcome.json` present (containing `prNumber: 42`) AND NO GitHub PR URL anywhere in the transcript → returns `{ next: "spawn-reviewer", prNumber: 42, ... }`. Confirms `PR_URL_RE` is not relied on.
- (5c) **Fallback path:** `processDevTranscript` with a transcript ending in the correct handoff phrase AND a valid GitHub PR URL in the transcript AND NO `dev-outcome.json` present → returns `{ next: "spawn-reviewer", prNumber: <parsed from transcript> }`.
- (5d) **Malformed file:** `dev-outcome.json` present but invalid JSON → `DevOutcomeFileMalformedError` thrown, no fallback to transcript scanning.
- (5e) **Missing field:** `dev-outcome.json` present but missing `prNumber` field → `DevOutcomeFileMalformedError` thrown.
- (5f) **Non-regression — existing `PrUrlNotFoundInDevTranscriptError` path:** no `dev-outcome.json`, no PR URL in transcript, handoff phrase present → `PrUrlNotFoundInDevTranscriptError` thrown (Story 4.6 path unchanged).
- (5g) **Non-regression — Story 4.3 / 4.3b / 4.5 branches:** grammar-drift, empty transcript, recoverable-error marker — all return `{ next: "done-blocked-*" }` unchanged; none reach the file-read path.
- (5h) **Non-regression — `runDevTerminalAction` existing tests:** all existing AC tests still pass after Task 1 adds the file write. Use `pluginRootOverride` or a tmpdir fixture to give the tool a session directory.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

---

## Tasks / Subtasks

Implementation order is load-bearing.

- [ ] **Task 1: Write `dev-outcome.json` in `runDevTerminalAction`** (AC: #1, #5a, #5h)
  - [ ] 1.1 In `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts`, add an import for `atomicWriteFile` from `"../lib/managed-fs.js"`.
  - [ ] 1.2 After the `prUrl` validation block (currently lines 177–183, which throw `GhPrCreateFailedError` if `prUrl` is falsy or doesn't start with `https://github.com/`), compute `prNumber = parseInt(prUrl.split("/pull/").at(-1)!, 10)`.
  - [ ] 1.3 Compute `devOutcomePath = path.resolve(targetRepoRoot, ".crew", "state", "sessions", sessionUlid, "dev-outcome.json")`.
  - [ ] 1.4 Call `await atomicWriteFile(devOutcomePath, JSON.stringify({ prUrl, prNumber, branch, commitSha }, null, 2))`. This happens BEFORE the `return { ok: true, branch, commitSha, prUrl }` statement.
  - [ ] 1.5 Do NOT add `sessionUlid` to the return type — it is already a tool input; the caller already has it.
  - [ ] 1.6 Verify the existing `runDevTerminalAction` integration tests still pass. Add a new test case asserting `dev-outcome.json` content (5a).

- [ ] **Task 2: Add `DevOutcomeFileMalformedError` to `errors.ts`** (AC: #4, #5d, #5e)
  - [ ] 2.1 In `plugins/crew/mcp-server/src/errors.ts`, add:
    ```ts
    export class DevOutcomeFileMalformedError extends DomainError {
      readonly sessionUlid: string;
      readonly path: string;
      readonly cause: unknown;
      constructor(opts: { sessionUlid: string; path: string; cause: unknown }) { ... }
    }
    ```
  - [ ] 2.2 The `cause` field carries the underlying parse error or a descriptive string for missing-field cases. Follow the pattern of `ReviewerResultFileMalformedError` in the same file.

- [ ] **Task 3: Add `readDevOutcomeFile` shared helper** (AC: #2, #3, #4)
  - [ ] 3.1 Create `plugins/crew/mcp-server/src/lib/read-dev-outcome-file.ts`. Export `readDevOutcomeFile(devOutcomePath: string, sessionUlid: string): Promise<DevOutcome | null>` where `DevOutcome = { prUrl: string; prNumber: number; branch: string; commitSha: string }`.
  - [ ] 3.2 On ENOENT: return `null`.
  - [ ] 3.3 On read success: `JSON.parse(contents)`. Validate the presence and types of all four required fields (`prUrl: string`, `prNumber: number`, `branch: string`, `commitSha: string`). On parse failure or missing/wrong-typed fields: throw `DevOutcomeFileMalformedError({ sessionUlid, path: devOutcomePath, cause })`.
  - [ ] 3.4 No Zod dependency required — manual field checks mirror the pattern in `read-reviewer-result-file.ts`.

- [ ] **Task 4: Modify `processDevTranscript` to use the file** (AC: #2, #3, #4, #5b–5g)
  - [ ] 4.1 Import `readDevOutcomeFile` from `"../lib/read-dev-outcome-file.js"` and import `DevOutcomeFileMalformedError` from `"../errors.js"`.
  - [ ] 4.2 After `parseHandoff` returns `{ ok: true }` (currently at line 145, before the `PR_URL_RE` scan at line 163), compute `devOutcomePath = path.resolve(targetRepoRoot, ".crew", "state", "sessions", sessionUlid, "dev-outcome.json")`.
  - [ ] 4.3 Call `const devOutcome = await readDevOutcomeFile(devOutcomePath, sessionUlid)`.
  - [ ] 4.4 If `devOutcome` is non-null: use `devOutcome.prNumber` as `prNumber`. Skip the `PR_URL_RE` scan entirely and jump directly to the `buildPersonaSpawnPrompt` call.
  - [ ] 4.5 If `devOutcome` is null (file absent): fall through to the existing `PR_URL_RE` scan block (lines 163–175 in current implementation). No change to existing fallback behaviour.
  - [ ] 4.6 `DevOutcomeFileMalformedError` thrown by `readDevOutcomeFile` propagates uncaught — same pattern as `ReviewerResultFileMalformedError` in `processReviewerTranscript`.
  - [ ] 4.7 The `sessionUlid` variable is already in scope in `processDevTranscript` (it is destructured from `opts` at line 95). No new parameters needed.

- [ ] **Task 5: Update tests** (AC: #5)
  - [ ] 5.1 In `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts`, add test cases for (5b) file-present path, (5c) fallback path, (5d) malformed JSON, (5e) missing field. Use `tmpdir` per `beforeEach`; write `dev-outcome.json` where needed. The `processDevTranscript` call takes `targetRepoRoot` and `sessionUlid` from which the tool resolves the path.
  - [ ] 5.2 In the `runDevTerminalAction` test file, add test case (5a): stub `gh pr create` to return a known PR URL; assert `dev-outcome.json` is written to the session tmpdir with the expected content.
  - [ ] 5.3 Run full vitest suite (`pnpm vitest --run` from `mcp-server/`) — confirm all existing tests still pass.

- [ ] **Task 6: Build, vitest, dist** (AC: all)
  - [ ] 6.1 `pnpm build` passes.
  - [ ] 6.2 All vitest tests pass. Tool count unchanged (no new MCP tools registered; `DevOutcomeFileMalformedError` is a new error class, not a new tool).
  - [ ] 6.3 Commit `dist/` per CLAUDE.md.

---

## Implementation strategy

### Why `atomicWriteFile` rather than `fs.writeFile`

`atomicWriteFile` (from `lib/managed-fs.ts`) writes to a temp file and atomically renames — from Story 1.6. This prevents partial reads if the process crashes between write and close. Consistency with all other session-state writes in this plugin.

### Why parse `prNumber` in `runDevTerminalAction` rather than in `processDevTranscript`

`runDevTerminalAction` already validated `prUrl.startsWith("https://github.com/")`. Parsing `prNumber` at that point is natural and keeps the integer in the file alongside the URL. `processDevTranscript` doesn't need to know how to parse GitHub PR URLs — it just reads the pre-parsed integer.

### Why keep the `PR_URL_RE` fallback

Session continuity: a `/crew:start` session that started before this story is deployed will have no `dev-outcome.json`. When `processDevTranscript` runs for such a session (ENOENT on the file), the fallback prevents a hard `DevOutcomeFileMalformedError` where previously there was only a potential `PrUrlNotFoundInDevTranscriptError`. The fallback is the conservative choice during the stabilisation period.

### Why `DevOutcomeFileMalformedError` does not fall back to transcript scanning

A malformed file is a machine-write failure, not an absent file. If `atomicWriteFile` produces invalid JSON (e.g., a bug in Task 1's `JSON.stringify` call), silently falling back to transcript scanning would hide the write-seam bug and produce a misleading `PrUrlNotFoundInDevTranscriptError` instead of pointing at the real root cause. Hard errors on malformed files surface bugs faster.

---

## Locked files

- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Story 4.6) — NOT touched
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Stories 4.6b / 4.7) — NOT touched
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Story 4.6 revision 2) — NOT touched
- `plugins/crew/skills/start/SKILL.md` (Stories 4.2 / 4.3b / 4.3c / 4.6 / 4.6b / 4.7) — NOT touched
- `plugins/crew/permissions/generalist-reviewer.yaml` (Stories 2.2 / 4.6 / 4.7 / 4.8) — NOT touched

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts`** (Story 4.4) — Task 1 adds a `dev-outcome.json` write after a successful `gh pr create`. The change is additive (new side-effect only; return type unchanged) and is load-bearing for AC1's machine-authoritative seam.
- **`plugins/crew/mcp-server/src/tools/process-dev-transcript.ts`** (Stories 4.3b / 4.5 / 4.6) — Task 4 inserts a `readDevOutcomeFile` call in the `parseHandoff`-success branch (before the `PR_URL_RE` scan). Existing recoverable-error check (Step 1) and handoff-phrase check (Step 2) are UNTOUCHED. The `PR_URL_RE` scan block is preserved as-is for the fallback path.
- **`plugins/crew/mcp-server/src/errors.ts`** (Stories 4.5 / 4.6b) — Task 2 adds `DevOutcomeFileMalformedError`. No existing error classes are modified.

---

## Dev Notes

### Files this story will create

- `plugins/crew/mcp-server/src/lib/read-dev-outcome-file.ts` (Task 3)

### Files this story will modify

- `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts` (Task 1)
- `plugins/crew/mcp-server/src/errors.ts` (Task 2)
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` (Task 4)
- `plugins/crew/mcp-server/src/tools/__tests__/process-dev-transcript.test.ts` (Task 5.1)
- `plugins/crew/mcp-server/src/tools/__tests__/run-dev-terminal-action.test.ts` (Task 5.2)
- `plugins/crew/mcp-server/dist/` (rebuild; commit per CLAUDE.md)

### Current-state notes on files being modified

- **`run-dev-terminal-action.ts`** (current state per Story 4.4): `sessionUlid` is already a typed input parameter (line 80). The `prUrl` is set at line 177. The write in Task 1 goes between lines 183 (the `GhPrCreateFailedError` throw on bad URL) and the existing `return { ok: true, ... }` at line 190. `atomicWriteFile` import is `import { atomicWriteFile } from "../lib/managed-fs.js"`.
- **`process-dev-transcript.ts`** (current state per Stories 4.3b / 4.5 / 4.6): `sessionUlid` is already destructured from `opts` (line 95). The `PR_URL_RE` scan block begins at line 163 (`let lastMatch: RegExpExecArray | null = null`). Task 4 inserts before line 163 — the fallback path starts exactly where the old path was.
- **`errors.ts`** (current state per Story 4.6b): `ReviewerResultFileMalformedError` (around line 1000) is the pattern to follow for `DevOutcomeFileMalformedError`.

### Testing standards

- vitest with `pnpm vitest --run` from `mcp-server/`.
- Use `tmp` directory fixtures per `beforeEach`; clean up per `afterEach` using `fs.rm`.
- For the `runDevTerminalAction` write-path test (5a): provide a `sessionUlid` and a `targetRepoRoot` pointing to a tmpdir with a valid `.crew/state/sessions/<sessionUlid>/` directory. Stub `gh pr create` via `execaImpl` to return the test PR URL.
- For `processDevTranscript` file-read tests (5b–5e): write (or omit) `dev-outcome.json` in the session tmpdir; pass matching `targetRepoRoot` and `sessionUlid` to the tool.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md`]
- [Source: `_bmad-output/implementation-artifacts/4-8-reviewer-labels-and-negative-capability-enforcement.md`] (adjacent story, grounding voice)
- [Source: `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts`] (modified by Task 4; PR_URL_RE block at lines 163–175)
- [Source: `plugins/crew/mcp-server/src/tools/run-dev-terminal-action.ts`] (modified by Task 1; write site at lines 183–190)
- [Source: `plugins/crew/mcp-server/src/lib/managed-fs.ts`] (atomicWriteFile export — used in Task 1)
- [Source: `plugins/crew/mcp-server/src/lib/read-reviewer-result-file.ts`] (pattern for Task 3's helper)
- [Source: `plugins/crew/mcp-server/src/errors.ts`] (DevOutcomeFileMalformedError added in Task 2)

---

## Previous story intelligence

### From Story 4.6 (Task 6.1–6.3, shipped)

- `PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g` was added to `processDevTranscript` in Story 4.6. The rightmost-match heuristic (`lastMatch`) is at lines 163–178 in the current file. Story 4.8b's Task 4 inserts a file-read step before this block; the block itself is preserved verbatim as the fallback path.
- `PrUrlNotFoundInDevTranscriptError` (errors.ts line 1065) remains; the fallback path still throws it.

### From Story 4.4 (shipped)

- `runDevTerminalAction` returns `prUrl = ghResult.stdout.trim()` (line 177). `sessionUlid` is already a parameter (line 80). Task 1's write site is between lines 183 and 190.
- The `atomicWriteFile` helper is `lib/managed-fs.ts:115` — already used elsewhere in the plugin.

### From Story 4.3b (shipped) — transcript-passing contract

- Story 4.3b (k) explicitly says transcripts are NOT persisted: "Transcripts flow from `Task` (return value) → SKILL.md prose (in-memory string) → `processDevTranscript` → discarded." Story 4.8b does NOT change this — `dev-outcome.json` is written by `runDevTerminalAction` (a separate tool call before the transcript is even captured), not by `processDevTranscript`.

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
