# User Personas

> **v1 posture (2026-05-27 reframe):** Jack-as-operator is the **v1 user** — the canonical proof-point persona, on whom the product must work first by construction. Maya (external non-engineer who reads code) is the **eventual target** the product is built toward, not the v1 ship gate. The v1 success test is self-bootstrap on Jack's machine (see `success-criteria.md`); Maya-shape success is the Epic 7 / writeup-supporting stretch goal. The pressure-test, archetype, and Vision-state hedges below predate the reframe but cohere with it. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-27-reframe.md`.

## Persona 1 — Jack (canonical v1 user)

Ex scrum master / agile delivery lead. Twenty-plus years across PM, BA, dev-adjacent, QA-adjacent, design-adjacent roles. Reads code well enough to follow what an agent did and judge whether it makes structural sense; cannot debug or refactor by hand. Already proved out the substrate (sprint-orchestrator) on this repo and on a separate tinytodo test repo. Building toward a public writeup. The product must work for him first, by construction.

## Persona 2 — "Maya" (external non-engineer who can read code)

Pressure-tested archetype, not a real person. Mid-career operator at a small company: product manager, founder, ops lead, or technical analyst. Has shipped side projects with hand-written code five-plus years ago; rusted skills but the mental model is intact. Comfortable in a terminal, comfortable with git basics, comfortable reading a diff and asking "does this look right?" Cannot architect a system, cannot write production tests, cannot debug a stack trace alone. Has been waiting for AI tooling that *actually* lets her ship — not a chatbot that produces snippets she still has to assemble.

**Pressure test on the archetype:** Is "non-engineer who can read code" the right persona? Risks:
- Too narrow — most non-engineers can't read code at all. If the addressable user has to be code-literate, v1 is a tool for a few thousand people, not a few hundred thousand.
- Right for v1, wrong for Vision — code literacy is a v1 crutch (the user judges agent output by reading it). The Vision-state user reads retros and standards, not diffs. The product should be designed so that the literacy requirement falls away as the calibration loop matures.

**Decision for v1:** the archetype stands. "Reads code well enough to skim a diff and judge structural fit" is the floor; below that, the user cannot recover from an agent miss without help, and v1 cannot afford to ship a tool that strands its users. The Vision-state question — "can the same product work for someone who never reads code?" — is explicitly deferred.

## Persona 3 — The non-human actors (the team)

The team is **dynamic per project**, formed by the hiring manager from a plugin-shipped catalogue. The hiring manager itself is always present and is the first agent the user meets. The catalogue below is the v1 starting set and the "general-purpose code project" default the hiring manager proposes when no special signals are detected; generative role creation (the hiring manager drafting a brand-new agent spec) is a Growth-phase ambition.

Every hired agent has a long-lived persona file (`<project>/team/<role>/PERSONA.md` or similar) that holds: a `domain:` field naming what they own; accumulated project knowledge appended cycle over cycle; and the locked "yield-to-expert" handoff phrase. Behaviours are specified in Functional Requirements.

- **Hiring manager (always present, not hired).** Reads the project at a high level, recommends a starting team with justification per role, supports user-approval flow, drafts agent persona files on approval, mediates team changes proposed by the retro analyst (hire / unhire). Catalogue-based in v1; generative in Growth.
- **Planner.** Helps the user turn intent into a primed `to-do/` queue. Owns story authorship discipline (integration ACs, explicit deps, ship-gate stories). Domain: planning, story shape, scope decisions.
- **Generalist dev.** Claims a story, implements it, signals handoff. Owns code production. Domain: implementation. Default member of every team.
- **Generalist reviewer.** Reviews against story ACs and against `docs/standards.md`. Owns the verdict. Domain: standards-conformance, AC coverage. Default member of every team.
- **Retro analyst.** Cycle-level. Distils story retros into rule, skill, *and team-change* proposals. Owns the calibration loop. Domain: pattern detection, proposal drafting.
- **Orchestrator (state monitor).** Surfaces blockers, stuck stories, stale claims to the user asynchronously. Never blocks the dev loop. Domain: state observability. Default member of every team.

**Specialist roles in the v1 catalogue (proposed by the hiring manager when project signals warrant):**

- **Security specialist.** Domain: auth, crypto, secrets handling, dependency CVEs, input validation. Reviewer-shaped; yielded to by the generalist reviewer on security-touching PRs.
- **Test specialist.** Domain: test coverage, test architecture, fixtures, harness design. Yielded to by the generalist dev and reviewer when AC coverage or test-shape is the question.
- **Docs specialist.** Domain: user-facing documentation, READMEs, examples. Yielded to on docs-heavy stories.
- **Debugger.** Domain: investigating and reproducing reported failures. Yielded to when a rework cycle is recurring on similar bugs.
- **(Catalogue may expand in v1 polish; the principle is what matters: roles are pre-defined Markdown specs in `plugins/<plugin-name>/catalogue/` that the hiring manager picks from.)**

**Generative role creation (Growth):** the hiring manager drafts a brand-new agent spec on the fly for projects whose needs the catalogue doesn't cover, with user review of the drafted spec before the role is hired. Available in v1 as a *manual* escape hatch (user can hand-author a new role file and ask the hiring manager to consider it); fully agent-generated specs are a post-MVP ambition.
