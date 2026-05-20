# Project Scoping

This PRD scopes **AI Engineering Team v1 as a single release**, not as a phased deliverable. The MVP / Growth / Vision split in §Product Scope is preserved for context, but the work this PRD authorises is v1 only. Growth-phase items are deferred until v1 ships and external-user data exists; Vision items are deferred indefinitely.

## Strategy & Philosophy

- **MVP shape: problem-solving MVP.** The problem is "AI agents shipping unreviewed code is expensive chaos, and a non-engineer cannot keep up by hand." The minimum viable product is a complete continuous-flow loop — plan, dev, review, retro, calibration — that runs end-to-end on a clean machine without external help. Anything that doesn't serve that loop is deferred.
- **Resource shape.** One operator (Jack) builds v1 by dog-fooding it on its own repo (and the existing `sprint-orchestrator` repo while continuous flow is bootstrapped). Internal validation happens on `crew`; soft release happens via the canonical scenario with one external reader.
- **Path to validated learning.** Two loops run in parallel. The *engineering loop* (does v1 actually ship merged PRs reliably?) validates the substrate. The *product loop* (does Jack — and then one external reader — actually keep using it?) validates the thesis. Both must converge before v1 is "shipped" in any externally-meaningful sense.

## Complete Feature Set (v1)

**Core user journeys supported (from §User Journeys):** all five — happy path, external user attempt, backlog-was-wrong recovery, blocker handling, standards-doc evolution. The PRD does not ship without journey 3 (failure-mode-realised recovery) working, because that is the journey that distinguishes the product from "AI writes code."

**Must-have capabilities (gate v1 ship):**

1. **Hiring manager agent** that reads the target repo at a high level and recommends a starting team from the plugin-shipped catalogue, with one-sentence justification per role.
2. **Plugin-shipped catalogue** of at least the default roster (planner, generalist dev, generalist reviewer, retro analyst, orchestrator) plus a starting specialist set (security, test, docs, debugger).
3. **Hiring flow** (`/<plugin>:hire`) with user approve/edit/decline-per-role and an idempotent re-run path that supports team edits after initial hire.
4. **Persona file per hired agent** at `<target-repo>/team/<role>/PERSONA.md` containing `domain:`, prompt body copied from catalogue at hire time, and an accumulated knowledge section that grows cycle over cycle via diff-then-confirm updates.
5. **Yield-to-expert protocol**: locked handoff phrase, role-by-domain lookup, automatic routing of work from a generalist to a specialist when the work falls inside the specialist's `domain:`.
6. **`/<plugin>:team` skill** showing the current roster, each role's domain, recent persona-knowledge entries, and fire counts.
7. **`/<plugin>:ask <role>` skill** opening a side-session with a specific hired role without mutating dev-loop state.
8. **"Skip hiring, use default team" fast path** as a bailout if the hiring conversation feels too heavy on first install.
9. Continuous-flow runtime with three concurrent Claude Code sessions (planning, dev, orchestration), filesystem-coordinated state machine, atomic `mv`-based state transitions.
10. Story file shape conforming to planning-discipline rules: integration ACs for state-mutating stories, explicit `depends_on`, ship-gate stories, runnable AC checks.
11. Planner agent that produces conforming story files from a user conversation.
12. Generalist dev + reviewer loop per story (clean per-story subagent context spawned from hired persona).
13. Reviewer that judges against story ACs *and* `docs/standards.md`, posts a verdict in the locked grammar, applies labels — yielding to specialists in their domains via the protocol.
14. Risk-tiered verdict handling: low-risk auto-merge once the agreement metric earns it; medium/high pause for the user.
15. Orchestrator that surfaces blockers, stuck stories, and stale claims via a one-line terminal surface; never blocks the dev loop.
16. Standards doc lookup, version-stamping, hard cap of 10 criteria, copy-target example template shipped with the plugin.
17. Story-level retro entries (structured `lessons[]`, `failure_class`, duration, rework count) — lessons routable to specific persona files.
18. Cycle-level retro analyst producing rule, skill, *and team-change* proposals in a markdown file under `retro-proposals/`.
19. Rule registry (`discipline-rules.yaml`) as canonical source; `docs/standards.md` regenerated; version-stamped verdicts.
20. User-gated apply flow (`/<plugin>:accept-proposal <id>`) for accepted proposals — rules, skills, hires, and unhires all go through the same diff-then-confirm gate.
21. Outcome verification: `computeOutcomeStats` reports before/after fire counts per rule *and* per team-composition change.
22. "Discard a built feature" as a first-class planning-conversation outcome (journey 3 requirement).
23. Bundled example target repo + canonical scenario the user can run end-to-end on first install, starting with the hiring conversation.
24. README walking the install path with verifiable checkpoints (install → hire → plan → start → first merged PR).
25. End-to-end test harness exercising the full continuous-flow loop including hiring + a specialist yield against a fixture target repo.
26. Permission specs declared per catalogue role; reviewable in version control. Persona files inherit catalogue tool allowlists at hire time.
27. Local-first telemetry (JSONL or equivalent) recording per-agent runtime, verdicts, eventual merge actions, proposal accept/reject decisions, and team-composition changes — the substrate for the agreement metric, outcome stats, and team-fitness signals.

**Nice-to-have for v1 (ship if cheap, defer if not):**

- Per-agent token cost recorded alongside runtime in telemetry.
- Auto-suggested `risk_tier` for new stories (planning agent infers from path globs and diff hints).
- "Sprint mode shim" — backwards-compat mode that lets someone with a `sprint-status.yaml` from sprint-orchestrator import their backlog into the continuous-flow layout. Useful for Jack's own dog-fooding transition; deferable if scope tightens.

**Explicitly NOT in v1 (deferred, with reasons preserved from §Product Scope):**

- Multi-user / team support, plugin-shipped default standards, specialist agent zoo, auto-merge for medium/high risk, hard cost caps. Each is a Growth item.

## Strategic Risks

Top three. Listed in order of how much they would invalidate the v1 ship, with explicit mitigations.

**Risk 1 — Jack is the only person who would use this.** The product is built by a single user against a single user's workflow. There is a real chance that what makes sense to Jack — continuous flow over sprints, agile rigour as the load-bearing surface, retros as a first-class artifact — does not generalise to even one external reader. The failure mode is: v1 ships, the writeup goes out, nobody installs it, the canonical scenario never gets attempted by anyone but Jack.

*Mitigation:*
- The canonical scenario is encoded as the single test of success — designed to fail fast and visibly if no external user picks it up.
- Maya's journey is pressure-tested explicitly in this PRD, including the gap it surfaces (translate-a-reviewer-comment affordance) — v1 ships with that gap closed, not with it open.
- The writeup is treated as part of v1, not as marketing. If the writeup can't produce a first install attempt, that is a v1-failure signal that triggers a course-correct, not "ship more features."
- Failure to attract a first external user within the soft-release window is *not* treated as a content-marketing problem; it is treated as a product-fit problem and routed through a retro on the product itself.

**Risk 2 — The calibration loop produces theatre, not learning.** Retros generate proposals; nobody accepts them; the standards doc stays static; the agents drift toward mediocrity instead of away from it. The product has all the rigour-shaped surfaces but none of the rigour-shaped behaviour.

*Mitigation:*
- Accepted-proposal rate per cycle is itself a metric (≥1 per cycle target). A zero rate triggers a retro-on-the-retro.
- The retro agent is restricted to producing falsifiable proposals (rule text with a target failure class; skill drafts with a concrete proposed path) — vague meta-proposals are rejected by the proposal's own schema.
- Outcome verification (`computeOutcomeStats`) is built into v1; the user sees rule fire counts trend down (or not), so theatre is observable.
- If outcome stats stay flat across multiple cycles, that is itself a v1-failure signal; the product's central thesis (rigour compounds via the loop) has been falsified and a course-correct is needed.

**Risk 3 — The dynamic team underperforms a fixed roster.** The hiring manager + persistent persona pattern is the product's central novelty, and it's the biggest new failure surface. Two specific shapes: (a) the hiring manager always proposes the default roster (catalogue is just a rename of a fixed team), or proposes wrong specialists when signals are ambiguous — bad team composition cascades into bad downstream output; (b) persona files drift over cycles — bad lessons recorded, hallucinated facts persisted, or stale knowledge that should have been retired — and agents act on poisoned memory rather than fresh judgement. Either failure mode means a user is worse off than they would have been with a simple fixed-roster v0.

*Mitigation:*
- **Catalogue-bound hiring in v1.** The hiring manager cannot invent roles, only pick from pre-defined catalogue entries; this caps the worst case at "wrong team from the catalogue" rather than "wrong agent type that doesn't even exist sensibly."
- **Default roster is the floor.** General-purpose code projects get the same five-role team every time; specialists are added with one-sentence justifications the user can challenge. If the hiring manager can't justify a specialist, it doesn't propose one.
- **Outcome verification covers team changes.** `computeOutcomeStats` reports failure-class trends across team-composition changes, not just rule introductions; a hire that didn't reduce its predicted failure class shows up as a candidate-for-unhire in the next retro.
- **Persona updates are diff-then-confirm in v1.** Every knowledge append is shown to the user before it persists. Persona files are plain Markdown so the user can read and prune at any time.
- **Persona files are version-controlled** in the target repo. Bad accumulation is recoverable via `git revert` on the persona file.
- **If the team pattern can't earn its keep over a fixed-roster comparison within the dog-fooding window, v1 ships with a "skip hiring, use default team" fast path.** This is the bailout option that keeps the *rest* of the product viable even if the team-formation thesis is wrong.

(Operational fragility risks — sessions dying, recovery shape — are real but moved to §Domain-Specific Requirements > Risks & Mitigations as a domain-level concern; they're mitigated structurally by "no daemon, no shared mutable state, re-run any skill to resume" and by the bundled example acting as a first-install canary.)

## Risk Mitigation Strategy (operational, not strategic)

- **Technical risk:** the agreement metric stays stubbornly below 80% after two dog-fooding cycles, signalling the reviewer or the standard is wrong. Mitigation: this is the calibration loop's job to surface; the PRD treats sub-80% as falsification, not as "push through."
- **Market risk:** the addressable user — "non-engineer who can read code" — is smaller than assumed. Mitigation: pressure-test Maya's archetype on real candidates *before* the writeup goes out; if the candidate pool feels under five real people Jack can name, the writeup gets reframed before launch.
- **Resource risk:** Jack is the only operator. Reviewing two parallel loops (engineering + product) takes attention. Mitigation: the calibration loop is designed to produce structured signals (failure_class tags, rule fire counts, accepted-proposal rates) so trend-watching is observable from a glance rather than a deep audit.

## Scope Confirmation

Single release. v1 is the ship. Everything in §Product Scope > MVP is also in §Complete Feature Set above. Growth and Vision items remain explicit follow-ups, not orphaned requirements. No silent de-scoping has occurred. The canonical scenario succeeding for one external user is the v1 ship-or-don't ship test.
