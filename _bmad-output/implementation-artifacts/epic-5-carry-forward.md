# Epic 5 — Carry-Forward Log

> A running list of named follow-ups surfaced during Epic 5 work but **not yet sized into stories**. Each entry says where to fold it in when the right Epic 5 story touches the same area. This log is the alternative to either (a) opening a chore PR per follow-up or (b) letting them rot in commit messages.
>
> **Rule for additions:** if you discover a follow-up that doesn't warrant its own story but shouldn't be lost, append an entry here with a target story or `unscheduled` if no obvious carrier exists. Don't bundle into a substrate ship without a deliberate plan — that's the 5.13-class fail-grade-contradiction trap.
>
> **Started:** 2026-05-27 (deep-kettle re-plan Phase 1, Artefact A3).

## Active entries

### 1. `scan-sources.ts` `readFile` warn-instead-of-throw

**Surface:** Story 5.13 review feedback (Low).
**Touch site:** `plugins/crew/mcp-server/src/tools/scan-sources.ts` — the `readFile` call in the to-do branch (around lines 579-590) currently lets errors propagate. Lower-severity recovery would be to warn and skip the manifest rather than abort the whole scan pass.
**Fold into:** next Epic 5 story touching `scan-sources.ts`. Story 5.16 is touching it (drift-on-refresh) but is deliberately scoped to drift only — do NOT bundle. Next candidate: Story 5.2 (heartbeat-based session liveness) does not touch this file; Story 5.1 doesn't either. **Unscheduled — likely first Epic 5 backlog story to land that touches `scan-sources.ts` outside drift work.**

### 2. `renderScanResult` leading-whitespace assertion

**Surface:** Story 5.13 review feedback (Info).
**Touch site:** `plugins/crew/mcp-server/src/tools/scan-sources.ts` (search for `renderScanResult`). Add a test-side assertion that rendered output lines have no leading whitespace (cosmetic guarantee for terminal output).
**Fold into:** next Epic 5 story that adds rendered output to the scan surface.
**Unscheduled.**

### 3. `skippedRefs` formatting consistency

**Surface:** Story 5.13 review feedback (Info).
**Touch site:** `scan-sources.ts` — `result.skippedRefs.push({...})` call sites (currently 3-4) format `detail` strings differently between branches. Pick one format (e.g. `kind: payload` vs `payload`) and apply uniformly.
**Fold into:** next Epic 5 story touching the `skippedRefs` push paths.
**Unscheduled.**

### 4. `.d.ts` Zod-determinism investigation

**Surface:** Tripped preflight 3× — Story 5.12 ship, Phase E pre-promotion, deep-kettle Phase 1 start. The committed `plugins/crew/mcp-server/dist/*.d.ts` files show pure key-ordering churn (`medium` / `low` swap inside Zod enum inference output) between local `tsc` rebuilds and the committed copy. Cosmetic — runtime types identical — but trips the working-tree-clean invariant.
**Workaround:** `git restore plugins/crew/mcp-server/dist/` before any clean-tree check.
**Fold into:** standalone Epic 5 substrate story when convenient. Not gating any Phase 3 progress. Investigation budget: small (2-3 hours likely). Likely fix: pin Zod version + lockfile cleanup, or a deterministic-emit shim in the build step.
**Unscheduled — promote to story 5.17 candidate if it trips a fourth time.**

### 5. Reviewer `gh pr comment` PR-scope guard (originally "7a")

**Surface:** Deep-kettle plan deferral (originally from the pre-Epic-5 enhancement plan).
**Issue:** reviewer's `gh pr comment` calls don't currently constrain themselves to the PR under review; a bug could surface comments on adjacent PRs. Not observed in canary; guard would be belt-and-braces.
**Fold into:** Epic 5 backlog only if `/crew:start` on a real story (Phase 3) surfaces a defect; otherwise defer to Epic 6→7 boundary.
**Unscheduled.**

### 6. Standards-criterion cross-check in reviewer summary (originally "7b")

**Surface:** Deep-kettle plan deferral.
**Issue:** reviewer summary doesn't currently cross-check against the standards doc's criteria. Belt-and-braces; only relevant if auto-merge gate is re-enabled in scope.
**Fold into:** Epic 5 backlog only if auto-merge gate re-enable becomes scope.
**Unscheduled.**

### 7. Reviewer-contract change (carried debt — memory M2 captures rationale)

**Surface:** Deep-kettle plan, carried-debt decision 2026-05-27.
**Issue:** deterministic AC verification (reviewer LLM parses ACs for `artifact:` / `vitest:` markers, gates verdict on regex/grep-shaped checks) is structurally misaligned with content-trivial ACs — trailing-newline judgement on `hello.md`, blank-line removal on specs, locked-phrase grammar drift. Each fix accretes another convention. Meta-grammar tax that compounds for the non-engineer target user.
**Why deferred:** Epic 5 backlog is internal-API substrate where deterministic AC verification fits cleanly. Fragility becomes acute at Epic 7 (canary install, plain-language pass, first-run polish) where ACs describe end-user observation.
**Fold into:** dedicated planning round at Epic 6→Epic 7 boundary. Hard-required before Epic 7 ships.
**Do not** add new AC-marker conventions during Epic 5 to paper over this — capture each new instance here instead. See memory `feedback_reviewer_contract_carried_debt`.

### 8. Orphan-recovery missing reviewer-only branch (Folded into 5.20)

**Surface:** Canary-1 (bmad:5.19) Path B closeout, 2026-05-27. See memory `project_orphan_recovery_no_reviewer_only_branch`.
**Issue:** `/crew:start`'s orphan-recovery branch only handled the dev-incomplete + replay shape; when an orphan was found with dev already shipped (PR open and green) and only the reviewer side missing, the loop fell through to Path B manual closeout instead of respawning just the reviewer.
**Fold into:** Story 5.20 (shipped 2026-05-27, PR #166) — adds the reviewer-only respawn branch when manifest has a PR but no reviewer transcript.

### 9. Reviewer first-tool-call enforcement gap (Folded into 5.21)

**Surface:** Canary-1 (bmad:5.19) reviewer-skip incident, 2026-05-27. See memory `project_reviewer_first_call_enforcement_needed`.
**Issue:** the reviewer subagent reasoned around its persona prose mandate ("MUST call `runReviewerSession` first") and skipped the call under load. Manifest never progressed to verdict; operator forced into manual recovery. Persona prose alone is not load-bearing for orchestration enforcement — repeats the prose-mandate-vs-deterministic-seam pattern Jack flagged in `feedback_default_to_deterministic_seams` and `feedback_prose_mut_steps_need_seam`.
**Fold into:** Story 5.21 — either inject `runReviewerSession` from spawning orchestration OR fail-loud post-spawn if `agent_invokes` lacks the call. Persona prose stays as belt-and-braces.

## Promotion history

> Phase 2 (`dev → main` ff-promotion) records appended here as they happen, per deep-kettle plan Artefact P2.

- **2026-05-27 — `pre-dogfood-resumption-2`** at HEAD `6f70f09` (ff-only from `dev`). Contents: 5.15 stub + ship (PR #160), 5.16 stub + ship (PR #161), D1/D2/A3 chore bundle, dist rebuild for D2. Ruleset 16642015 relax → ff-promote → restore cycle ran clean — no auto-mode classifier block on `git checkout main` (M1 narrowing held). `.d.ts` Zod-determinism drift reappeared on `dev` post-checkout (4th occurrence — entry 4 above is now eligible for promotion to story 5.17 per its "fourth time" trigger).
