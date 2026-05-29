# Epic 8: Stateless Workflow Substrate — Stage-1 Dogfood

**Goal:** crew autonomously builds crew. One fully-autonomous stateless `drain` workflow run, on crew's own repo, takes a real low-risk story claim→dev (writes code, opens a real PR)→reviewer (judges against the story's ACs + `docs/standards.md`)→verdict (derived from the reviewer-result **file**)→green "READY FOR MERGE" with **zero human intervention up to the green PR; a human merges** (Stage 1). This epic delivers the stateless orchestration substrate (the pivot) and the soonest "crew builds crew" proof-point.

> **Source of truth:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-29-workflow-pivot.md` and `_bmad-output/design-briefs/aiet-on-workflows-build-brief-2026-05-29.md`.
>
> **These story blocks are intentionally thin stubs** (title + one-line scope only). Per the never-hand-write rule, `/ship-story`→`bmad-create-story` authors each full spec (user-story + acceptance criteria) into the implementation-artifact. Do **not** hand-author ACs here.
>
> **Sequencing:** 8.1 + 8.2 first (unblock-everything, pivot-independent fixes), then 8.3/8.4, then 8.5, then 8.6. 8.2 (AC-regex) and 8.4 (CLI) are the true blockers for the drain.

---

## Story 8.1: Commit-scope regex accepts real story refs

Scope: `plugins/crew/mcp-server/src/lib/git.ts` — the conventional-commit subject scope `[a-z0-9-]+` rejects every real ref (`bmad:1.1`, `native:<ULID>`); widen to `[A-Za-z0-9._:-]+`. Fix already staged in worktree `wf-drain-fix`. Pivot-independent; unblocks every dev commit. (Proposal M0.)

## Story 8.2: Reviewer AC-heading regex alignment

Scope: `plugins/crew/mcp-server/src/lib/extract-acs-from-spec.ts` — the reviewer's AC-heading regex rejects em-dash descriptive headings (`**AC3 — title:**`) that the BMad parser accepts, so the reviewer matches **zero** ACs and "verifies" nothing (41 headings affected in crew's own backlog). Align to the BMad em-dash-aware pattern; add a **parity test** vs the BMad parser. The critical correctness fix. (Proposal M1.)

## Story 8.3: Agent-discipline — evidence-only dev/reviewer

Scope: `plugins/crew/catalogue/generalist-dev.md` + `generalist-reviewer.md` (and their `team/` copies) — forbid agents from writing the execution manifest/state (evidence-only: code, PR, transcript), while **preserving full reasoning latitude**. Closes the manifest-corruption the spike hit (`parseExecutionManifest` `.strict()` throw). (Proposal M2.)

## Story 8.4: Productionise the CLI shim

Scope: `plugins/crew/mcp-server/src/cli.ts` (currently untracked) — commit it; wire the two missing seam tools (`processReviewerYield`, `scanOrphanedInProgress`); rebuild `dist`; add a smoke test. This is the one-shot CLI the drain's seam-agents call (no daemon on the drain path). (Proposal M3.)

## Story 8.5: Stateless drain workflow

Scope: `plugins/crew/workflows/drain.workflow.js` (net-new) — the serial stateless drain per build brief §4.4, scoped to one story for v1; `haiku` seam-agents over the CLI shim; dev agent in its own worktree (cwd = repo root for `gh`); verdict from the reviewer-result file; tunables parameterised (not hardcoded). Skips orphan-recovery + yield for v1. (Proposal M4.)

## Story 8.6: Bootstrap story + dogfood run

Scope: author a real low-risk bootstrap story (via `bmad-create-story`), prime it via `scanSources`, clear the pre-existing `bmad:6.2` orphan, run `drain.workflow.js` (`maxStories:1`), and verify the green PR **and** that `reviewer-result.json` `acResults` is non-empty and all-pass (proves real AC verification, not a false green). The proof-point. (Proposal M5.)

## Story 8.8: Native scan arms loudly on unmatched story files

Scope: `plugins/crew/mcp-server/src/adapters/native/index.ts` — `listNativeStoryFiles` silently drops every `.md` whose name doesn't match the ULID pattern, so a misnamed story vanishes and a directory of only-misnamed files scans to zero with no signal (the `nothingMatched` gap). Surface the unmatched basenames so the scan can report them loudly instead of returning a silent all-zero. Pure, additive, unit-testable. Second Stage-1 dogfood story — re-validates the autonomous loop + CI after the base-branch fix (#191).
