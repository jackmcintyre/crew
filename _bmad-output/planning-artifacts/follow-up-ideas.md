# Follow-up ideas — scratchpad

Captured during planning conversation for `orchestrator-polish-sprint-1`. **None of these are committed.** Each needs detailed planning before becoming a sprint. Order is the order they came up, not priority.

---

## 1. PR-per-story workflow

Replace "commit per story on the current branch" with "branch + push + open PR per story." Discussed but not aligned.

### Open design questions
- **Branch model.** Three candidates:
  - A. Branch per story off main — dependent stories blocked until parent PR merges (or stacked, which hits GitHub's auto-retarget gotcha we already saw).
  - B. One feature branch per sprint, PR per story — doesn't work (1 branch = 1 open PR on GitHub).
  - C. Stacked branches following `depends_on` — honest but inherits the auto-retarget problem.
  - *Default lean: A.*
- **"Done" semantics.**
  - PR open (autonomous-friendly; CI runs later).
  - PR open + CI green (orchestrator polls).
  - PR merged (requires human; defeats autonomy).
  - *Default lean: PR open.*
- **Opt-in vs always-on.**
  - Always-on, replacing `commitStoryArtefacts`.
  - Opt-in via `.sprint-orchestrator/config.yaml` (`pr_per_story: true`, default false).
  - *Default lean: opt-in.*

### Things to figure out later
- New MCP tool: `openStoryPr(storyId, agentId)` wrapping `gh pr create`.
- PR title/body shape. Default: title = commit subject; body = story spec + AC results.
- Failure handling when `gh` auth or remote isn't configured (`markStoryFailed`, don't push silently).
- Whether this composes with retros (retro embedded in PR body — nice review surface).

---

## 2. Story + sprint retros

Capture what went well, what didn't, what was learned — at story granularity and sprint granularity.

### Story-level retro
Fires at end of every story. Sources:
- **Dev** signals: what was hard, what context was missing, where the AC and the spirit of the story diverged.
- **Reviewer** signals: implementation-vs-spirit fit, AC near-misses, friction in review.
- **Orchestrator** signals (automatic): `rework_count`, total duration, failed AC checks per attempt, files churned, post-commit `pnpm verify` time.

Proposed shape (structured, easier to aggregate later):

```yaml
retro:
  duration_seconds: 187
  rework_count: 0
  went_well: [...]
  needs_improvement: [...]
  learnings: [...]
  proposals:                # optional, structured change ideas
    - kind: agent-prompt
      target: agents/dev.md
      change: "..."
    - kind: config
      target: .sprint-orchestrator/config.yaml
      change: "..."
```

Open: inline under `story.orchestrator.retro` (one source of truth) vs sidecar `.sprint-orchestrator/retros/<id>.yaml` (freer, separable). Author: reviewer-only vs dev-jots-then-reviewer-finalizes.

New MCP tool needed: `recordStoryRetro(storyId, agentId, retro)`.

### Sprint-level retro
Fires on backlog drain OR via `/sprint-orchestrator:retro`. Inputs:
- All story retros from the sprint
- Sprint metrics (completion rate, rework rate, durations, most-failed AC types)
- `run.log` lifecycle events
- Sprint-scoped git log (commits, churn per file)

Outputs:
- Markdown retro doc, written to `_bmad-output/implementation-artifacts/retros/<sprint_id>.md` (lets BMAD's `bmad-retrospective` consume it for epic-level rollups).
- Top-friction list (most reworked / slowest / most-churned).
- Theme patterns (recurring `needs_improvement` strings).
- Deduplicated proposal queue.

### Open questions on retros
- Auto-fire on drain only, or also time-based during long `/loop` runs?
- Storage choice (inline vs sidecar) for story retros.
- How (and where) sprint retros surface to the user — file only, or also rendered via a new tool like `getSprintReport` (Story 2.1 in the current sprint covers a piece of this).
- Relationship with `bmad-retrospective` — feed it, reimplement, or both.

---

## 3. Self-rewriting / meta-loop

Sub-concept of retros powerful enough that it deserves its own section. "Powerful enough to rewrite how the system works."

### Three levels of power
- **Level 1 — Read-only recommendations.** Retro produces markdown. Human decides. Roughly what BMAD's existing `bmad-retrospective` does. Zero risk.
- **Level 2 — Proposals become next-sprint stories.** Retro's structured proposals auto-convert into entries in a follow-up `sprint-status.yaml`. AC pre-generated from `target`/`change` fields. Orchestrator now drives its own improvement backlog. Human-gated at merge.
- **Level 3 — In-line self-modification by a meta-loop.** Retro spawns `meta-dev` + `meta-reviewer` subagents that edit the plugin itself within a scoped allowlist. Recursive orchestration.

### Auto-editable-file allowlist (default proposal, for Level 3)
| File class | Risk | Default |
|---|---|---|
| `.sprint-orchestrator/config.yaml` | Low (values only) | ✅ allowed |
| `agents/*.md` | Medium (behavior, constrained by `allowed-tools` frontmatter) | ✅ allowed |
| `skills/process-backlog/SKILL.md` | Medium (loop body) | ⚠️ allowed with tighter reviewer cap |
| `hooks/lib/deny-patterns.ts` | High (TS, security-sensitive) | ❌ human only |
| `packages/mcp-server/src/**` | Very high (state machine) | ❌ human only |
| `packages/hooks/src/**` | High (guardrails) | ❌ human only |

### Open questions
- Default level: 2 or 3?
- Is the auto-editable-file allowlist correct? Specifically: should the meta-loop ever touch MCP tools or hooks code (even with human merge gating)?
- Permission scoping for `meta-dev`: same as `dev`, or narrower?
- New story type field (`type: feature | plugin-config | meta`) driving which agent runs and which permission scope.
- Meta-changes on a fresh branch per proposal, or accumulated into one retro PR?

---

## 4. Model tiering + escalation

Use cheaper/faster models where reasoning is light; reserve big models for hard work and escalation.

### Tier ladder
| Tier | Model family | Use for |
|---|---|---|
| **fast** | Haiku | Tool-routing, fan-out, status summaries. Mechanical work. |
| **balanced** | Sonnet | First-pass implementation, first-pass review. The workhorse. |
| **deep** | Opus | Rework attempts, contested reviews, meta-loop, hard architectural stories. |

### Static assignment (the simple version)

```yaml
# .sprint-orchestrator/config.yaml
models:
  skill: fast
  dev: balanced
  reviewer: balanced
  retro_writer: balanced
  meta_dev: deep
  meta_reviewer: deep
```

Per-agent `model:` field in `agents/*.md` frontmatter (Claude Code already supports this on Task-spawned subagents).

### Escalation triggers (the interesting version)
| Trigger | Behavior |
|---|---|
| `rework_count > 0` | Dev's next attempt runs at `deep`. |
| Reviewer rejects under cap | Next reviewer attempt also escalates one tier — tiebreaks honestly, costs more. |
| Story metadata `tier: deep` | Author override. Direct mapping. |
| AC complexity heuristic | Many AC checks, or workspace-wide shell ACs → auto-bump. |
| Meta-story type | Anything modifying plugin source → always `deep`. |

### Per-story tier history (proposed schema addition)
Under `story.orchestrator`:
```yaml
model_history:
  - { attempt: 1, role: dev, tier: balanced }
  - { attempt: 2, role: dev, tier: deep }       # rework escalation
```
Lets retros analyze patterns ("stories of type X reach deep 80% of the time — bump their default").

### Open questions
- Default ladder assignment (skill=fast / dev=balanced / reviewer=balanced) vs more aggressive variations.
- Auto-escalate the reviewer on rework attempts, or keep reviewer at balanced and only escalate dev?
- Optional cost telemetry in `run.log` `story_end` events (in scope or follow-up?).
- Failure fallback when a tier is rate-limited / unavailable — downgrade silently or hard-fail?
- Story-level `tier:` field in the schema, or hands-off?

---

## 5. Expand the agent team

Today's "team" is two subagents: `dev` and `reviewer`. That's the cheapest agent-team setup that still captures the big wins (fresh context per role, permission split). It is **not** what the orchestrator could be.

### Capabilities we use vs don't

| Capability | Status |
|---|---|
| Two subagent types (`dev`, `reviewer`) | ✅ done |
| Permission split between them | ✅ done |
| Fresh context per subagent | ✅ done |
| Parallel fan-out (one `Task` call spawning N subagents concurrently) | ❌ not used |
| Nested subagents (a subagent spawning its own subagent) | ❌ not used |
| Specialized agents beyond dev/reviewer | ❌ not used |
| BMAD persona integration | ❌ not used |
| Capability-tier routing (right agent for the story type) | ❌ not used |

### Specialist agents worth considering

- **planner** — for complex stories. Reads the story + docs, produces a short bulleted implementation plan, halts. Dev then implements against the plan. Auditable, useful for retros, opt-in per story.
- **test-author** — writes failing tests first; dev implements to pass them. The TDD round we discussed earlier.
- **debugger** — invoked by dev when stuck (rework attempt) or by reviewer when AC fails in non-obvious ways. Has read tools + Bash; cannot edit production code.
- **security-reviewer** — runs alongside `reviewer` on stories touching security-sensitive files (hooks, deny patterns, MCP server). Reviewer can delegate.
- **docs-writer** — owns README / docs/ stories instead of `dev`. Different prompt, different style guide.
- **architect** — for architecture-touching stories. Produces an ADR-style note before any code changes.

### Existing BMAD personas, currently unused by the orchestrator

These are installed and addressable today; we're just not routing through them:

- **Mary** (analyst) — for research stories (FR/NFR discovery).
- **John** (PM) — for spec-clarification stories or PRD edits.
- **Paige** (tech-writer) — natural fit for docs stories (the current sprint's 3.1 + 3.2 could route to her).
- **Winston** (architect) — for architecture-touching work.
- **Sally** (UX designer) — N/A here (no UI) but other projects could use.
- **Amelia** (dev) — generic dev; could replace our `dev` agent or complement it.

### Story-type → agent-team routing

Idea: each story declares a type, and the type maps to a fan-out plan.

| Story type | Team |
|---|---|
| `feature` (default) | `dev` → `reviewer` |
| `feature-tdd` | `test-author` → `dev` → `reviewer` |
| `complex-feature` | `planner` → `dev` → `reviewer` |
| `docs` | `tech-writer` → `reviewer` (relaxed AC) |
| `security` | `dev` → `reviewer` ∥ `security-reviewer` (parallel) |
| `architecture` | `architect` → `dev` → `reviewer` |
| `meta` (plugin self-edit) | `meta-dev` (deep tier) → `meta-reviewer` (deep tier) |

Different teams require different `allowed-tools` per agent. The MCP server doesn't change — it's still the deterministic core. Only `agents/*.md` and skill routing logic gain shape.

### Parallel fan-out

Two patterns worth exploring:

- **Competing diffs.** Spawn two `dev` subagents on the same story in parallel (in separate worktrees — same problem we hit for parallel stories). Reviewer picks the better diff. Quality bump for hard stories; doubles cost.
- **Concurrent specialists.** On a security story, spawn `reviewer` + `security-reviewer` in one `Task` call, await both, combine verdicts. No worktree problem because they only read.

### Open questions
- Should story type be a free string or a closed enum? Free is flexible; closed enables compile-time-style validation.
- Where does the routing logic live? Skill (markdown) or MCP server (TypeScript)? Per the "no business logic in markdown" rule, in the MCP server — a new `getStoryRouting(storyId)` tool returns the agent sequence.
- When BMAD personas are used, do they keep their BMAD-defined `allowed-tools` or do we override with orchestrator-flavored permissions?
- Parallel fan-out for review is easy (read-only). For dev, do we want it at all in v1, or wait for the parallel-stories work (which already needs worktrees)?
- Nested subagents: do we let `dev` spawn `debugger` directly, or does the orchestrator skill intermediate?

### How it composes with the others

- **Tiering** picks per-agent. Specialist agents each get a tier default (debugger=deep, docs-writer=fast, etc.).
- **Retros** capture per-agent timing/quality signals → drives future routing decisions.
- **Self-rewriting** could update story-type routing maps based on retro evidence.
- **PR-per-story** is orthogonal — the team produces a diff, the PR step is the same regardless of who wrote it.

---

## 6. Agent-to-agent communication

Today agents communicate **only through the skill**: each `Task(subagent)` call returns a single text value to the parent, and side-channel info flows via `sprint-status.yaml` writes (claim, mark-complete, etc.). No agent talks directly to another mid-flight.

Direct or structured channels would unlock new patterns. Question is which patterns are worth the complexity.

### Pattern catalog

| Pattern | Direction | Why useful | Why risky |
|---|---|---|---|
| **Annotated handoff** | dev → reviewer | Dev writes "implementation notes" — choices made, areas of uncertainty, where AC felt ambiguous. Reviewer reads before judging. Reduces "diff archaeology." | Adds writing burden; might be summarized away. |
| **Rework dialogue (bidirectional)** | reviewer ↔ dev across rounds | Beyond a one-shot feedback string — dev can ask a clarifying question via the same channel, reviewer answers in the next round. | Stories drift into chat that never converges. Needs strict turn cap (the rework_limit already bounds this if we reuse it). |
| **Specialist consultation** | dev → specialist (mid-implementation) | Dev pauses, asks `security-reviewer` "is this approach OK before I keep going?" Avoids wasted work. | Requires nested subagent invocation (which we don't do today). Cost compounds. |
| **Persistent story thread** | all agents → shared log | One append-only file per story. Every agent jots its reasoning + decisions. Becomes the story's "minutes," feeds retros, reviewable post-hoc. | Storage growth. Might duplicate what `run.log` and retros already carry. |
| **Consensus on parallel review** | multiple reviewers → aggregator | When `reviewer` and `security-reviewer` run in parallel, both return verdicts; the skill (or a small "synthesizer" subagent) combines. | Tiebreaker rules need defining — agree, disagree, abstain. |
| **Broadcast / pubsub** | one agent emits → many react | Reactive multi-agent. | Almost certainly overkill for our case. |

### Channel mechanisms

Which transport carries the message:

- **File system** — write a markdown file, the next agent reads it. Async, durable, auditable, debuggable. *Works today.*
- **MCP state extension** — fields under `story.orchestrator.thread[]` or similar. Single source of truth, structured. *Cheap addition.*
- **Direct tool call** — synchronous request/response between agents. Powerful but invisible after the fact unless logged.
- **`run.log` lifecycle events** — fan-out style. Good for "what happened" replay, less good for live coordination.

Best fit per pattern:

| Pattern | Best channel |
|---|---|
| Annotated handoff | MCP state field (`implementation_notes` on the story) |
| Rework dialogue | Extension of `last_review_feedback` into a `dialogue[]` array |
| Specialist consultation | Direct nested `Task` call |
| Story thread | File at `.sprint-orchestrator/threads/<storyId>.md`, append-only |
| Consensus on parallel review | Return-value aggregation in the skill (no new channel) |

### Top-3 worth doing for *our* orchestrator

1. **Annotated handoff (dev → reviewer).** Smallest change, biggest leverage. Add `implementation_notes` field on the story; dev populates it before signalling completion; reviewer's prompt instructs it to read those notes. Almost free.
2. **Persistent story thread.** Each agent involved writes a dated entry: dev notes, reviewer notes, rework reasoning, retro. By the time the story is done, the thread is the audit trail. Plays beautifully with retros (sprint retro reads N threads).
3. **Specialist consultation.** Only matters once we have specialists (section 5). Without specialists, dev has no one to ask.

The others (broadcast, parallel-consensus, bidirectional dialogue) earn their complexity later, if at all.

### Risks across the board

- **Chatty drift.** Without hard turn caps, agents will fill any communication channel. The rework loop's `rework_limit` is the model; every direct channel needs an equivalent.
- **Context inflation.** Each new channel is another thing for downstream agents to read. The fresh-context-per-subagent property is exactly what we're trying to preserve.
- **Prompt-injection surface.** One agent's output becomes another agent's prompt. We already accept this via the rework feedback path; expanding it expands the surface. Worth treating any agent-authored content as untrusted input.
- **Audit complexity.** More channels means retros have more to look at. Story thread (option 2 above) helps because it forces convergence into one log per story.

### How it composes with the others

- **Retros → consume threads.** Sprint retro reads every story's thread + structured retro. Threads add narrative; structured retros add metrics.
- **Agent teams → enables consultation.** Specialists only matter once they can be consulted. Communication is the verb that makes the team a team.
- **Tiering → cheap channels for cheap tiers.** Haiku-tier orchestrator can route messages without reading the full thread; specialists invoked at deep tier get the full context.
- **PR-per-story → thread is the PR description.** Render the story's thread into the PR body for human review. The PR becomes the artifact + the conversation.
- **Self-rewriting → meta-loop has its own thread.** Plugin-modifying stories should leave a heavier audit trail than feature stories. Same channel, different retention policy.

### Open questions

- Single channel design or multiple? My instinct: start with **one** (the persistent story thread) and grow from there. Resist multi-channel until a pattern fights for it.
- Is the thread structured (sections per author) or freeform (chronological log)? Structured is easier to aggregate; freeform is more honest about agent voice.
- Read-everything default, or readers opt in? If every agent reads every prior agent's notes by default, context grows fast.
- Bounded dialogue: cap on dialogue turns per story (or per rework round)?
- Trust model: are agent-authored thread entries trusted equally with code? My instinct: no — treat as input, not gospel.

---

## Composition notes

The six ideas reinforce each other:

- **Retros → tier feedback.** Retros can recommend tier-default changes per story type.
- **Rework → tier escalation.** The rework loop (Epic 1 of current sprint) is the natural escalation moment for tiering.
- **Meta-loop → deep tier.** Plugin self-editing should always be at the top tier.
- **PR-per-story → retro in PR body.** Reviewing the work + retro together is a clean human surface.
- **Agent teams → tier-per-specialist.** Each specialist agent gets a tier default (debugger=deep, docs-writer=fast). Story-type routing is what makes tiering interesting beyond static defaults.
- **Agent teams → retro signal.** Per-agent timing/quality data feeds retros which feed routing maps.
- **Communication → makes teams real.** Specialists you can't talk to aren't a team. Story-thread + handoff-notes patterns turn `dev`/`reviewer` and any future specialists into actual collaborators.

Implies a likely build order:
1. Current sprint (`orchestrator-polish-sprint-1`) finishes — gives us rework loop + observability foundation.
2. Retros next (story-level + sprint-level capture; storage choice settled).
3. Agent teams + communication + model tiering as a coupled triple (specialist agents that can actually talk to each other, with tier defaults; rework escalation built in). Communication's smallest version (`implementation_notes` handoff) could even ship earlier as a tiny standalone story.
4. PR-per-story (independent; can slot in anytime).
5. Self-rewriting / meta-loop last (depends on retros + tiering being mature; biggest blast radius; needs Level 1 → 2 → 3 staging).

Each becomes its own sprint plan — won't fit in one BMAD pass.
