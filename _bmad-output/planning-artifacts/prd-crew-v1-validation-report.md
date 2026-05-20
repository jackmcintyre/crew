---
validationTarget: '_bmad-output/planning-artifacts/prd-crew-v1.md'
validationDate: '2026-05-19'
inputDocuments:
  - CLAUDE.md
  - _bmad-output/planning-artifacts/roadmap.md
  - _bmad-output/planning-artifacts/planning-discipline.md
  - _bmad-output/planning-artifacts/brief-continuous-flow-model.md
  - _bmad-output/planning-artifacts/brief-retros.md
  - _bmad-output/planning-artifacts/prd-ai-reviewed-prs-pattern-a.md
validationStepsCompleted: ['step-v-01-discovery', 'step-v-02-format-detection', 'step-v-03-density-validation', 'step-v-04-brief-coverage-validation', 'step-v-05-measurability-validation', 'step-v-06-traceability-validation', 'step-v-07-implementation-leakage-validation', 'step-v-08-domain-compliance-validation', 'step-v-09-project-type-validation', 'step-v-10-smart-validation', 'step-v-11-holistic-quality-validation', 'step-v-12-completeness-validation', 'step-v-13-report-complete']
validationStatus: PASS_RECOMMENDATIONS_APPLIED
validationStatus: IN_PROGRESS
---

# PRD Validation Report

**PRD Being Validated:** _bmad-output/planning-artifacts/prd-crew-v1.md
**Validation Date:** 2026-05-19

## Input Documents

- PRD: prd-crew-v1.md (810 lines, 104K)
- CLAUDE.md (project instructions)
- roadmap.md
- planning-discipline.md
- brief-continuous-flow-model.md
- brief-retros.md
- prd-ai-reviewed-prs-pattern-a.md (predecessor PRD)

## Validation Findings

## Format Detection

**PRD Structure (Level 2 headers in order):**
1. Executive Summary
2. Project Classification
3. Success Criteria
4. Product Scope
5. User Personas
6. User Journeys
7. Domain-Specific Requirements
8. Innovation & Novel Patterns
9. Claude Code Plugin — Project-Type Requirements
10. Project Scoping
11. Functional Requirements
12. Non-Functional Requirements

**BMAD Core Sections Present:**
- Executive Summary: Present
- Success Criteria: Present
- Product Scope: Present
- User Journeys: Present
- Functional Requirements: Present
- Non-Functional Requirements: Present

**Format Classification:** BMAD Standard
**Core Sections Present:** 6/6

Bonus sections beyond the 6 core: Project Classification, User Personas, Domain-Specific Requirements, Innovation & Novel Patterns, Project-Type Requirements, Project Scoping — all expected/optional BMAD sections.

## Information Density Validation

**Anti-Pattern Violations:**

- **Conversational Filler:** 0 occurrences (scanned: "The system will allow users to...", "It is important to note that...", "In order to", "For the purpose of", "With regard to")
- **Wordy Phrases:** 0 occurrences (scanned: "Due to the fact that", "In the event of", "At this point in time", "In a manner that")
- **Redundant Phrases:** 0 occurrences (scanned: "Future plans", "Past history", "Absolutely essential", "Completely finish")

**Total Violations:** 0

**Severity Assessment:** Pass

**Recommendation:** PRD demonstrates excellent information density. Zero anti-pattern violations across all categories — every sentence carries weight without filler.

## Product Brief Coverage

**Briefs evaluated:** brief-continuous-flow-model.md, brief-retros.md (treated as component briefs — PRD synthesises both)

### Coverage Map — brief-continuous-flow-model.md

- Vision (continuous flow over sprints, primed backlog): **Fully Covered**
- Target users (Jack, agent-paced work): **Fully Covered**
- Problem statement (time-boxing creates artificial friction): **Fully Covered**
- Three concurrent sessions (Planning/Dev/Orchestration): **Fully Covered** — FR15, FR16, FR23
- Directory-as-state-machine (atomic mv): **Fully Covered** — FR9, FR17-22; NFR8
- Story file shape + frontmatter: **Fully Covered** — FR10-13
- Embedded dependency resolution: **Fully Covered** — FR18
- Blocker handling (flag-and-move-on): **Fully Covered** — FR20, FR21, FR49-54; Journey 4
- Risk-tiered PR handling: **Fully Covered** — FR40-42
- Goals: **Fully Covered**
- Differentiators (filesystem coordination): **Fully Covered** — NFR19
- Constraints (3x token cost, 3x failure surface): **Fully Covered** — NFR7
- Open question: risk-tier concrete rules (path/change-type/diff-size): **Partially Covered** — risk_tier referenced as story field but path/change-type/diff-size rules not encoded. **Severity: Moderate**
- Open question: story claim mechanism: **Fully Covered** — FR17, NFR8
- Editor's note: replace vs run-alongside sprint-orchestrator: **Fully Covered** — Project Classification treats sprint-orchestrator as stepping-stone

### Coverage Map — brief-retros.md

- Vision (story + cycle retros, rule registry, outcome verification): **Fully Covered**
- Target users (Jack as retro consumer): **Fully Covered** — Journeys 5, 6
- Problem statement (quality drift without retros): **Fully Covered** — Strategic Risk 2
- Story-level retro signals: **Fully Covered** — FR11, FR55
- Lessons capture — `lessons[]` with kind taxonomy (pitfall/pattern/tool-quirk/discipline): **Partially Covered** — `lessons[]` present but the four-kind taxonomy isn't pinned in FRs. **Severity: Moderate** (two-section retro output depends on it)
- Locked elicitation prompt: **Not Found** — **Severity: Informational** (implementation detail)
- Failure-class tagging: **Fully Covered** — FR11, FR55, FR64
- Sprint archival: **Fully Covered** — FR69
- Promotion threshold (default 2 occurrences): **Partially Covered** — detection present but default-2 threshold not pinned. **Severity: Informational**
- Rule registry (`discipline-rules.yaml`): **Fully Covered** — FR48, FR62
- Outcome verification (`computeOutcomeStats`): **Fully Covered** — FR68, NFR23, FR110
- Cycle-level retro subagent (read-only): **Fully Covered** — FR57-60
- Two-section output (rules + skills): **Fully Covered** — FR59
- Apply step (user-gated diff-then-confirm): **Fully Covered** — FR61-63
- Eight-step loop coverage (Observe → Categorise → Detect → Propose → Approve → Promote → Measure → **Retire**): **Partially Covered** — Retire step missing. **Severity: Moderate** (no automated rule retirement)
- Goals (failure classes down, rule count flat/shrinking): **Fully Covered**
- Differentiator (retros propose skills + rules + team changes): **Fully Covered** — FR59
- Constraints (retro agent has no write access): **Fully Covered** — FR60
- Open question: auto-fire vs user-invoked: **Intentionally Excluded** — PRD picks user-invoked (FR56)
- Open question: inline vs sidecar retro storage: **Intentionally Excluded** — FR11 inlines
- Relationship with `bmad-retrospective`: **Not Found** — **Severity: Informational**

### Coverage Summary

- **Total elements assessed:** 36
- **Fully Covered:** 29 (~81%)
- **Partially Covered:** 4 (~11%)
- **Not Found:** 2 (~6%)
- **Intentionally Excluded:** 2 (~6%)
- **Effective coverage (Fully + Intentionally Excluded):** ~86%

**Gap severity:**
- Critical: 0
- Moderate: 3 (risk-tier concrete rules; lesson `kind` taxonomy; rule retirement step)
- Informational: 3 (elicitation prompt text; promotion threshold default; bmad-retrospective relationship)

**Recommendation:** Strong coverage. Close three Moderate gaps before authoring stories:
1. Add FR pinning the lesson `kind` taxonomy (pitfall/pattern/tool-quirk/discipline).
2. Add FR covering rule retirement (unfired-for-M-cycles → retirement proposal).
3. Defer risk-tier rule encoding to architecture but flag explicitly as v1 design deliverable.

## Measurability Validation

### Functional Requirements

**Total FRs Analysed:** 110

**Format compliance:** Strong. Nearly all FRs use testable "[Actor] can [capability]" form.

**Subjective/vague phrasing (4):**
- FR3 (line 605): "without further user editing **in the common case**" — undefined frequency
- FR49 (line 669): "every **couple of** minutes" — should pin a default (e.g., 120s)
- FR77 (line 709): "plain language understandable by a non-engineer who **can read code at skim level**" — unmeasurable
- FR100 (line 741): "routed by the runtime without user mediation **in the common case**" — undefined

**Vague quantifiers (1):**
- FR2 (line 604): "a candidate **set** of stories" — no min/max

**Implementation leakage (0):** `gh`, `git`, `mv`, `yaml`, `JSONL` references are contract-level and explicitly scoped by the PRD preamble; not a violation.

**FR violations total:** 5

### Non-Functional Requirements

**Total NFRs Analysed:** 29

**Strong (metric + method + context):** NFR1-5 — explicit numeric thresholds and conditions.

**Missing measurement method (5):**
- NFR6 (line 770): "100% of agent invocations produce a visible artifact" — no log assertion / test harness named
- NFR7 (line 771): "resumes cleanly... without data loss or duplicated work" — no method
- NFR9 (line 773): "never mutates... done-shaped to failed-shaped" — method unspecified
- NFR10 (line 774): "safe... never duplicates or corrupts" — method unspecified
- NFR18 (line 788): "classifies it as recoverable" — no threshold for "recoverable"

**Missing metric (1):**
- NFR25 (line 798): "**human-readable**" — subjective; mitigated by "plain Markdown" but no objective measure

**NFR violations total:** 6

### Overall Assessment

**Total Requirements:** 139 (110 FR + 29 NFR)
**Total Violations:** ~11

**Severity:** Warning (borderline; the violation rate is ~8% of requirements which is excellent for a PRD of this size)

**Recommendation:**
1. Tighten five reliability NFRs (6, 7, 9, 10, 18) by appending a measurement-method clause naming the verification harness (e.g., "verified by integration test suite asserting log entry per invocation") so the absolutes become falsifiable.
2. Replace "in the common case" in FR3 and FR100 with a measurable target (e.g., "≥90% of runs over rolling 20-cycle window").
3. Make FR49 concrete: "default 120s, configurable" instead of "every couple of minutes".
4. FR77's plain-language criterion needs an objective proxy or should be demoted to a non-testable guideline in the preamble.

No structural rework needed — surgical edits.

## Traceability Validation

### Chain Validation

- **Executive Summary → Success Criteria:** Intact. Five novelty pillars (self-forming team, persona memory, stay-in-lane protocol, calibration loop, continuous flow) map to measurable outcomes (lines 102-111) and the canonical-scenario test (line 72).
- **Success Criteria → User Journeys:** Intact. Every criterion has journey support — primed-and-walked-away → Journey 1; external user succeeds → Journey 2; retro told me something → Journey 5; skim-merge trust → Journey 1; agreement ≥80% → Journey 5; team-change calibration → Journey 6.
- **User Journeys → FRs:** Intact. All six journeys covered. Journey 2's "translate-a-reviewer-comment" gap (line 231) closed by FR76 and FR109; Journey 3 by FR8, FR78; Journey 6 by FR105-110.
- **Scope (MVP) → FRs:** Intact. Every MVP item (lines 119-130) maps to FRs.

### Orphan Elements

- **Orphan FRs:** 0 — FR14 and FR42 support stated NFR/risk-tier philosophy without being explicit journey items; acceptable.
- **Unsupported Success Criteria:** 0
- **User Journeys Without FRs:** 0

**Severity:** Pass

**Recommendation:** Traceability chain is intact — all requirements trace to user needs or business objectives.

## Implementation Leakage Validation

Scoped exemption (per PRD preamble): `gh`, `git`, `mv`, `yaml`, `JSONL` are contract-level and not flagged.

**Other potential leakage found:** 0
- `discipline-rules.yaml`, `PERSONA.md`, `docs/standards.md` — filesystem contracts, not tech-stack
- "MCP server" (line 456) — the project type, not leakage
- No DB / framework / language names appear (no Python, Node, React, Postgres, Redis, etc.)

**Severity:** Pass

## Domain Compliance Validation

**Domain:** developer tooling / AI agent orchestration (not healthcare/fintech/govtech/e-commerce)

PRD explicitly disclaims regulated-domain data flow at line 313. No HIPAA/PCI/GDPR concerns; trust-calibration risks correctly handled under Domain-Specific Requirements instead.

**Status:** N/A — domain-specific compliance frameworks do not apply to this project type.

## Project-Type Compliance Validation (claude-code-plugin)

§ Project-Type Requirements (line 401) is substantive and covers:
- **Install path:** "clone repo, load plugin, no npm" (line 407, FR71)
- **Command surface (skills):** Nine slash-commands enumerated lines 446-454 with idempotency notes
- **Agents:** Catalogue vs persona file split lines 428-431 with concrete paths
- **MCP boundary:** Tools enumerated lines 458-466
- **Permissions:** FR79-81 plus NFR12-16 cover tool allowlists per role
- **Local-first / telemetry:** lines 481-489 and NFR15

**Minor gap:** Claude Code **hooks** not explicitly addressed. Plugin uses skills + MCP rather than hooks, so likely intentional. Recommend adding one line ("no Claude Code hooks in v1") at ~line 497 for symmetry. **Severity: Informational.**

**Status:** Pass

## SMART Validation

**FR sample (10):** FR2, FR13, FR18, FR27, FR34, FR40, FR46, FR62, FR68, FR100
- All Specific and Traceable. Strong Measurability on FR13, FR18, FR34, FR40, FR46, FR62, FR68.
- FR2 ("interpret free-form intent into candidate stories") borderline — testable via output presence; acceptable at capability-contract level.
- **Non-SMART count: 0/10**

**NFR sample (5):** NFR1, NFR2, NFR5, NFR6, NFR12
- All have concrete thresholds (3 min, 8 min, 1 hour, 100%, allowlist enforcement). SMART.
- **Non-SMART count: 0/5**

**Overall non-SMART: 0/15. Severity: Pass.**

## Holistic Quality Validation

- **Coherence:** Strong. Vision-to-requirements arc is the strongest section: "rigour is the product" → calibration loop → standards + retros + team changes → FR55-64 + FR105-110.
- **Dual audience:** Reads well for humans (PM-language, plain prose) and LLMs (FRs atomically numbered, locked phrases quoted verbatim, frontmatter fields enumerated).
- **Contradictions:** None material. Mild tension at line 158/159 (standards doc must come from observed misses, but ship example template) is correctly resolved — template ≠ default. FR47 codifies this.
- **Length:** 810 lines; dense but justified by 110 FRs + 29 NFRs.

**Severity:** Pass

## Completeness Validation

All required sections present and substantive:
- Executive Summary (line 31): substantive with core insight + differentiator moment articulated
- Personas (line 164): three personas including non-human team
- Six full journeys with rising-action/climax/resolution structure
- Innovation (line 359): explicit market landscape and risk-mitigation
- Strategic Risks (line 555): top three with mitigations

**Minor thin spots:**
1. **Claude Code hooks** — not addressed in plugin requirements. Add one sentence.
2. **Versioning / release cadence** — no FR/NFR on plugin's own version-stamp beyond "clone the repo." Worth a one-line note under §Install. **Severity: Informational.**

No critical omissions for a v1 PRD.

**Severity:** Pass

---

# Final Validation Summary

**Overall Status:** ✅ **PASS** (with minor recommendations)

| Check | Severity |
|---|---|
| Format Detection | BMAD Standard, 6/6 |
| Information Density | Pass (0 violations) |
| Brief Coverage | ~86% effective coverage, 0 Critical / 3 Moderate / 3 Informational gaps |
| Measurability | Warning (~11 violations, ~8% of 139 requirements) |
| Traceability | Pass (0 orphans) |
| Implementation Leakage | Pass (0 non-scoped leakage) |
| Domain Compliance | N/A (developer tooling) |
| Project-Type Compliance | Pass |
| SMART | Pass (0/15 non-SMART in sample) |
| Holistic Quality | Pass |
| Completeness | Pass |

### Consolidated Recommendations

**Before authoring stories (Moderate — close these):**
1. **Lesson `kind` taxonomy** — add an FR pinning the pitfall/pattern/tool-quirk/discipline taxonomy (the two-section retro output depends on it).
2. **Rule retirement step** — add an FR covering rules unfired for M cycles → retirement proposal; completes the eight-step retro loop.
3. **Risk-tier rules** — defer concrete path/change-type/diff-size rules to architecture but flag explicitly as v1 design deliverable.

**Measurability tightening (Warning — surgical edits):**
4. Tighten NFR6, NFR7, NFR9, NFR10, NFR18 with explicit measurement-method clauses.
5. Replace "in the common case" in FR3 and FR100 with concrete metrics.
6. Make FR49 concrete ("default 120s, configurable").
7. Demote FR77's plain-language criterion to non-testable guideline.

**Optional polish (Informational):**
8. Add "no Claude Code hooks in v1" one-liner to project-type section.
9. Add one-line note on plugin versioning under §Install.

**Verdict:** PRD is in unusually good shape. No structural rework needed. Recommendations 1-3 should land before story-authoring; 4-7 can land in the same pass; 8-9 are optional polish.

---

## Recommendations Applied (2026-05-19)

All 9 recommendations from this validation have been applied to the PRD via `/bmad-edit-prd`:

| # | Recommendation | Location |
|---|---|---|
| 1 | Lesson `kind` taxonomy (pitfall/pattern/tool-quirk/discipline) | FR11 expanded |
| 2 | Rule retirement step (M-cycle staleness → retirement proposal) | New **FR64a** |
| 3 | Risk-tier classification rules flagged as v1 architecture deliverable | New **FR40a** |
| 4 | NFR6, NFR7, NFR9, NFR10, NFR18 — measurement methods added | NFR bodies extended |
| 5 | FR3 "in the common case" replaced with ≥90% rolling-20-cycle metric | FR3 rewritten |
| 6 | FR100 "in the common case" replaced with explicit routing logic | FR100 rewritten |
| 7 | FR49 polling cadence pinned ("default 120 seconds; configurable") | FR49 |
| 8 | FR77 demoted to non-testable guideline | FR77 reframed |
| 9 | "No Claude Code hooks in v1" + plugin versioning note | Project-Type §Implementation Considerations |

**Knock-on changes:**
- FR35 extended to stamp plugin semantic version alongside standards-doc version
- NFR22 retitled "Standards and plugin version traceability" and extended

**Post-edit status:** Ready for story authoring. All Moderate gaps closed; all Warning-tier measurability issues addressed; Informational polish landed.


