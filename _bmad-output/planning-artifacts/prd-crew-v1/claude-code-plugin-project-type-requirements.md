# Claude Code Plugin — Project-Type Requirements

Closest project-type analogue from the standard catalogue is `developer_tool`. The product ships as a single Claude Code plugin; the rest of this section specifies its concrete shape.

## Project-Type Overview

The product ships as a **Claude Code plugin**, locally installable, by-repo distribution. No npm channel, no auto-update channel, no remote service. Installation is "clone this repo and load the plugin." The plugin contains: agent specs (one Markdown file per agent type), skills (slash-commands the user invokes), an MCP server (the orchestrator's state-machine boundary), and example artifacts (standards template, example backlog).

The plugin runs *inside* the user's existing Claude Code installation. It does not bundle a model, an API key, or a separate runtime. It inherits the user's Claude Code auth, `gh` auth, and shell environment.

## Technical Architecture Considerations

**Three-session continuous-flow runtime.**

- **Planning session.** A long-lived Claude Code session the user opens when they want to add to the backlog. Hosts the planning agent. Owns story authorship. Idle when the user is not actively planning.
- **Dev session.** A long-lived Claude Code session that drains the `to-do/` queue. Spawns a dev subagent per story (clean context per story; no mega-agent drift). On dev handoff, spawns a reviewer subagent. Moves story files between state directories atomically.
- **Orchestration session.** A long-lived Claude Code session running on a slow loop (every couple of minutes). Polls `in-progress/` and `blocked/`. Surfaces blockers, stuck stories, and stale claims to the user via a one-line terminal surface. Never blocks the dev loop; never interrupts the user with modal prompts.

**Filesystem-coordinated state machine.**

- Story files live in `stories/{to-do,in-progress,blocked,done}/`. Each story is a single Markdown file with YAML frontmatter and a body.
- The state machine is the directory the story file currently lives in. Transitions are atomic `mv` operations.
- Frontmatter holds: `id`, `title`, `depends_on`, `status`, `blocked_by`, `claimed_by`, `risk_tier`, plus retro fields appended at completion (`lessons[]`, `failure_class`, `duration_seconds`, `rework_count`).
- Body holds the narrative description, acceptance criteria (at least one integration AC for state-mutating stories), and implementation notes.

**Agent catalogue, hired team, and persona files.**

Two distinct file locations:

- **Catalogue** at `plugins/<plugin-name>/catalogue/<role>.md` — pre-defined agent role templates shipped with the plugin. Each catalogue entry declares the role's `domain:`, default model tier, default tool allowlist, the locked phrases the agent uses (handoff, yield, verdict format), and the prompt body. Catalogue entries are not "agents" — they're templates the hiring manager instantiates.
- **Hired team** at `<target-repo>/team/<role>/PERSONA.md` — instantiated per project on hire. Each persona file contains: the role's `domain:`, the role's prompt body (copied from the catalogue at hire time so the team's behaviour is reproducible even if the catalogue changes), and an **accumulated knowledge section** that grows cycle over cycle as the agent appends "what I learned this cycle" entries (gated through diff-then-confirm in v1).

The hiring manager is the one exception — it lives in the catalogue but is always present and not user-hired. Its prompt body and tools are versioned with the plugin.

**Hiring manager specifics.**

- Reads the target repo at a high level (language, layout, README, recent git activity, top-level dependency manifest) to detect project signals.
- Recommends a starting team from the catalogue, with one-sentence justification per role.
- Defaults to the general-purpose roster (planner, generalist dev, generalist reviewer, retro analyst, orchestrator) when no specialist signals are detected; recommends specialists only when there's a concrete reason in the repo.
- Supports user actions: approve all, approve subset, decline, request a specific role from the catalogue, request a custom role (catalogue-bound in v1; flagged as a Growth ambition).
- On approval, drafts each role's persona file from the catalogue template, copies the prompt body, populates `domain:`, leaves the knowledge section empty.
- On retro-proposed team changes, the hiring manager runs again: drafts a new persona file for a proposed hire, or drafts a "decommission" record for a proposed unhire, both gated through user confirmation.

**Skills (user-facing slash-commands).**

- `/<plugin>:hire` — opens a hiring conversation with the hiring manager. Reads the repo, recommends a starting team or a change to the existing team, walks the user through approval. Idempotent — re-running on an existing team shows current roster and offers edit actions (hire one more, unhire, view persona).
- `/<plugin>:plan` — opens a planning conversation with the planner. Outputs story files into `stories/to-do/`.
- `/<plugin>:start` — launches the dev session loop. Idempotent; safe to re-run.
- `/<plugin>:watch` — launches the orchestration session. Idempotent.
- `/<plugin>:retro` — runs the cycle-level retro analyst. Produces a retro proposal markdown file (rules, skills, and team-change proposals).
- `/<plugin>:accept-proposal <id>` — applies an accepted retro proposal (rule registry mutation + standards regeneration, skill file write, or team-change handoff to the hiring manager). User-gated; diff-then-confirm.
- `/<plugin>:team` — one-shot snapshot of the hired team: roles, domains, fire counts, recent knowledge appended to each persona. Read-only.
- `/<plugin>:ask <role>` — open a side-session with a specific hired role for a question. Used by the user to ask the planner to translate a reviewer comment, the security specialist to explain a finding, etc. Does not mutate state.
- `/<plugin>:status` — one-shot snapshot of queue depth, claimed stories, blockers.

**MCP server (state-machine boundary).**

The plugin's MCP server exposes tools the agents call to mutate canonical state. Key tools (specifics in Functional Requirements):

- Story state moves (atomic file moves with frontmatter updates).
- Lesson and failure-class recording.
- Standards-doc lookup and version-stamping.
- Outcome stats computation (before/after fire counts per rule).
- Retro proposal application (user-gated mutation).
- Team management: read catalogue, list hired team, instantiate a persona file from a catalogue template (hire), decommission a persona file (unhire).
- Persona-file management: read persona for a role, append to knowledge section (always diff-then-confirm gated through the user in v1), look up a role by `domain:` (used by the yield protocol).

Agents never write to canonical state directly via the file system; they go through the MCP server. The filesystem layout *is* the state machine, but mutations are mediated to keep them atomic and observable.

**Standards doc resolution.**

- Lookup path: target-repo `docs/standards.md`. Only supported source in v1.
- Missing → hard error with a pointer to `plugins/<plugin-name>/docs/standards-example.md` (the copy-target shipped with the plugin).
- Malformed (more than 10 criteria; missing required fields) → hard error.
- The standards doc is version-stamped; the version is regenerated from `_bmad-output/planning-artifacts/discipline-rules.yaml` (the rule registry).

**GitHub interaction.**

Uses `gh` CLI exclusively. No direct REST/GraphQL clients in v1. Relies on the user's existing `gh` auth.

**Telemetry hook.**

Per-cycle telemetry surface (JSONL or equivalent, location TBD in design):

- Per agent invocation: agent type, story id, wall-clock runtime, token cost (if observable from the harness).
- Per reviewer verdict: PR number, verdict, standards version, eventual merge action (computed retrospectively).
- Per retro: proposals emitted, proposals accepted, rule fire counts.

This is the substrate for outcome verification.

## Implementation Considerations

- **Plugin-and-target-repo split.** v1 supports two configurations: (a) plugin and target repo are the same repo (Jack dog-fooding); (b) plugin lives in one repo, target lives in another. The plugin loads target-repo paths from a configured workspace root.
- **No daemon, no background process.** All three sessions are Claude Code sessions the user explicitly starts. If a session dies, the user re-runs the skill. State on disk (`stories/`, `discipline-rules.yaml`, retro files) is the recovery surface.
- **Idempotency everywhere.** `/<plugin>:start` re-run picks up where it left off. Reviewer rerunning on a PR edits its prior comment, doesn't stack. `accept-proposal` is idempotent against an already-applied proposal id (no-op with a clear message).
- **Permission spec is reviewable.** Every agent spec declares its allowed tools and `gh` subcommands explicitly. Changes to agent specs go through the same PR flow as application code.
- **No remote services.** No analytics calls home, no telemetry exfiltration. All telemetry is local files. The product is local-first by construction.
- **Bundled example.** The plugin ships an example target repo with a primed backlog so a new user can run the canonical scenario end-to-end on first install, before they trust the product with their real project. Lives at `plugins/<plugin-name>/example/`.
- **README walks the install path.** Single-page install guide: install Claude Code, install the plugin, copy the standards template, run the bundled example, then point it at your own repo. Each step is a verifiable checkpoint.
- **No Claude Code hooks in v1.** The plugin's user-facing surface is skills (slash-commands), agents (catalogue + persona files), and an MCP server. v1 does not register any Claude Code `PreToolUse` / `PostToolUse` / `Stop` hooks. If a hook becomes necessary later (e.g., to gate a tool invocation), it is a deliberate Growth-phase decision, not a v1 default.
- **Plugin versioning.** The plugin declares a semantic version in its top-level manifest. The version stamps reviewer verdict comments alongside the standards-doc version (NFR22 already covers the standards version; the plugin version answers "which plugin build produced this verdict"). v1 has no auto-update mechanism — version bumps land via the same clone-or-pull flow as the rest of the plugin's install path.
