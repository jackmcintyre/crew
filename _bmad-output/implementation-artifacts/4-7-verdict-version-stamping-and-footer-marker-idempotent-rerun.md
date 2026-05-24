# Story 4.7: Verdict version stamping and footer-marker idempotent rerun

story_shape: user-surface

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator reading a verdict weeks later**,
I want **every verdict comment to carry the standards-doc version and the plugin version that produced it, and reruns to edit the prior verdict in place rather than stack new ones**,
so that **I can quickly see which version of the standards was used to review a PR (and whether the verdict pre-dates a standards update), and re-triggering a review doesn't clutter the PR with duplicate verdict comments**.

### What this story is, in one sentence

Extend `postReviewerComments` (Story 4.6b) to: (1) append a human-readable version line and a machine-parseable footer marker (`<!-- crew:verdict:<plugin-version>:<ref> -->`) to every posted summary body, and (2) before posting, list existing PR reviews and PATCH-edit any prior verdict comment whose footer marker matches the current story ref — closing the "stacking duplicate verdicts on rerun" gap Story 4.6b left open.

### What this story does (and why it needs its own story)

Story 4.6b shipped the comment-posting surface: `postReviewerComments` composes a deterministic summary body and posts it as a single PR review. But the posted body carries no provenance, and reruns stack new verdict comments rather than updating the existing one.

Two concrete gaps this creates:

1. **Traceability gap.** An operator reviewing a PR weeks later can't tell at a glance whether the verdict was produced by the current standards doc or a stale one. If the standards doc was updated between runs, the operator has no way to know the verdict pre-dates the update without cross-referencing the commit history.

2. **Rerun stacking.** If the operator triggers a second review pass (e.g. after a dev pushes a fix), `postReviewerComments` creates a second "Reviewer commented" entry on the PR. After three rework cycles the PR has three verdict entries; the operator has to read all three to find the latest.

Story 4.7 closes both gaps by: (1) adding a version block to `composeSummaryBody` (extending the two pure helpers, which are tested exhaustively), and (2) adding a prior-verdict search step to `postReviewerComments` that GETs existing reviews, scans for the footer-marker token, and PATCHes the prior comment if found.

The footer marker `<!-- crew:verdict:<plugin-version>:<ref> -->` is an HTML comment — invisible in rendered GitHub markdown, machine-parseable by the tool. It is the anchor for the idempotent-rerun search on every subsequent pass.

### What this story does NOT

- (a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml`. State transitions owned by the workflow harness.
- (b) Add risk-tier to the version block. Story 4.9/4.9b own risk-tier classification; v1's version block is `standards_version` + `plugin_version` only.
- (c) Add PR labels. Story 4.8 owns labelling.
- (d) Change the verdict-line grammar from Story 4.6b. `**Verdict: READY FOR MERGE**` / `**Verdict: NEEDS CHANGES** [...]` / `**Verdict: BLOCKED** [...]` are unchanged. The version line and footer marker are appended AFTER the verdict line.
- (e) Narrow `gh_allow_args` for the `api` subcommand added by Story 4.6b. A future story can narrow if needed; v1 uses the same broad `api` entry for GET, POST, and PATCH.
- (f) Handle the case where GitHub returns a non-200 on PATCH (e.g. 422 for a dismissed review). v1 propagates `GhApiResponseShapeError` uncaught; Epic 5 owns recovery.
- (g) Add the footer marker to inline comments. Only the top-level summary review body carries it. Inline diff-line comments (from Story 4.6b) are unchanged.
- (h) Include a timestamp in the footer marker. v1's marker is `<!-- crew:verdict:<plugin-version>:<ref> -->` — plugin version and story ref only.
- (i) Emit telemetry. Story 4.12 owns telemetry.
- (j) Change the `ReviewerSessionResult` in-memory type from Story 4.6. Only the persisted `reviewer-result.json` projection gains `standardsVersion`; the in-memory type is unchanged.
- (k) Touch `processReviewerTranscript`, `claimStory`, `completeStory`, or any state-machine primitive.
- (l) Create a new `getPluginVersion` helper. `lib/plugin-version.ts` already exports `getPluginVersion()` (sync, cached) and its JSDoc already cites Story 4.7 as a caller. Use it directly.

---

## Acceptance Criteria

> AC1 and AC2 are verbatim from the epic. AC3 is the integration suite. AC4 is the user-surface contract — the operator-observable promise that the version stamp is visible and reruns are idempotent. Per `plugins/crew/docs/user-surface-acs.md`, AC4 is tagged `(user-surface)`; the others describe internal behaviour and stay untagged.

**AC1:**
**Given** the reviewer's summary comment (composed and posted by `postReviewerComments`),
**When** posted (first run) or PATCH-edited (rerun),
**Then** the body includes both `standards_version` (from `reviewer-result.json`'s `standardsVersion` field) and `plugin_version` (from `getPluginVersion()`) in the stable format described in AC1 unpacked, and ends with the footer marker `<!-- crew:verdict:<plugin-version>:<ref> -->` as its absolute last line. _(FR35, NFR22)_

<!-- Not user-surface: AC1 describes the comment body's content-structure — what fields are present and in what order. The operator-observable promise is AC4. -->

**AC2:**
**Given** a PR with a prior verdict comment that carries the footer marker `<!-- crew:verdict:[^:]+:<ref> -->` (any plugin version, same story ref),
**When** the reviewer reruns (`postReviewerComments` is called again for the same story and PR),
**Then** it locates the prior comment by scanning existing PR reviews for the footer-marker pattern, and PATCH-edits the prior review body in place; no new review is posted. _(FR39, NFR11)_

<!-- Not user-surface: AC2 describes the PATCH path inside `postReviewerComments`. The operator-observable effect (single comment on the PR after rerun) is AC4. -->

**AC3 (integration):**
vitest runs `postReviewerComments` twice against the same fixture PR (first run: GET returns empty review list, POST creates a new review with `id: 1`; second run: GET returns `[{ id: 1, body: "...<footer-marker>..." }]`, PATCH updates the prior review) and asserts: `gh api POST` stub was called exactly once, `gh api PATCH` stub was called exactly once, and the body passed to both POST and PATCH contains the version line and footer marker as the last line.

<!-- Not user-surface: vitest integration suite — internal harness only. -->

**AC4 (user-surface):**
**Given** a target repo where `/crew:start` has already completed one review pass for a story (a first verdict comment with the footer marker exists on the PR),
**When** the operator runs `/crew:start` again for the same story and the inner cycle invokes `postReviewerComments`,
**Then** the operator observes:
- (a) **Exactly one verdict comment** on the PR after the second run — the prior comment was edited in place, not duplicated. Running `gh pr view <prNumber> --comments` shows one reviewer comment, not two.
- (b) **Version information visible** in the comment body: the human-readable version line (e.g. `_Reviewed by crew v0.1.0 using standards v2026-05-24._`) is present.
- (c) **The footer marker** `<!-- crew:verdict:` appears at the end of the comment body (inspectable via raw GitHub view or `gh api`).

<!-- User-surface: AC4 references `/crew:start` (slash command) and the PR surface observable via `gh pr view --comments`. -->

### Expanded acceptance specifics

**AC1 unpacked.** Version block format and footer-marker placement:

- (1a) **`standardsVersion` on the persisted file (declared locked-file change on Story 4.6):** `runReviewerSession` adds `standardsVersion: string` to the `reviewer-result.json` projection, populated from `standards.version` (the `StandardsDoc.version` field already read by `lookupStandards` inside the composite tool). The `ReviewerResultFileShape` interface and its Zod schema gain `standardsVersion: string`. The in-memory `ReviewerSessionResult` type is NOT changed. The `readReviewerResultFile` helper (extracted by Story 4.6b) Zod schema is extended with `standardsVersion: z.string().optional().default("")` for backward compatibility when reading files produced by a pre-4.7 plugin build.

- (1b) **`plugin_version` source:** use the existing `getPluginVersion()` from `plugins/crew/mcp-server/src/lib/plugin-version.ts`. It is sync, load-once cached, reads from `.claude-plugin/plugin.json`. No new helper is needed. Call it inside `postReviewerComments` with no arguments (it resolves the plugin root itself via `fileURLToPath`).

- (1c) **Version block placement in the summary body:** `composeSummaryBody` is extended to accept `{ standardsVersion: string, pluginVersion: string }` as additional parameters (alongside the existing `ReviewerResultFileShape` input). The version block is appended to the body AFTER the verdict line:
  ```
  **Verdict: READY FOR MERGE**

  _Reviewed by crew v<pluginVersion> using standards v<standardsVersion>._
  <!-- crew:verdict:<pluginVersion>:<ref> -->
  ```
  The `ref` value comes from `result.ref` in the file shape. The HTML comment `<!-- crew:verdict:... -->` is invisible in rendered GitHub markdown; it is the absolute last line of the body string (no trailing newline after it). The human-readable version line is one blank line below the verdict line for visual breathing room.

- (1d) **Footer-marker format (verbatim):** `<!-- crew:verdict:<pluginVersion>:<ref> -->`. Single space after `<!--` and before `-->`. The `<ref>` component is the story ref embedded literally (e.g. `native:01HZ-fixture-story`, `bmad:PROJ-123`). If the ref contains special characters they are included verbatim — the marker is an HTML comment and needs no encoding.

- (1e) **`composeVerdictLine` is unchanged:** the function still returns exactly one of the three sentinel-form strings from Story 4.6b. The version block and footer marker are appended by `composeSummaryBody` AFTER calling `composeVerdictLine`. The `composeVerdictLine` signature and return type do not change.

- (1f) **Unit test extensions for `composeSummaryBody`:** Story 4.6b's existing test suite is extended with cases asserting (using exact-string assertions on the output):
  - The version line `_Reviewed by crew v<pluginVersion> using standards v<standardsVersion>._` appears verbatim.
  - The footer marker `<!-- crew:verdict:<pluginVersion>:<ref> -->` is the absolute last line of the body (`body.split("\n").at(-1) === marker`).
  - The verdict line immediately precedes the version block (order assertion: verdict line position < version line position < footer marker position).
  - When `standardsVersion` is `""` (file produced by pre-4.7 build, `.optional().default("")` in effect): the version line renders `_Reviewed by crew v<pluginVersion> using standards v(unknown)._`.

**AC2 unpacked.** Prior-verdict search, PATCH path, and POST fallback:

- (2a) **New Step 4a in `postReviewerComments`:** inserted AFTER the existing Step 4 (PR-context resolution: `owner`, `repo` from `gh pr view`) and BEFORE Step 5 (inline-comment generation). Step 4a:
  1. Call `getPluginVersion()` to obtain `pluginVersion` (sync; the call is inside the `postReviewerComments` async function but the function itself is sync-returns-string).
  2. Call `gh({ role, permissions, subcommand: "api", args: ["/repos/${owner}/${repo}/pulls/${prNumber}/reviews", "--method", "GET"], execaImpl })`. Parse the response as `Array<{ id: number; body: string }>`. On non-array or parse failure, raise `GhApiResponseShapeError({ subcommand: "api", url: "/reviews", cause })`.
  3. Search the array for the FIRST item whose `body` matches the JS regex `new RegExp("<!-- crew:verdict:[^:]+:" + escapeRegex(result.ref) + " -->")`. Store the matching `id` as `priorReviewId: number | null`.

- (2b) **`escapeRegex` helper:** a one-liner pure function `(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`. Inline in `post-reviewer-comments.ts` or extracted to `lib/escape-regex.ts` — implementer's choice. Unit-test via the AC3 fixture.

- (2c) **PATCH path (edit-in-place):** if `priorReviewId !== null`, call `gh({ role, permissions, subcommand: "api", args: ["/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${priorReviewId}", "--method", "PATCH", "--input", "-"], input: JSON.stringify({ body: newSummaryBody }), execaImpl })`. Parse response for `id`. Return `{ next: "posted", postedReviewId: priorReviewId, wasEdit: true, priorReviewId, inlineCommentCount: 0, verdictLine }`. NOTE: on the PATCH path, the `comments` array (inline comments) from Story 4.6b is NOT re-submitted — GitHub's PATCH reviews endpoint updates the review body only; inline comments cannot be updated in bulk. v1 accepts this limitation: the inline comments from the first pass remain as-is; only the summary body is updated. Rationale: inline comments are anchored to diff lines and remain accurate across rework passes; the summary body is what changes (updated AC results, new verdict).

- (2d) **POST fallback:** if `priorReviewId === null`, the existing POST path from Story 4.6b runs unchanged (the full `{ event, body, comments }` payload). `wasEdit = false`, `priorReviewId = null`.

- (2e) **`PostReviewerCommentsResult` shape extension:** the `"posted"` variant gains two additional fields: `wasEdit: boolean` and `priorReviewId: number | null`. The `"skipped-no-session-result"` variant is unchanged.

- (2f) **GET response edge cases:**
  - Empty array (no reviews yet): `priorReviewId = null`; POST path taken.
  - Review list contains a footer marker for a DIFFERENT `ref` (same PR, different story): no match; POST path taken. Rationale: the operator may run multiple stories' reviewer passes against the same PR (unlikely in v1 but possible); the ref in the marker ensures we only update our own verdict.
  - `gh api GET` returns `GhRecoverableError` (rate limit, auth, network): propagates uncaught, same surface as all other `gh` errors in this tool.

**AC3 unpacked.** Two-run integration test:

- (3a) **Fixture base:** tmpdir with `<tmp>/.crew/state/sessions/<sessionUlid>/reviewer-result.json` populated with `{ sessionUlid, ref: "native:01HZ-fixture-story", recommendedVerdict: "READY FOR MERGE", acResults: {}, standardsByCriterionId: {}, sourceStoryRef: "native:01HZ-fixture-story", prNumber: 42, standardsVersion: "2026-05-24" }`. The `pluginVersionOverride: "1.0.0-test"` seam is used.

- (3b) **Discriminating stub routing:**
  - `gh pr diff 42` → fixture unified diff (same as Story 4.6b's stub).
  - `gh pr view 42 --json baseRepository` → `{"baseRepository":{"name":"crew","owner":{"login":"jackmcintyre"}}}`.
  - `gh api /repos/.../pulls/42/reviews --method GET`:
    - First invocation: returns `[]`.
    - Second invocation: returns `[{ "id": 1, "body": "# Reviewer summary...\n**Verdict: READY FOR MERGE**\n\n_Reviewed by crew v1.0.0-test using standards v2026-05-24._\n<!-- crew:verdict:1.0.0-test:native:01HZ-fixture-story -->" }]`.
  - `gh api /repos/.../pulls/42/reviews --method POST --input -` → `{"id":1}`.
  - `gh api /repos/.../pulls/42/reviews/1 --method PATCH --input -` → `{"id":1}`.

- (3c) **First-run assertions:** `wasEdit === false`; POST stub called once; PATCH stub NOT called; the body in the POST `input` has `<!-- crew:verdict:1.0.0-test:native:01HZ-fixture-story -->` as the last line.

- (3d) **Second-run assertions:** `wasEdit === true`, `priorReviewId === 1`; PATCH stub called once with body in `input`; POST stub NOT called on second run; the body in the PATCH `input` also has the footer marker as the last line.

- (3e) **Wrong-ref non-match:** a third test case where the GET returns `[{ id: 2, body: "<!-- crew:verdict:1.0.0:different-ref -->" }]` — asserts POST path is taken (no match for `native:01HZ-fixture-story`), `wasEdit === false`.

**AC4 unpacked.** Operator-smoke contract:

- (4a) **Smoke extension:** extend the Story 4.6b operator-smoke harness with a second `postReviewerComments` invocation. The discriminating stub follows (3b): first call's GET returns `[]`; second call's GET returns the prior verdict with the footer marker. Assert per (4b).

- (4b) **Operator-observable assertions:**
  - POST stub called exactly once across both invocations.
  - PATCH stub called exactly once on the second invocation.
  - The body in both POST and PATCH payloads contains the version line (exact-string check for `_Reviewed by crew v`) and the footer marker (`<!-- crew:verdict:`).
  - The SKILL.md prose's chat log for the second pass includes `wasEdit: true` context (the chat-line variant from Task 5).

- (4c) **Smoke-gate tag:** tagged per `plugins/crew/docs/user-surface-acs.md`. Operator may substitute manual-paste evidence per § Pre-PR gate.

---

## Tasks / Subtasks

Implementation order is load-bearing.

- [ ] **Task 1: Extend `ReviewerResultFileShape` to carry `standardsVersion`** (AC: #1)
  - [ ] 1.1 Open `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`. Add `standardsVersion: string` to the `ReviewerResultFileShape` interface. In the projection-write step (where `fileProjection` is assembled before `atomicWriteFile`), populate `standardsVersion: standards.version` (the `standards` local variable already holds the `StandardsDoc` return from `lookupStandards`). The in-memory `ReviewerSessionResult` type is NOT changed.
  - [ ] 1.2 Open `plugins/crew/mcp-server/src/lib/read-reviewer-result-file.ts` (extracted by Story 4.6b). Widen the Zod schema to include `standardsVersion: z.string().optional().default("")` for backward compatibility when reading pre-4.7 projection files. Update the return-type annotation to match.
  - [ ] 1.3 Update `process-reviewer-transcript.test.ts` and `run-reviewer-session.test.ts` fixture objects that hand-craft `reviewer-result.json` content: add `standardsVersion: "2026-05-24-test"` (or any valid string) to each. Tests relying on `.optional().default("")` do not need this but it is good practice.

- [ ] **Task 2: Extend `composeSummaryBody` with version block and footer marker** (AC: #1, #3)
  - [ ] 2.1 Open `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts`. Extend `composeSummaryBody` to accept `{ standardsVersion: string; pluginVersion: string }` as additional parameters (alongside the existing `ReviewerResultFileShape` input). Add them as a second argument object or merge into a unified options shape — match the existing function's style.
  - [ ] 2.2 After the verdict line, append:
    ```
    \n_Reviewed by crew v${pluginVersion} using standards v${standardsVersion || "(unknown)"}._\n<!-- crew:verdict:${pluginVersion}:${result.ref} -->
    ```
    The footer marker must be the absolute last character sequence in the returned string (no trailing newline).
  - [ ] 2.3 `composeVerdictLine` is unchanged — do not modify it.
  - [ ] 2.4 Extend `plugins/crew/mcp-server/src/lib/__tests__/compose-reviewer-summary.test.ts` with:
    - Version line present and in correct order (verdict line → blank line → version line → footer marker).
    - Footer marker is the absolute last line: `output.split("\n").at(-1) === \`<!-- crew:verdict:${pluginVersion}:${result.ref} -->\``.
    - Empty `standardsVersion` → renders `v(unknown)`.
    - Footer-marker ref matches `result.ref` verbatim.
    - Existing test cases updated to expect the version block appended (all existing cases now gain the version block in their expected output — this is additive and correct).

- [ ] **Task 3: Add prior-verdict search and PATCH to `postReviewerComments`** (AC: #2, #3)
  - [ ] 3.1 Open `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`. Add `pluginVersionOverride?: string` test seam (alongside existing `execaImpl?` and `pluginRootOverride?`).
  - [ ] 3.2 Import `getPluginVersion` from `../lib/plugin-version.js`. In `postReviewerComments`, call `const pluginVersion = pluginVersionOverride ?? getPluginVersion()` (sync call inside the async function is fine — it's cached after first read).
  - [ ] 3.3 After Step 4 (PR-context resolution) and before Step 5 (inline-comment generation), insert Step 4a per AC2 unpacked (2a):
    - GET existing reviews.
    - Search for prior verdict via `new RegExp("<!-- crew:verdict:[^:]+:" + escapeRegex(result.ref) + " -->")`.
    - Store `priorReviewId: number | null`.
  - [ ] 3.4 Pass `{ standardsVersion: result.standardsVersion, pluginVersion }` to `composeSummaryBody`.
  - [ ] 3.5 If `priorReviewId !== null`: PATCH path per AC2 unpacked (2c). `wasEdit = true`.
  - [ ] 3.6 If `priorReviewId === null`: existing POST path from Story 4.6b, unchanged. `wasEdit = false`.
  - [ ] 3.7 Update `PostReviewerCommentsResult`'s `"posted"` variant to include `wasEdit: boolean` and `priorReviewId: number | null`.
  - [ ] 3.8 Implement `escapeRegex` — either inline one-liner or `lib/escape-regex.ts`.

- [ ] **Task 4: Update the SKILL.md chat-log step** (AC: #4)
  - [ ] 4.1 Open `plugins/crew/skills/start/SKILL.md`. In the step that processes `postReviewerComments`'s return value (Step 7.3 added by Story 4.6b), add handling for `wasEdit`:
    - `wasEdit === true` → chat line: `reviewer-comments updated in place on PR #<prNumber>`.
    - `wasEdit === false` → existing chat line: `reviewer-comments posted on PR #<prNumber>` (unchanged from Story 4.6b).
  - [ ] 4.2 The `allowed_tools` array is NOT widened — no new MCP tools are registered by this story.

- [ ] **Task 5: Integration test suite extension** (AC: #3, #4)
  - [ ] 5.1 Extend `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` (Story 4.6b's suite) with:
    - Two-run scenario per AC3 unpacked (3a)–(3d): first run POST, second run PATCH.
    - `wasEdit: false` on POST path, `wasEdit: true` on PATCH path.
    - Footer marker is absolute last line of body in both runs.
    - Wrong-ref non-match per (3e): GET returns prior verdict for a different ref; POST path taken.
    - `pluginVersionOverride: "1.0.0-test"` used throughout.
  - [ ] 5.2 Extend the `makeDiscriminatingStub` routing (Story 4.6b's shared test helper) to handle `gh api GET .../reviews` and `gh api PATCH .../reviews/<id>` by matching `args[0]` and `args[1]`.

- [ ] **Task 6: Operator-smoke extension for AC4** (AC: #4)
  - [ ] 6.1 Extend the Story 4.6b operator-smoke harness per AC4 unpacked (4a)/(4b). Second `postReviewerComments` call with GET returning prior verdict; assert PATCH called once, POST not called on second run.
  - [ ] 6.2 Assert body contains version line and footer marker on both runs.
  - [ ] 6.3 Tag per smoke-gate convention per `plugins/crew/docs/user-surface-acs.md`.

- [ ] **Task 7: Build, vitest, dist** (AC: all)
  - [ ] 7.1 `pnpm build` passes. Commit `dist/` per CLAUDE.md.
  - [ ] 7.2 All vitest tests pass. No tool-count assertion bumped (no new MCP tools registered).
  - [ ] 7.3 `canonical-fs-guard.test.ts` still passes — this story adds only reads of `.claude-plugin/plugin.json` (already accessed by `plugin-version.ts`, which has existing tests).

---

## Behavioural contract (user-surface)

**These invariants MUST hold at all times in the running plugin. If a future change appears to break one, the change is wrong — revisit the story or open a follow-up.**

### MUST

- **MUST append a version line and footer marker to every posted summary body.** Format: `_Reviewed by crew v<pluginVersion> using standards v<standardsVersion>._` followed by `<!-- crew:verdict:<pluginVersion>:<ref> -->` as the absolute last line. Enforced by extended `composeSummaryBody` unit tests.
- **MUST search existing PR reviews for a footer-marker match before posting.** One GET call per `postReviewerComments` invocation. If found, PATCH; else POST.
- **MUST use the exact footer-marker format for both writing and searching.** The written format and the search regex MUST be kept in sync; drift in either direction breaks idempotent reruns.
- **MUST propagate `GhApiResponseShapeError`, `GhRecoverableError`, `PluginManifestMissingError` (from `getPluginVersion`), and `GhSubcommandDeniedError` verbatim.** No swallow, no retry.
- **MUST set `wasEdit: true` and carry `priorReviewId` on the PATCH path.**

### MUST NOT

- **MUST NOT post a new review when a prior verdict comment exists for the same ref.** Duplicate posting is the exact failure mode this story closes.
- **MUST NOT include the `comments` inline-comment array in the PATCH body.** GitHub's PATCH reviews endpoint updates the review body only; the `comments` array is for the initial POST. Sending it on PATCH would create duplicate inline comments.
- **MUST NOT add the footer marker or version block to inline diff-line comments.** Only the top-level summary review body carries them.
- **MUST NOT change the verdict-line grammar** from Story 4.6b's three sentinel forms. The version block is appended after the verdict line; it does not replace it.
- **MUST NOT touch sprint-status.yaml or any orchestrator-state file.**

### NEVER

- **NEVER match a prior verdict from a different story ref.** The footer-marker search regex includes the current story ref; a prior verdict for a co-located review pass on the same PR but a different story must NOT be overwritten.
- **NEVER POST a new review AND PATCH the prior one in the same invocation.** One side-effect per invocation: either PATCH (edit path) or POST (first-run path). Never both.
- **NEVER spawn subagents from `postReviewerComments` or any MCP tool.** Subagent spawn is exclusively the SKILL.md prose layer's responsibility.

---

## Implementation strategy

### Why version metadata is embedded in the body (not a separate comment)

A separate "metadata" comment would add a second PR timeline entry per review pass, compounding the stacking problem. Embedding the version line (human-readable) and the footer marker (machine-parseable HTML comment, invisible in rendered markdown) in the existing summary body keeps the PR timeline clean — one review per pass regardless of how many rework cycles occur.

### Why PATCH the existing review (not delete + re-post)

`PATCH /repos/{owner}/{repo}/pulls/{prNumber}/reviews/{review_id}` updates the body atomically. Delete + re-post would: (a) briefly remove the verdict (race with a human reading the PR), (b) reset the review's creation timestamp (losing audit trail), and (c) require two `gh api` calls instead of one. PATCH is the correct tool.

### Why inline comments are NOT re-submitted on PATCH

GitHub's reviews API `PATCH` endpoint only accepts `{ body }` — it does not support updating or appending inline comments. Inline comments on a PR review are immutable after the review is created. v1 accepts this: the inline artifact-check comments from the first pass remain accurate across rework cycles (they anchor to specific diff lines that were added in the original commit; if the dev fixes the artifact in a new commit, those lines are still present). If the diff changes significantly between rework passes, inline comments may become stale — but that is cosmetic, not a correctness issue, and is addressed by the human operator inspecting the summary body.

### Why the footer marker uses `:` as the separator (despite refs containing `:`)

The footer marker format `<!-- crew:verdict:<plugin-version>:<ref> -->` is designed to be searched with a regex that matches ANY plugin version (`[^:]+`) followed by the LITERAL ref (including its `:` separators). The search regex uses `escapeRegex(result.ref)` to match the ref verbatim, so the colon in `native:01HZ-...` is matched literally (`\:`). The `[^:]+` before it greedily matches the plugin version segment (which by semver convention contains no colons). This is unambiguous.

### Why `standardsVersion` is added to the projection file (not re-read from disk)

`postReviewerComments` could call `lookupStandards(targetRepoRoot)` again. But the projection file was designed as the single source of truth for the reviewer cycle's verdict-relevant data (Story 4.6 revision 2 rationale). Adding `standardsVersion` is consistent with that design: the file captures what the reviewer USED, not what the current standards doc says. If the operator updates `docs/standards.md` between `runReviewerSession` and `postReviewerComments`, the version stamp correctly reflects the review's actual inputs, not the current state.

---

## Locked files

Files off-limits to this story. If a change appears necessary, STOP and surface the conflict.

- `plugins/crew/mcp-server/src/tools/complete-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` (Story 4.1 / 4.2)
- `plugins/crew/mcp-server/src/tools/claim-story.ts` (Story 4.1)
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` (Story 4.6 revision 2)
- `plugins/crew/catalogue/generalist-reviewer.md` (Story 4.6)
- `plugins/crew/permissions/gh-error-map.yaml` (Story 4.5)
- `plugins/crew/mcp-server/src/lib/find-hunk-line.ts` (Story 4.6b)
- `plugins/crew/mcp-server/src/lib/plugin-version.ts` (Story 1.9; already cites Story 4.7 as a caller — use as-is, do NOT modify)
- `plugins/crew/mcp-server/src/skills/verdict-parser.ts` (Story 4.3/4.6 — `@deprecated`, no callers)

### Declared-locked-file changes (explicit exceptions)

- **`plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`** (Story 4.6) — Task 1 adds `standardsVersion: string` to `ReviewerResultFileShape` and populates it from `standards.version` in the projection-write step. Bounded: one new field on the projection object; the in-memory `ReviewerSessionResult` type is unchanged; existing tests remain green (additive field, no behaviour change to existing paths).
- **`plugins/crew/mcp-server/src/lib/read-reviewer-result-file.ts`** (Story 4.6b) — Task 1.2 extends the Zod schema with `standardsVersion: z.string().optional().default("")`. Purely additive and backward-compatible; existing `processReviewerTranscript` tests pass unchanged.
- **`plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts`** (Story 4.6b) — Task 2 adds the version block and footer marker. `composeVerdictLine` is unchanged. The `composeSummaryBody` signature gains two new required parameters; callers are updated in Task 3.
- **`plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts`** (Story 4.6b) — Task 3 inserts the GET prior-verdict search step and conditional PATCH/POST logic. The existing inline-comment generator, `skipped-no-session-result` return path, and Step 5–8 structure (inline comments, POST) are preserved; GET + conditional PATCH are inserted between Steps 4 and 5.
- **`plugins/crew/skills/start/SKILL.md`** (Stories 4.2/4.3b/4.3c/4.6/4.6b) — Task 4 adds the `wasEdit`-conditional chat line to the `postReviewerComments` result handler. `allowed_tools` is NOT widened.

---

## Dev Notes

### Files this story will create

- None required — all changes are to existing files.
- Optional: `plugins/crew/mcp-server/src/lib/escape-regex.ts` (if not inlined — implementer's choice).

### Files this story will modify

- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` (Task 1; `standardsVersion` projection field)
- `plugins/crew/mcp-server/src/lib/read-reviewer-result-file.ts` (Task 1.2; Zod schema widening)
- `plugins/crew/mcp-server/src/lib/compose-reviewer-summary.ts` (Task 2; version block + footer marker)
- `plugins/crew/mcp-server/src/lib/__tests__/compose-reviewer-summary.test.ts` (Task 2.4)
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` (Task 3; GET search + PATCH path)
- `plugins/crew/mcp-server/src/tools/__tests__/post-reviewer-comments.test.ts` (Task 5)
- `plugins/crew/skills/start/SKILL.md` (Task 4; wasEdit chat line)
- Operator-smoke harness under `plugins/crew/mcp-server/src/__tests__/operator-smoke-helpers/` (Task 6)
- `plugins/crew/mcp-server/dist/` (rebuild; commit per CLAUDE.md)

### Current-state notes on files being modified

- **`run-reviewer-session.ts`** (Story 4.6 revision 2): `ReviewerResultFileShape` projection contains `{ sessionUlid, ref, recommendedVerdict, acResults, standardsByCriterionId, sourceStoryRef, prNumber }`. The `standards.version` field is already held in-memory (it is part of `ReviewerSessionResult.standards` from `lookupStandards`). Task 1 threads it into the projection.
- **`compose-reviewer-summary.ts`** (Story 4.6b): exports `composeVerdictLine(result: ReviewerResultFileShape)` and `composeSummaryBody(result: ReviewerResultFileShape)`. Task 2 adds two parameters to `composeSummaryBody`.
- **`post-reviewer-comments.ts`** (Story 4.6b): five-to-eight-step async function. Current Step 4 resolves `owner/repo` via `gh pr view`. Task 3 inserts a new Step 4a between Step 4 and Step 5 (inline comments).
- **`plugin-version.ts`** (Story 1.9): exports `getPluginVersion(): string` and `__resetPluginVersionCacheForTests(): void`. Its JSDoc explicitly names Story 4.7 as a caller. Use it as-is.

### Testing standards

- vitest with the existing pattern: `pnpm vitest --run` from the mcp-server directory.
- `vi.fn()` / `vi.spyOn()` for stubbing; no global mocks.
- `execaImpl` / `pluginVersionOverride` test seams for all external calls.
- `__resetPluginVersionCacheForTests()` in `beforeEach` for any test touching `getPluginVersion`.
- `__resetGhErrorMapCacheForTests()` in `beforeEach` (Story 4.5 pattern).

### Dependencies

- Story 4.6 (`runReviewerSession`, `ReviewerResultFileShape`, `reviewer-result.json` shape, `standards.version` in-memory)
- Story 4.6b (`postReviewerComments`, `composeSummaryBody`, `composeVerdictLine`, `readReviewerResultFile`, `PostReviewerCommentsResult`, `GhApiResponseShapeError`, `makeDiscriminatingStub` test helper)

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md#Story 4.7`]
- [Source: `plugins/crew/docs/user-surface-acs.md`] (user-surface tag conventions)
- [Source: `_bmad-output/implementation-artifacts/4-6b-reviewer-posts-inline-comments-and-summary-verdict.md`] (the story this extends)
- [Source: `_bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md`] (projection file shape; `standards.version` note)
- [Source: `plugins/crew/mcp-server/src/lib/plugin-version.ts`] (existing `getPluginVersion()` — cites Story 4.7)
- [Source: `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts`] (current `ReviewerResultFileShape` definition)

---

## Previous story intelligence

### From Story 4.6b (just shipped / in-progress)

- `postReviewerComments` always POSTs a new review. The PATCH extension in this story replaces the POST on the edit path; the `gh api` subcommand and `--input` pipe pattern remain unchanged.
- `composeSummaryBody` is pure and unit-tested. The version-block extension adds two parameters; existing test cases gain the version block in their expected output (additive).
- The `makeDiscriminatingStub` shared helper routes by `cmd` and `args[0..1]`. Extend to route `gh api GET .../reviews` and `gh api PATCH .../reviews/<id>` in Task 5.2.

### From Story 4.6

- `standards.version` is available in the composite tool's in-memory return at the point the projection is written. The explicit note in Story 4.6 (3e): "Story 4.7 will read it for version stamping. v1 just preserves it." — Task 1 makes that actionable.
- `lib/plugin-version.ts` already exists and already names Story 4.7 in its JSDoc. No new helper needed.

### Git intelligence (recent commits)

```
798e4f6 feat(4.6): runReviewerSession — read sources, run ACs, close the rubber-stamp loop (#109)
cc4acf3 feat(4.5): gh-error-map.yaml, recoverable-error classifier, and processDevTranscript routing (#108)
30fbaea feat(4.3c): completeStory side-effect on processReviewerTranscript drains the queue (#107)
ff2d5c4 feat(4.4): Dev subagent git push and gh pr create terminal action (#106)
```

Pattern: Epic 4 commits follow `feat(4.X): <subject>`. Story 4.7's commit follows `feat(4.7): <subject>`.

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
