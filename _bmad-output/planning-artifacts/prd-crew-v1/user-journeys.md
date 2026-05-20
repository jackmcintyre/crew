# User Journeys

## Journey 1 — Jack runs the canonical scenario on his own repo (happy path)

**Opening scene.** Jack has just installed v1 on his repo. The first thing he does is open a hiring conversation. The hiring manager reads the repo at a high level — language, layout, what kind of code it contains, what the README says — and proposes: planner, generalist dev, generalist reviewer, retro analyst, orchestrator, plus a test specialist (justified: "this repo's quality bar leans heavily on the e2e harness; a specialist will spot test-shape regressions a generalist might wave through"). Jack reads the justification, accepts. Each agent's persona file is created with an empty knowledge section and a populated `domain:` field. The team is hired.

He opens a planning conversation with the planner. They talk through scope, acceptance criteria at the user-value level, and dependencies. Twenty minutes later, the `to-do/` directory has six story files, each carrying integration ACs, explicit `depends_on` links, and a ship-gate story at the end. He skims them, tweaks one, and commits.

**Rising action.** He runs the continuous-flow start command. Three sessions come up: dev, orchestration, planning (idle until he adds more work). The generalist dev picks the first story, implements it, hands to the generalist reviewer. Reviewer judges against story ACs and `docs/standards.md`. On story 2 — which adds a new test fixture — the generalist reviewer yields to the test specialist via the locked handoff phrase ("This sits in the test specialist's domain — handing off"). Test specialist reviews, flags a fixture-isolation issue, dev fixes it on the rework path, test specialist returns `READY FOR MERGE`. Story moves to `done/`. Dev moves to story 3. Jack closes the laptop.

**Climax.** Two hours later he comes back. Five PRs merged. Story 6 (the ship-gate) is in `blocked/` because integration test runtime exceeded the budget. The orchestration session has surfaced this with a one-line summary at the top of his terminal. He reads it, decides the budget is wrong (test is legitimately slow), updates the story file, moves it back to `to-do/`. Dev picks it up. Two minutes later it ships.

**Resolution.** Feature is done. He opens the retro file the retro analyst wrote at the end: one lesson tagged `tool-quirk` about the test runtime budget (recorded into the test specialist's persona file so it doesn't get forgotten), one proposed rule for the registry, one proposed skill draft about how to size budgets for integration tests, and one proposed *team change* — "consider hiring a docs specialist next cycle; three stories needed README updates that the generalist dev wrote in a hurry." He accepts the rule, defers the skill, defers the team change for now. Next cycle starts cleaner; the test specialist now knows something about this repo it didn't yesterday.

**Reveals requirements for:** hiring conversation + user-approval flow; persona file creation and update; domain-aware yield protocol with locked handoff phrase; planning conversation flow; story file shape; atomic state moves; dev/reviewer/orchestration session architecture; blocker surfacing without dev-loop interrupt; retro file generation + accept/defer flow including team-change proposals; standards doc lookup; risk-tiered verdict labels.

## Journey 2 — Maya tries the canonical scenario on a fresh machine

**Opening scene.** Maya has read Jack's writeup. She wants to ship a small CLI tool she's been thinking about for a year. She clones the repo, follows the README — install Claude Code, install the plugin, configure agent permissions, copy `docs/standards-example.md` to her target repo as `docs/standards.md`, edit two criteria for her stack. Total: 35 minutes.

**Hiring conversation.** She opens the plugin. The first thing she meets is the hiring manager. It asks her what she wants to build, reads her near-empty repo, and proposes: planner, generalist dev, generalist reviewer, retro analyst, orchestrator — the "general-purpose code project" default. No specialists ("this is a small CLI; specialists earn their slot once the project has accumulated some shape"). The hiring manager explains its reasoning in two paragraphs. Maya hovers over "add a docs specialist?" — the hiring manager says: "Defer until you have a README to maintain; you'll feel the pain first, hire then." She likes that answer. She approves the default team. Five persona files get created, each with an empty knowledge section.

**Rising action.** She opens a planning conversation. The planner asks her what she wants to build. She rambles for a paragraph; the planner reflects back a one-sentence vision and three candidate stories. She corrects two, accepts one, the planner drafts story files. She reads them. She doesn't fully understand one AC. The planner rewrites it in plainer terms. She commits the backlog. Total: 45 minutes.

**Climax.** She starts the continuous-flow loop, sceptical. The generalist dev picks the first story, implements it. The generalist reviewer flags an issue: a missing test case. Verdict is `NEEDS CHANGES`. Maya sees the `needs-human` label, reads the inline comment, doesn't fully understand it. She asks the planner (in a separate session) "what does this comment mean?" The planner explains in plain language. She agrees with the reviewer, lets the dev rework. The fix lands. Verdict flips to `READY FOR MERGE`. She merges.

**Resolution.** Three days later Maya has a CLI tool she actually uses. She tells two friends. One installs it. The other asks her how she built it. She doesn't know exactly how to explain it. She points at the repo. The first version of the user-facing story is that explanation.

**Reveals requirements for:** install-path documentation; permissions configuration ergonomics; planning agent's ability to translate jargon for non-deep-engineer users; standards-doc-missing failure path; `needs-human` label semantics; ability to consult a planning agent about a reviewer verdict without breaking the dev loop. **Also reveals a gap:** Maya's "I don't understand this comment" moment is not currently a first-class flow. v1 needs an explicit "ask a non-dev agent to translate" affordance, or this journey breaks.

## Journey 3 — The backlog was wrong (failure-mode-realised, recovery flow)

**Opening scene.** Jack has primed a backlog for a new feature based on an assumption about user behaviour that turns out to be wrong. The agents drain the backlog cleanly. Five PRs merge. The ship-gate passes.

**Rising action.** Jack uses the feature for a week. Nobody else uses it. He realises he built the wrong thing. The agents did exactly what he asked. The bug was upstream of every line of code.

**Climax.** The product's failure-mode-prevention behaviour kicks in *not by stopping him*, but by the shape of the recovery. He cannot fix this by reading code. He has to re-open a planning conversation, name the new understanding of the problem, and re-prime the queue. The retro agent (cycle-level) writes a retro entry tagged `pitfall`: "backlog primed against assumption X, which was falsified by usage." The proposal: a rule for the registry — "before priming a backlog for a user-facing feature, the planning agent asks the user to name the test of success at the *behaviour* level, not the *feature* level."

**Resolution.** Jack accepts the rule. Next planning conversation, the agent asks the new question. The new backlog reflects what he actually wanted. The discarded feature stays in the repo as a deprecated path; he doesn't delete it because the cost of deletion is real and the cost of keeping it is small. He moves on.

**Reveals requirements for:** retros that surface *product-level* lessons, not just engineering-level ones; rule proposals that target the planning agent's prompt, not just the dev/reviewer prompts; explicit support for "discard a built feature" as a planning-conversation outcome; the retro registry's ability to evolve planning behaviour, not just code behaviour. **This journey is the most important one in the PRD** — it is the failure-mode-prevention loop in action.

## Journey 4 — An agent gets stuck mid-flow (blocker handling)

**Opening scene.** Jack is at lunch. Dev agent is partway through a story when it hits a dependency that doesn't exist (a referenced API endpoint isn't real). It writes a blocker entry into the story file's frontmatter and moves the story to `blocked/`. It picks the next story from `to-do/`.

**Rising action.** The orchestration session polls `blocked/` on its next loop and surfaces a one-line summary in Jack's terminal: *"story-007 blocked: referenced `/api/v2/users` endpoint not implemented."* Jack sees this when he comes back. He realises he'd planned the story against a documented but unbuilt endpoint. He has two choices: drop the story, or add a precursor story to build the endpoint.

**Climax.** He opens the planning agent. They discuss. The decision: add the precursor story. The planning agent updates the dependency graph; story-007's `depends_on` now includes the new story-008. Both go back into `to-do/`. Dev agent picks story-008 next cycle.

**Resolution.** The story that blocked ships an hour later. No code was lost. No agent was babysat. Jack spent five minutes on the recovery and the dev loop kept running.

**Reveals requirements for:** blocker frontmatter schema; atomic `to-do/`→`blocked/` move; orchestration polling; one-line terminal surface; planning agent's ability to mutate the dependency graph; dev loop never blocks waiting for human.

## Journey 5 — The standards doc evolves after a miss (calibration loop)

**Opening scene.** A reviewer verdict says `READY FOR MERGE` on a PR that introduces a subtle bug — a config value not validated against a sane range. The bug gets caught two stories later when the unvalidated config crashes the dev agent's test runner.

**Rising action.** The retro agent (story-level) tags this with `failure_class: config-validation-missing`. The cycle-level retro agent rolls this up, notices it's the second occurrence in three cycles, and writes a rule proposal: add a criterion to `docs/standards.md` — *"any new config value declares a validation range or schema."*

**Climax.** Jack reviews the proposal. He accepts. The product runs `applyRetroProposal` which mutates the rule registry, regenerates `docs/standards.md`, and bumps its version. The next reviewer verdict stamps the new version. Three cycles later, `computeOutcomeStats` reports the `config-validation-missing` failure class has stopped firing since the rule was introduced.

**Resolution.** The calibration loop closed on a real miss. The standard sharpened without bloating (one criterion added; no others touched). The product got better at its job because of a bug, not despite one.

**Reveals requirements for:** story-level retro entries with `failure_class`; cycle-level retro aggregation; rule registry (`discipline-rules.yaml`) as source of truth, `docs/standards.md` regenerated; user-gated apply flow; version-stamped verdicts; outcome-verification stats computed from sprint history.

## Journey 6 — The retro proposes a team change

**Opening scene.** Three cycles in, Jack's project has shipped about thirty stories. Recently the same two failure classes keep recurring: `dependency-cve-missed` and `auth-validation-thin`. Both are caught by Jack at merge time, not by the generalist reviewer.

**Rising action.** The retro analyst runs at the end of the third cycle. It distils the lessons across cycles, notices the pattern, and writes three proposals: one rule, one skill draft, and — flagged as a *team change proposal* — "consider hiring a security specialist. Two recurring failure classes (dependency-cve-missed, auth-validation-thin) sit in the security specialist's domain. Predicted impact: the generalist reviewer yields to the security specialist on PRs touching auth or dependency files; recurring failure classes go to zero after introduction."

**Climax.** Jack reads the proposal. He accepts. The hiring manager runs, drafts a persona file for the security specialist from the catalogue template, populates the `domain:` field, and stages an empty knowledge section. Jack reviews the draft, confirms. The security specialist is hired. Next cycle, a PR touching auth flows; generalist reviewer reads the diff, recognises auth-touch, yields to security specialist via the locked phrase. Security specialist reviews, flags a missing validation, dev fixes, security specialist returns `READY FOR MERGE`.

**Resolution.** Two cycles later, `computeOutcomeStats` shows `auth-validation-thin` has stopped firing since the security specialist was hired. The team got fitter because the retro tuned it. The security specialist's persona file now contains five paragraphs of project-specific knowledge that no other agent has.

**Reveals requirements for:** retro analyst can emit *team-change* proposals alongside rule/skill proposals; user-gated team-change apply flow; hiring manager can drop into the apply flow to draft a new persona file from a catalogue template; outcome-verification stats track failure-class trends across team-composition changes; the locked yield-to-expert phrase routes work between agents based on `domain:` fields without the user mediating.

## Journey Requirements Summary

Capabilities surfaced across journeys 1–6:

- **Hiring conversation** the user opens first; hiring manager reads the project at a high level, proposes a starting team with justification, supports approve / edit / decline per role.
- **Catalogue of pre-defined specialist roles** the hiring manager picks from in v1 (planner, generalist dev, generalist reviewer, retro analyst, orchestrator, security specialist, test specialist, docs specialist, debugger; possibly more).
- **Persona files per hired agent** with a `domain:` field, an accumulated knowledge section, and the locked yield-to-expert phrase. Agents read at session start, append at session end.
- **Yield-to-expert protocol** — a locked phrase that routes work from a generalist to a specialist when the work falls inside the specialist's `domain:`.
- **Team-change proposals** as a first-class output of the retro analyst, alongside rule and skill proposals.
- **Team-change apply flow** that hands off to the hiring manager to draft a new persona file from a catalogue template, with user review before the role is hired.

- **Planning conversation** that produces story files conforming to planning-discipline rules.
- **Story file shape**: frontmatter (id, deps, status, risk-tier, blocked-by, claimed-by), narrative body, ACs (including at least one integration AC for state-mutating stories).
- **Atomic state moves** between `to-do/`, `in-progress/`, `blocked/`, `done/` via filesystem `mv`.
- **Three concurrent sessions** (planning, dev, orchestration) coordinating via the filesystem.
- **Dev agent** that claims, implements, hands off; never blocks waiting for the human.
- **Reviewer agent** that judges against story ACs *and* `docs/standards.md`; posts verdict; applies labels.
- **Risk-tiered verdicts**: low-risk PRs auto-merge once agreement metric earns it; medium/high pause for the human.
- **Orchestration agent** that surfaces blockers, stuck stories, stale claims — async, never interrupts dev.
- **Story-level retro entries** with structured `lessons[]` and `failure_class` tagging.
- **Cycle-level retro agent** that distils story retros into rule and skill proposals.
- **Rule registry** as canonical source; `docs/standards.md` regenerated; version-stamped verdicts.
- **User-gated apply flow** for accepted proposals (rules and skills).
- **Outcome-verification stats** computed from history (before/after fire counts per rule).
- **Standards-doc-missing failure path** with a clear error and an example template.
- **"Ask a non-dev agent to translate"** affordance for non-engineer users who don't understand a reviewer comment (gap surfaced by Maya's journey).
- **Planning agent prompts that target product-level lessons**, not just engineering-level (gap surfaced by the backlog-was-wrong journey — the most important loop in the product).
- **"Discard a built feature"** as a first-class planning-conversation outcome.
- **One-line terminal surface** for orchestration to communicate without breaking flow.
