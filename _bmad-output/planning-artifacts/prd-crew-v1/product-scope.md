# Product Scope

## MVP — Minimum Viable Product

The MVP is the smallest product that lets the canonical scenario succeed once. Anything beyond that is Growth.

1. **Hiring manager + catalogue.** A plugin-shipped catalogue of pre-defined agent roles (planner, generalist dev, generalist reviewer, retro analyst, orchestrator, plus a starting set of specialists — security, test, docs, debugger). A hiring manager agent that reads the project, recommends a starting team with justification, and supports user-approval. Default roster proposed when no specialist signals; specialists added with reasons.
2. **Persona files per hired agent.** One Markdown file per role at `<target-repo>/team/<role>/PERSONA.md`. Holds `domain:`, prompt body copied from catalogue at hire time, and an accumulated knowledge section. Updates are diff-then-confirm in v1. User-readable, user-editable.
3. **Yield-to-expert protocol.** A locked handoff phrase used by an agent when it recognises work falls inside another agent's `domain:`. Routed via the plugin's role lookup (no user mediation needed for routine handoffs).
4. **Continuous-flow runtime.** Three concurrent Claude sessions (Planning, Dev, Orchestration) coordinate via atomic filesystem moves on story files. `to-do/` → `in-progress/` → `blocked/`/`done/`. Story frontmatter is the contract.
5. **Planning loop.** A planning conversation flow with the planner that helps the user turn a vague intent into a primed `to-do/` queue with stories that meet the planning-discipline rules (integration ACs, explicit `depends_on`, ship-gate stories, runnable AC checks).
6. **Dev loop.** Generalist dev claims a story, implements it, hands off to a reviewer (generalist or yielded specialist).
7. **Reviewer + standards loop (Pattern A absorbed).** The generalist reviewer judges each PR against `docs/standards.md`; on domain-touching changes, yields to the relevant specialist. Verdict is posted; low-risk PRs auto-merge once the verdict-vs-action agreement floor is met; medium/high pause for the user.
8. **Orchestration session.** Surfaces blockers, stuck stories, and stale claims to the user asynchronously. Never blocks dev progress.
9. **Story-level retros with team-aware lessons.** Every story produces a structured retro entry (lessons, failure_class, duration, rework count). Lessons can be routed to specific agent persona files (e.g. a lesson tagged with the test specialist's domain lands in their persona, not the generalist reviewer's).
10. **Cycle-level retro with team-change proposals.** Retro analyst distils story retros into three proposal kinds: rules, skills, and team changes (hire, unhire). All proposals are user-gated.
11. **Calibration substrate.** Standards doc is version-controlled in the target repo. Verdicts stamp the version. Retros propose deltas; user approves; standard updates. Outcome stats track failure-class trends across rule introductions *and* team-composition changes.
12. **Install path.** A single documented "from clean machine to first merged PR" workflow, starting with the hiring conversation. README walks a new user through hiring, then planning, then the dev loop. Canonical example bundled.

The MVP **does not include** the items below; they are deferred to Growth or Vision.

## Growth (Post-MVP)

- **Generative role creation.** Hiring manager drafts a brand-new agent spec on the fly for projects whose needs the catalogue doesn't cover, with user review of the drafted spec before the role is hired. v1 supports a manual escape hatch (user authors a role file by hand and asks the hiring manager to consider it); fully agent-generated specs are the Growth ambition.
- **Auto-applied persona updates.** v1 gates every persona-knowledge update through diff-then-confirm. Once the calibration loop has produced clean track record, *trusted-domain* updates auto-apply (e.g. an architect specialist whose domain has zero false-positive lessons over six cycles can append knowledge without per-update confirmation). The mechanism is the same; the gate is what changes.
- **Plugin-shipped default `standards.md`** the user extends rather than writes from scratch.
- **Expanded catalogue:** roles like `architect`, `perf-specialist`, `release-manager`, `accessibility-specialist`. Each earns its slot when retros surface specific recurring pain *across multiple users*, not just Jack.
- **Cost telemetry and tier hints.** Per-agent cost tracking; suggestions to downshift routine work to cheaper models; AC-complexity heuristic for tier selection.
- **Cross-PR dependency reasoning** in the reviewer (PR B depends on un-merged PR A — judge understands the chain).
- **TDD enforcement** for state-mutating stories (soft warning first, hard refusal once data justifies it).
- **Hard cost caps** and graceful degradation when an agent invocation blows its budget.
- **Comment-spam mitigation** when a reviewer produces too many findings on a single PR.
- **Self-rewriting Level 2 / Level 3.** Apply mechanics for accepted retro proposals (rules + skills) that go beyond user-confirmed edits — eventually meta-agents editing the plugin itself.

## Vision (Future)

- **Externalised product loop.** A planning-conversation experience polished enough that a non-Jack user reaches a primed backlog without coaching. Includes templates per common project shape (web app, CLI tool, plugin, internal service).
- **Multi-user / team setups.** Two or more humans driving one backlog without stepping on each other; per-user attribution on retros; permission scoping.
- **Cross-repo / multi-repo orchestration.** A planning session that spans repos (e.g. a frontend + backend feature requiring stories in both).
- **Export playbook.** A consulting / handover artifact: "here is your team's continuous-flow setup, here is the standard, here are the retros." For a future world where this product is a service, not just a plugin.
- **Self-hosting.** The product runs its own development on its own continuous-flow loop. Sprint-orchestrator goes from "legacy" to "fully retired"; the new product builds itself.

**Explicitly out of v1 (with reasons):**

1. **Multi-user / team support.** The failure mode the PRD targets is "non-engineer ships software solo, not as part of a team." Adding multi-user shape before solo works would dilute the scenario the product is being judged against.
2. **Plugin-shipped default standards doc.** The standards doc must come from observed misses in the user's own repo, or it becomes "definition of perfect" — exactly the bloat anti-pattern the Pattern A PRD identified. Users author their own thin v1 standard; the product ships an *example template*, not a default.
3. **Generative role creation by the hiring manager.** v1's hiring manager is catalogue-bound — it can only propose pre-defined roles. Fully agent-generated agent specs are a Growth ambition; v1 ships a manual escape hatch (user hand-authors a role file) but not the magical "AI hires AI it drafted" path. The hiring manager being brilliant on day one is too much load-bearing competence for v1.
4. **Auto-merge for medium/high risk.** Only low-risk auto-merges in v1, and only after the agreement metric earns it. Medium and high *always* pause for the human in v1. This trades autonomy for trust; the trade flips in Growth as data accumulates.
5. **Hard cost caps and budget enforcement.** Soft telemetry only in v1. A hard cap that aborts mid-story would create new failure modes (orphaned PRs, half-applied changes) before the product is mature enough to handle them gracefully.
6. **Auto-applied persona updates.** v1 gates every knowledge append through diff-then-confirm. Trusted-domain auto-apply is a Growth item that requires multi-cycle clean track record before it earns the gate-removal.
