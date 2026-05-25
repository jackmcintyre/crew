# Story 5.1b: Dependency-aware story picker in `ship.py resolve`

story_shape: substrate

Status: backlog

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin maintainer**,
I want **the ship-story resolver to skip stories whose declared upstream dependencies haven't shipped yet, and to halt with a clear `DEPS_NOT_BUILT` signal when no other candidate is eligible**,
so that **a dev subagent can never claim a story whose upstream code doesn't exist and silently fabricate it (the 4.10b incident, 2026-05-25)**.

### What this story is, in one sentence

Add a `### Dependencies` parser to `ship.py resolve` (and to `pick_story`) that extracts referenced story-keys from a candidate's spec, looks each one up in `sprint-status.yaml`, and skips the candidate (advancing to the next `backlog` entry) if any referenced key is not at `done` — emitting a structured `DEPS_NOT_BUILT` halt with the offending refs and their current statuses when no candidate remains.

### What this story does (and why it needs its own story)

On 2026-05-25, `/ship-story` claimed story 4.10b whose spec presupposed code from stories 4.9b (`riskTier` field on `ReviewerResultFileShape`) and 4.10 (`computeAgreement` helper). Both upstream stories were spec-only on `origin/main` — no code shipped. The dev agent dutifully fabricated the missing upstream to make tests pass; the reviewer caught it as a lock violation and dead-code-in-production; the work was discarded.

The MCP-side picker (`claimNextStory` via `listClaimableTodos`) already has a dep-readiness filter — it reads `depends_on` from execution manifests and stats `done/<dep>.yaml`. The ship-story picker (`ship.py resolve` / `pick_story`) has none — it reads `sprint-status.yaml` and picks the first `backlog` entry, with no awareness of cross-story dependencies. This story closes that gap on the ship-story path; the MCP path is unchanged (it already does the right thing).

Three reasons this is its own story rather than folded into 5.1:

1. **Different surface, different failure mode.** 5.1 ships the `block-story` MCP tool — the *manual* / *programmatic* block surface (writes `blocked_by` into a manifest). This story is *picker-side detection* on the ship-story path. False-positive blocks (over-eager picker skipping a valid candidate) are this story's risk; false-negative blocks (5.1's tool refusing to block when it should) are 5.1's.

2. **Different state model.** 5.1 mutates `.crew/state/<ref>.yaml` manifests. This story reads `sprint-status.yaml` (a flat key→status map) and parses spec prose. No manifest movement, no `.crew/state/` touch.

3. **Different test surface.** 5.1 is vitest against manifest-state transitions. This story is pytest against `ship.py` (the ship-story skill's deterministic plumbing layer).

### What this story does NOT

- (a) Touch `claimNextStory`, `listClaimableTodos`, or any MCP-side claim path. Those already filter on `depsReady` via `depends_on` in the execution manifest; the silent-skip behaviour there is intentional (FR21 says the dev session keeps picking past blocked stories without waiting). Whether to ALSO auto-move the MCP-side blocked candidates into `blocked/<ref>.yaml` with `blocked_by: dep-not-built` is open question Q1 in the closing section and is deferred to a follow-up story.
- (b) Modify `sprint-status.yaml`'s schema. No new fields added. The picker keys off the existing `<story-key>: <status>` map; deps are read from each candidate's spec file.
- (c) Require all existing specs to back-fill a `### Dependencies` section. AC3 is explicit: a missing section is treated as zero declared dependencies. The new check is opt-in per spec; back-fill is left to spec authors as they touch specs for other reasons.
- (d) Adopt structured frontmatter (`requires: [4-9b, 4-10]`) as the canonical source. Open question Q2 in the closing section — current scope uses prose-only because all three specs with a `### Dependencies` section today use prose, and changing the convention is a separate authoring-discipline story.
- (e) Validate at spec-validation time (ship-story Step 5) that every new spec contains a `### Dependencies` section. Open question Q3 in the closing section — current scope keeps the section optional. A future story could promote it to required-for-new-specs via the validation gate.
- (f) Walk the full transitive dependency graph (e.g. if 5-1b depends on 5-1, and 5-1 depends on 4-3c, refuse 5-1b until 4-3c is `done`). The picker does a single-level check: every story-key in the candidate's `### Dependencies` section must be at `done`. Transitive verification is the candidate's responsibility — if 5-1 declares `4-3c`, then 5-1 will be skipped until 4-3c is done; 5-1b will be skipped until 5-1 is done. The single-level rule chains correctly without graph traversal.
- (g) Detect circular dependencies. If two specs declare each other, both are perpetually skipped. The validator (open Q3) could enforce this, but it's out of scope here.
- (h) Change `/ship-story <id>` (the targeted-pick path) to enforce deps. Targeted invocation is an explicit operator override — the operator typed the story-key, the operator owns the consequences. Only the no-arg "next eligible backlog story" path enforces deps.
- (i) Surface a `[blocked]` line via orchestration. Orchestration / `/watch` is Epic 5's domain and operates on manifests, not sprint-status. The ship-story picker is a foreground tool; its surface is the JSON halt payload returned by `ship.py resolve` and the orchestrator's stderr line.
- (j) Emit telemetry. No `picker.skip` event type. If "how often does the picker skip for dep-not-built" becomes interesting, telemetry can be added in a follow-up.
- (k) Auto-author a `### Dependencies` section in new specs. The new section is authored by hand by the spec author (or by the BMad / spec-authoring routine over time). The picker is a strict reader.
- (l) Change `pick_story`'s "prefer stories in in-progress epics" preference (line 272–275). The dep check applies AFTER the epic-preference filter has narrowed the candidate set; within the narrowed set, deps still skip ineligible candidates.

### Deferred work

- **Auto-block on the MCP path.** Currently `claimNextStory` silently skips a candidate whose `depends_on` aren't ready. A follow-up could move the manifest to `blocked/<ref>.yaml` with `blocked_by: dep-not-built` (per 5.1's taxonomy) and emit an orchestration-surface line. Decision deferred to operator review of how visible silent-skip should be (FR21 explicitly authorises silent skip; visibility is the trade-off).
- **Structured frontmatter for deps.** A future authoring-discipline story could add `requires: [4-9b, 4-10]` to spec frontmatter and have both the MCP path and the ship-story path read from there as the canonical source. The current scope keeps prose as the source-of-truth because that's what existing specs use.
- **Spec validation requires a `### Dependencies` section.** A follow-up could update ship-story Step 5's validator to flag missing-section as `fail`, forcing authors to declare deps (or to explicitly write "None") on every new spec.
- **Circular-dependency detection at validation time.** A follow-up could detect cycles when validating each spec and refuse to claim either side.
- **Transitive graph walk.** A follow-up could compute the full dep closure and report which root cause is blocking a deep candidate. v1 single-level check is sufficient and simpler.

---

## Acceptance Criteria

> AC1–AC4 are the picker-behaviour contract. AC5 is the integration suite. All five ACs are substrate — the only operator-visible surface is the structured JSON halt payload returned by `ship.py resolve`, which is consumed by the `/ship-story` skill's prose layer (not invoked directly by the operator typing on the command line in production use).

**AC1:**
**Given** `sprint-status.yaml` contains a candidate at `backlog` whose spec file contains a `### Dependencies` section listing one or more story-key references (e.g. `- Story 4.10 (computeAgreement helper) — consumed via direct function import.`),
**When** `ship.py resolve` (no `story_id` argument) considers the candidate,
**Then** the picker reads each referenced story-key from the prose section and looks each one up in `sprint-status.yaml`; if any referenced key has a status other than `done`, the candidate is skipped and the picker advances to the next `backlog` entry in declaration order.

**AC2:**
**Given** the picker has skipped one or more candidates because their dependencies were not ready AND no eligible candidate remains,
**When** `ship.py resolve` would otherwise return,
**Then** it exits non-zero with halt code `DEPS_NOT_BUILT` and a JSON payload listing each skipped candidate's `story_key`, the unmet dependency refs, and each unmet dep's current status (e.g. `{"halt":"DEPS_NOT_BUILT","skipped":[{"story_key":"4-10b-…","unmet":[{"ref":"4-9b-…","status":"ready-for-dev"},{"ref":"4-10-…","status":"ready-for-dev"}]}]}`).

<!-- Note: this halt is added to ship-story SKILL.md's halt taxonomy table; see Task 4. -->

**AC3:**
**Given** a candidate at `backlog` whose spec file has NO `### Dependencies` section,
**When** the picker considers the candidate,
**Then** it is treated as having zero declared dependencies and picked normally; pre-this-story picker behaviour is preserved for older specs.

**AC4:**
**Given** a candidate's `### Dependencies` section contains entries that are NOT story-key references (e.g. `- FR40 / FR41 / FR42 — the contract.` or `- Architecture (§ project-structure-boundaries.md line 235) …`),
**When** the picker parses the section,
**Then** non-story-key entries are skipped silently without error; only entries matching the story-key regex (`Story \d+(?:[a-z])?\.\d+(?:[a-z])?\b`) are extracted and looked up.

<!-- Regex rationale: matches "Story 4.10", "Story 4.10b", "Story 5.1", "Story 5.1b", etc. — the format used in every existing `### Dependencies` section. -->

**AC5 (integration):**
pytest covers: (a) skip on a single missing dep, (b) pass-through when all deps are at `done`, (c) no `### Dependencies` section → no skip, (d) mixed story-refs and non-story-refs (FR refs, architecture refs, file-path refs) → only story-refs are looked up, (e) chained skip (first eligible candidate has a missing dep, second is selected), (f) targeted pick `/ship-story 4-10b` bypasses the dep check (per NOT (h)), (g) halt-payload shape matches AC2 for "no eligible candidate" case.

### Expanded acceptance specifics (folded into AC1–AC5 above)

**AC1 unpacked.** The story-key regex MUST match `Story <epic>[<suffix>?].<num>[<suffix>?]` exactly, where `<suffix>` is a single lowercase letter. Examples that MUST match: `Story 4.10`, `Story 4.10b`, `Story 5.1`, `Story 5.1b`. Examples that MUST NOT match: `Story 4` (no story num), `Stories 4.10` (plural), `4.10b` (no `Story` prefix), `STORY 4.10` (case-sensitive lowercase `Story` per existing prose convention). After regex extraction, the picker normalises `4.10` → `4-10` (replacing dot with hyphen) before sprint-status lookup, because sprint-status keys use hyphenated form (`4-10-agreement-metric-helper-compute-agreement: ready-for-dev`). Lookup is *prefix-match* on the hyphenated story-key against sprint-status keys (so `4-10` matches `4-10-agreement-metric-helper-compute-agreement` but NOT `4-10b-auto-merge-gate-…`).

**AC2 unpacked.** The halt payload is printed to stdout as JSON (matching the existing `ship.py` convention — see `cmd_resolve` line 324). The exit code is non-zero (use the existing `die()` helper's convention; check `ship.py`'s `die()` for the canonical exit code). The `DEPS_NOT_BUILT` string is added to ship-story SKILL.md's halt taxonomy table as a new row with the suggested next step: "Author or ship the missing upstream stories first, or use `/ship-story <id>` to target a specific story explicitly (bypasses the dep check)."

**AC3 unpacked.** "No `### Dependencies` section" means the regex `^### Dependencies\s*$` does not match in the spec body. A section header that exists but contains no bullet-list entries (e.g. just whitespace or comments) is also treated as zero declared deps — not as an error.

**AC4 unpacked.** Non-story-ref entries to silently skip (observed in existing specs at `_bmad-output/implementation-artifacts/4-5-*.md`, `4-9b-*.md`, `4-10b-*.md` `### Dependencies` sections): `- Story 1.2 (…)` MATCHES (story-ref); `- FR40 / FR41 / FR42 …` no match (FR ref); `- Architecture (§ project-structure-boundaries.md line 235) …` no match (file ref); `- Story 4.6 (reviewer-result.json shape) — the canonical session-file transport.` MATCHES (story-ref with parenthetical detail).

**AC5 unpacked.** Test layout: a new `.claude/skills/ship-story/scripts/__tests__/test_resolve_deps.py` (or similar — see Task 5.1 for path). Use pytest, not vitest (ship.py is Python). Use tmpdir fixtures: each test seeds a minimal `_bmad-output/implementation-artifacts/sprint-status.yaml` and a few minimal `<story-key>.md` spec files with controlled `### Dependencies` sections, then invokes `pick_story` (or `cmd_resolve` via subprocess) and asserts the picked key OR the halt payload. Do NOT mock filesystem or `sprint-status.yaml`; the deterministic plumbing layer should be exercised against real files in tmpdir.

---

## Tasks / Subtasks

Implementation order is load-bearing. Each task lists its AC dependencies.

- [ ] **Task 1: Add the `### Dependencies` parser.** (AC: 1, 3, 4)
  - [ ] 1.1 In `.claude/skills/ship-story/scripts/ship.py`, add a new function `_parse_spec_deps(spec_path: Path) -> list[str]` that reads the spec file at `spec_path`, locates the `### Dependencies` section header (regex `^### Dependencies\s*$`, multiline), extracts the section body up to the next `^###?\s+` heading or end-of-file, applies the story-key regex `r"\bStory\s+(\d+[a-z]?)\.(\d+[a-z]?)\b"` to extract `(epic, num)` tuples, and returns each tuple normalised to hyphenated form (`f"{epic}-{num}"`, e.g. `"4-10"`, `"4-10b"`).
  - [ ] 1.2 Return `[]` for: a spec file with no `### Dependencies` section, an empty section, or a section with only non-story-ref entries.
  - [ ] 1.3 Spec-file path resolution: the candidate's spec is at `REPO / "_bmad-output/implementation-artifacts" / f"{story_key}.md"`. If the spec file doesn't exist, return `[]` (no deps to check — the picker proceeds as if there were no declared deps; this is consistent with AC3's "older specs without a section" behaviour).

- [ ] **Task 2: Add the dependency-readiness check.** (AC: 1, 2)
  - [ ] 2.1 Add `_resolve_deps_to_status(dep_refs: list[str], dev_status: dict[str, str]) -> list[tuple[str, str]]` that takes the normalised refs from Task 1 plus the loaded `development_status` map and, for each ref, finds the sprint-status key that begins with `f"{ref}-"` (e.g. `"4-10-"` matches `"4-10-agreement-metric-helper-compute-agreement"`). Returns a list of `(matched_full_key, current_status)` tuples. If a ref matches NO sprint-status key, treat as unresolved and return the tuple `(ref, "<not-in-sprint-status>")` (do not raise — let the caller decide; this is also how the picker reacts to a typo'd ref).
  - [ ] 2.2 Add `_unmet_deps(spec_path: Path, dev_status: dict[str, str]) -> list[dict[str, str]]` that combines the parser and resolver: returns a list of `{ref, status}` dicts for refs that are NOT at `done`. Empty list means deps are ready.

- [ ] **Task 3: Wire dep check into `pick_story`.** (AC: 1, 2, 5e, 5f)
  - [ ] 3.1 In `pick_story` (current location: `ship.py` line 262 onwards), AFTER the existing epic-preference filter (line 272–275) and BEFORE the bare `return candidates[0]` fallback (line 276), iterate the (now-narrowed) candidate list in declaration order; for each candidate, call `_unmet_deps(spec_path, dev_status)`. If empty, return that candidate. If non-empty, accumulate the skip info into a list and continue.
  - [ ] 3.2 If no candidate has empty unmet-deps, raise via `die()` with halt code `DEPS_NOT_BUILT` and the JSON payload from AC2.
  - [ ] 3.3 Targeted pick (`/ship-story <id>` — `story_id is not None`): preserve current behaviour. The dep check applies ONLY to the no-`story_id` path. See `pick_story`'s existing branching at line ~254 for the targeted-pick branch — leave it untouched.

- [ ] **Task 4: Add `DEPS_NOT_BUILT` to ship-story SKILL.md halt taxonomy.** (AC: 2)
  - [ ] 4.1 In `.claude/skills/ship-story/SKILL.md`, locate the "## Halt taxonomy" table and add a new row immediately after `NO_ELIGIBLE_STORY`: `| \`DEPS_NOT_BUILT\` | All eligible backlog stories have unshipped upstream dependencies | Author or ship the missing upstream stories first, or use \`/ship-story <id>\` to target a specific story explicitly (bypasses the dep check) |`
  - [ ] 4.2 If the SKILL.md has a "Resume after halt" or similar section that lists halt codes, add `DEPS_NOT_BUILT` there too with consistent shape.

- [ ] **Task 5: Tests.** (AC: 5)
  - [ ] 5.1 Determine the canonical pytest location for ship.py tests. If none exists today, create `.claude/skills/ship-story/scripts/__tests__/test_resolve_deps.py` and document the path choice in the spec's "References" section once decided. Use pytest + tmpdir; do NOT mock filesystem or yaml.
  - [ ] 5.2 Helper: `_seed_repo(tmpdir, sprint_status: dict[str, str], specs: dict[str, str | None])` writes a minimal `_bmad-output/implementation-artifacts/sprint-status.yaml` and one `<key>.md` per spec entry; `None` means "no spec file on disk" (Task 1.3 case).
  - [ ] 5.3 Implement test cases (5a)–(5g) from AC5. Each test is independent and self-contained (own tmpdir seed).
  - [ ] 5.4 Run the suite locally and confirm green.

- [ ] **Task 6: Author the picker's `### Dependencies` section.** (AC: 1)
  - [ ] 6.1 This spec's own `### Dependencies` section MUST list any prerequisite stories. Currently: none — the picker is self-contained, ship.py exists, sprint-status.yaml is the established source of truth. If discussion during dev surfaces an actual upstream, add it here.

---

## Dev Notes

### Files this story creates

- `.claude/skills/ship-story/scripts/__tests__/test_resolve_deps.py` (new test file; path TBD per Task 5.1)

### Files this story modifies

- `.claude/skills/ship-story/scripts/ship.py` — adds `_parse_spec_deps`, `_resolve_deps_to_status`, `_unmet_deps`, and integrates the check into `pick_story`. The diff should be additive: existing tests must continue to pass unchanged.
- `.claude/skills/ship-story/SKILL.md` — adds `DEPS_NOT_BUILT` to the halt taxonomy table.

### Files this story locks (MUST NOT modify)

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — the picker READS this file; do not change its schema or content as part of this story.
- Any existing spec file under `_bmad-output/implementation-artifacts/<key>.md` — the picker READS spec files for the `### Dependencies` section; do not edit existing specs to add/remove sections as part of this story (back-fill is a separate authoring task).
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` and `list-claimable-todos.ts` — the MCP-side dep check is intentionally unchanged (see NOT (a)).

### Current state of `pick_story` (read before editing)

`ship.py` line 262–276 implements the current pick. Key invariants:

```
1. Compute set of in-progress epics from dev_status.
2. Filter dev_status keys (story_keys helper) to those at status "backlog".
3. If any in-progress epic exists, prefer candidates whose epic is in-progress.
4. Otherwise return the first candidate in declaration order.
```

The new dep check inserts between steps 3 and 4: after epic-preference filtering, the candidate list is iterated, deps are checked per candidate, and the first candidate with empty unmet-deps is returned. If none, halt with DEPS_NOT_BUILT.

### Status-string vocabulary (read before parsing sprint-status)

`ship.py` line 377 declares the valid status strings: `"backlog"`, `"ready-for-dev"`, `"in-progress"`, `"review"`, `"done"`. The dep check considers `"done"` as the ONLY ready status. `ready-for-dev` and `in-progress` and `review` all mean the upstream code has not yet shipped (or has shipped but not yet merged); the picker MUST treat all of them as not-ready. This is intentional: dependencies are about merged-to-main code, not about queue position.

### Test conventions

- pytest, not vitest. ship.py is Python.
- tmpdir per test; no shared state.
- Do NOT mock filesystem or yaml parsing. The deterministic plumbing layer should be exercised end-to-end against real files in tmpdir.
- Seed sprint-status.yaml minimally (just `development_status:` plus the test's stories). Do not copy the production file.

### Dependencies

- Story 5.1 (`block-story` MCP tool and `blocked_by` taxonomy) — sibling. Reuses the `dep-not-built` value pinned in Story 5.1's taxonomy in spirit (the halt code `DEPS_NOT_BUILT` is the ship-story-path equivalent), but does NOT consume any code or schema from 5.1. The two stories can ship in either order.
- Story 4.3b (`claimNextStory` + `listClaimableTodos`) — pattern lineage. The MCP path's `depsReady` filter is the precedent for what "deps ready" means; this story implements the equivalent on the sprint-status side. No code import.
- Story 4.10b retro (2026-05-25) — the bug this story exists to prevent. The reviewer's `request-changes` verdict on PR (discarded) and Jack's subsequent `discard all work` decision are the motivating evidence.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-5-orchestration-recovery-visibility-and-resilience.md#Story 5.1`] — Story 5.1's `blocked_by` taxonomy including `dep-not-built`.
- [Source: `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md`] FR20, FR21 — FR21 explicitly authorises silent skip-and-proceed; this story implements that posture on the ship-story path.
- [Source: `plugins/crew/mcp-server/src/tools/list-claimable-todos.ts` lines 107–120] — the MCP-side dep-readiness pattern this story mirrors.
- [Source: `plugins/crew/mcp-server/src/tools/claim-next-story.ts` lines 70–85] — the MCP-side filter-then-skip behaviour (no auto-block).
- [Source: `.claude/skills/ship-story/scripts/ship.py` lines 262–276] — current `pick_story` implementation; the edit site.
- [Source: `.claude/skills/ship-story/SKILL.md` § Halt taxonomy] — table to extend per Task 4.
- [Source: `_bmad-output/implementation-artifacts/4-10b-auto-merge-gate-medium-high-pause-and-user-override.md` § Dependencies] — example `### Dependencies` section the parser must handle.
- [Source: `_bmad-output/implementation-artifacts/4-9b-risk-tier-classifier-code-evidence-stamping-and-fallback.md` § Dependencies] — second example.
- [Source: `_bmad-output/implementation-artifacts/4-5-gh-error-map-yaml-and-recoverable-error-classification.md` § Dependencies] — third example (covers older spec with the section).

### Previous story intelligence

This is the first story directly addressing the dependency-aware-picker problem. The motivating incident is the 4.10b ship attempt (2026-05-25, work discarded). No prior story has implemented this surface.

From Story 4.3b (shipped):
- The `depsReady` filter pattern in `listClaimableTodos` is the existing-codebase precedent. It uses execution-manifest `depends_on` (a structured field) and a filesystem stat on `done/<dep>.yaml`. This story uses a different source-of-truth (prose section in spec + sprint-status lookup) because the ship-story path operates on different state.

From Story 5.1 (epic-only, no spec yet):
- The `blocked_by` taxonomy includes `dep-not-built` as a value. The halt code chosen here (`DEPS_NOT_BUILT`) is the ship-story analogue, named consistently to ease future reasoning.

## Open questions for Jack (not blocking — surface for future decision)

These came up during analysis and are deliberately NOT in scope for this story. They are recorded here so that future planning catches them:

1. **Should the MCP path (`claimNextStory`) also auto-block?** Today it silently skips a candidate whose `depends_on` aren't ready. A follow-up story could move the manifest to `blocked/<ref>.yaml` with `blocked_by: dep-not-built` and emit an orchestration-surface line. The trade-off is FR21 ("dev session can pick next without waiting") vs. visibility — silent skip is invisible to the operator; auto-block is loud. Worth discussing once 5.1 ships and the `block-story` tool surface is real.

2. **Should `### Dependencies` become structured frontmatter (`requires: [4-9b, 4-10]`)?** Cheaper to parse, easier to grep, no regex fragility. But requires every spec to back-fill, and 30+ shipped specs would all need updates. The current story keeps prose because that's what the 3 existing specs use; a frontmatter migration is a separate authoring-discipline story.

3. **Should spec validation (ship-story Step 5) require a `### Dependencies` section?** This story leaves it optional (AC3 backward-compat). A follow-up could make it required for NEW specs (created after a chosen cutoff date), forcing authors to declare deps (or to explicitly write "None") on every new spec.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
