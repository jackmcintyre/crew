# Epic 9: Intake & Judging — The Planning Cockpit

**Goal:** A non-engineer drives the front half of the pipeline. The operator proposes, specifies, and sequences features in plain language; the team drafts each into a story; a diverse judge panel plus a dedicated Quality Lead grade the draft against the rubric; only blessed stories become `ready`; and the drain claims **only** `ready` stories. This is gate 1 (intake) feeding gate 2 (the drain) — the same project-shaped team produces and judges at both gates. The grouping tables become a generated view of intake state, not a hand-kept file. The MVP runs on the **current BMad substrate**; owning a strict native story format is a later re-foundation (see the design note).

> **Source of truth:** `_bmad-output/planning-artifacts/design-note-2026-05-31-native-planning-and-judging.md` (the two-gate generate-and-judge architecture, the Quality Lead role, and the two-tier rubric). Reuses the Epic 2 team/persona layer, the Epic 3 adapter/manifest/scan layer, and the Epic 6 standards/rubric surface; supersedes Epic 3's one-shot `/plan` as the **ongoing** planning surface.
>
> **These story blocks are intentionally thin stubs** (title + one-line scope only). Per the never-hand-write rule, `bmad-create-story` authors each full spec (user-story + acceptance criteria) into the implementation-artifact. Do **not** hand-author ACs here.
>
> **Sequencing:** 9.1 first (the spine — readiness brake; needs no rubric). Then 9.2 (author seam). Then 9.3 (judge panel) → 9.4 (Quality Lead) → 9.5 (dashboard). Drain in small serial batches. State lives in the existing sprint-status ledger + manifests — one source of truth, no parallel store.
>
> **The rubric these stories grade against:** `_bmad-output/planning-artifacts/rubric-story-quality-2026-05-31.md` — the canonical, evolvable grading artifact (Tier 0 deterministic veto + Tier 1 panel lenses, with worked pass/fail examples). 9.2 drafts *to pass* it; 9.3 *scores* against it; 9.4 *owns* it. When 9.2/9.3 are authored via `bmad-create-story`, that file path belongs in each spec's References section so the author/judge loads it by name rather than reinventing a rubric.

---

## Story 9.1: Readiness brake + minimal intake cockpit

Scope: introduce an explicit operator-controlled `ready` state distinct from "exists in the backlog," and make the drain's claim path select **only** `ready` stories. Add the minimal operator surface to list the backlog with its readiness/dependency state and flip a story to `ready` (and back). The spine the rest of the epic hangs off; ships the readiness brake with **no judging** — the operator blesses by hand for now. (Proposing new features → 9.2; ordering/sequencing → 9.5.) *Observable spine: a non-`ready` story is never claimed by the drain; flipping it to `ready` makes the drain pick it up.* Needs no rubric. (Slice 1.)

## Story 9.2: Author seam — feature to drafted story

Scope: turn a plain-language feature description into a drafted story spec shaped for the current (BMad) substrate, via an author agent (reuse the Epic 3 planner / `bmad-create-story` path). The operator describes a feature; a draft spec appears for review. The author drafts **to pass the rubric** (`_bmad-output/planning-artifacts/rubric-story-quality-2026-05-31.md`) — the rubric is the author's target, so the Tier-0 checks below are exactly its Tier 0. *Observable spine: given a feature description, a spec file appears that passes the Tier-0 deterministic checks (required sections, well-formed ACs with verification markers, explicit deps, cited sources).* (Slice 2.)

## Story 9.3: Judge panel — rubric grading

Scope: a generate-and-judge step that grades a drafted story against the rubric (`_bmad-output/planning-artifacts/rubric-story-quality-2026-05-31.md`) using diverse-lens judges drawn from the hired team (verifiability, structure, discipline, domain, considered), emitting a **machine-checkable per-criterion verdict** (pass/fail + what each lens missed) — not prose. The judging tool loads that rubric file into each judge's prompt (read by construction, not by reminder) and forces the per-lens structured verdict. Reuses the Epic 6 standards/rubric surface. *Observable spine: a deliberately thin draft (e.g. an AC that only asserts a string appears in a file) is failed on the verifiability lens, not passed.* **Depends on the extended rubric (the file above).** (Slice 3.)

## Story 9.4: Quality Lead — adjudication + escalation

Scope: add the **Quality Lead** as a new role in the Epic 2 catalogue. It owns the rubric, synthesises the panel's per-criterion verdicts, breaks ties, decides `ready`-or-escalate, and writes the verdict; close calls escalate to the operator rather than auto-passing. The dedicated owner of the quality bar (the home the Epic 6 calibration loop evolves). *Observable spine: a panel-split draft routes to the operator for a decision, and is not auto-promoted to `ready`.* (Slice 4.)

## Story 9.5: Generated backlog dashboard

Scope: render the grouping tables (outstanding work grouped by epic, with status/readiness/order) **from intake state**, replacing any hand-maintained table. A read-only generated view the operator reads to steer. *Observable spine: marking a story `ready` (or re-ordering it) moves it in the rendered table with no hand-edit.* (Slice 5.)
