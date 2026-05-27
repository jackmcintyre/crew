---
date: 2026-05-27 (evening)
author: Jack (via correct-course fast-path)
scope: Minor
trigger: Deep-kettle re-plan Phase 1 — drain substrate tail before dev → main re-promotion
supersedes: none — co-exists with sprint-change-proposal-2026-05-27.md (5.13) and sprint-change-proposal-2026-05-27-5-15.md
---

# Sprint Change Proposal — Story 5.16 (scan-sources drift-on-refresh)

## 1. Issue Summary

Story 5.13 added `checkDepsDrift` to `scan-sources.ts` and wired it into two branches:
- Line 404 — blocked-branch source-hash change (operator edited a previously-blocked story).
- Line 496 — `currentState === null` fresh write (new story).

A third branch leaks: lines 592-610, the to-do source-hash refresh path entered when an existing `to-do/` manifest has a stale `source_hash`. It rewrites the manifest via `writeManagedFile` and goes directly to `result.updatedRefs.push(story.ref)` — no drift gate. An operator who edits a story spec after its first scan to introduce a prose dep that's missing from the manifest's `depends_on` will see the drift silently absorbed into the refreshed `to-do/` manifest. The downstream claim cycle then runs against a manifest the planner-validator should have refused.

No incident yet — surfaced by review of the 5.13 implementation against `scan-sources.ts` while drafting the deep-kettle re-plan.

## 2. Impact Analysis

- **Epic impact:** Epic 5. New story 5.16. No movement on other 5.x stories.
- **Story impact:** new substrate story 5.16. 5.13 stays `done` (no spec amendment — the gap was always there; 5.13 narrowed to two branches deliberately at first pass to manage scope).
- **Artifact conflicts:** none — additive.
- **Technical impact:** 1 source-file edit (`scan-sources.ts` to-do branch); 1 new integration test file. No schema changes. No telemetry changes.
- **Narrowing rationale:** the bundled draft considered 4 ACs (drift-on-refresh, `readFile` warn, leading-whitespace assertion, `skippedRefs` formatting). Per the deep-kettle plan's fail-grade-contradiction-risk note (Story 5.13 hit one at first pass), this stub is narrowed to drift-on-refresh proper. The other 3 are direct-edited where trivial or parked in `epic-5-carry-forward.md` for the next Epic 5 story that touches the same files.

## 3. Recommended Approach

**Direct adjustment.** Stub Story 5.16 in epic-5 + sprint-status, ship via `/ship-story 5-16` as a single substrate PR onto `dev`.

- **Effort:** small. ~10-line change in the to-do refresh branch + 1 new test file.
- **Risk:** low. The refusal path is a verbatim mirror of line 404's existing blocked-branch path — same helpers, same return shape, same `continue`.
- **Timeline:** in the same session window.

## 4. Detailed Change Proposals

### 4.1 Epic file — append Story 5.16 block ✅ APPLIED

`_bmad-output/planning-artifacts/epics/epic-5-orchestration-recovery-visibility-and-resilience.md` — Story 5.16 block appended after Story 5.15.

ACs at a glance (both carry `artifact:` / `vitest:` markers — guards against the AC-marker gap documented in memory):
- **AC1** — mirror line 404's `checkDepsDrift` + `writeDepsDriftBlockedManifest` shape into the to-do refresh branch at lines 592-610.
- **AC2 (integration)** — vitest covers drift introduced after first scan: drift path writes `blocked/` and preserves the `to-do/` manifest; non-drift path still updates hash idempotently.

### 4.2 Sprint status — backlog entry ✅ APPLIED

`_bmad-output/implementation-artifacts/sprint-status.yaml`: inserted `5-16-scan-sources-drift-on-refresh: backlog` between `5-15-...: done` and `epic-5-retrospective: optional`.

### 4.3 No PRD / architecture / UX changes

Substrate gap-close, not a scope change.

## 5. Implementation Handoff

**Scope:** Minor — direct implementation by `/ship-story 5-16`.

**Next actions:**
1. `/ship-story 5-16` — full BMad cycle on `dev`.
2. Merge the resulting PR.
3. Proceed to Phase 1's direct edits (D1, D2, M1, M2, A3 per the deep-kettle plan) — order doesn't matter relative to the ship.
4. Phase 2 (`dev → main` ff-promotion) once Phase 1 is complete.

**Success criteria:**
- `scan-sources.ts` to-do refresh branch calls `checkDepsDrift` before rewriting.
- New integration test green; would have failed before the change.
- `pnpm test` green overall.
- No regression in existing `scan-sources` tests.
