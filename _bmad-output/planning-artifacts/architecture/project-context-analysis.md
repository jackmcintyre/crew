# Project Context Analysis

## Requirements Overview

**Functional Requirements (110 FRs across 14 groups):**

- **Planning conversation (FR1–FR8):** slash-command-driven planning agent that turns free-form intent into story files conforming to planning-discipline rules (integration ACs, explicit `depends_on`, ship-gate stories). Supports re-opening mid-cycle and "discard a built feature" as a first-class outcome.
- **Story files & backlog management (FR9–FR14):** single-Markdown-file-per-story with YAML frontmatter; lessons routed by `kind` (pitfall / pattern / tool-quirk / discipline); direct user-editable in `to-do/` and `blocked/` only.
- **Continuous-flow runtime (FR15–FR23):** three concurrent Claude Code sessions (planning, dev, orchestration); atomic `mv` between `to-do/`, `in-progress/`, `blocked/`, `done/`; dependency checks via presence in `done/`; all sessions re-launch from filesystem state.
- **Dev loop (FR24–FR29):** per-story dev subagent from clean context; locked handoff phrase to per-story reviewer subagent; rework signals; `gh pr create` as terminal action.
- **Review & verdict (FR30–FR42):** reviewer reads story file + diff + `docs/standards.md`; locked verdict grammar (`READY FOR MERGE` / `NEEDS CHANGES` / `BLOCKED`); risk-tiered auto-merge gated on a configurable agreement metric (default ≥80%); negative capabilities (no merge, no push, no edit) enforced at the tool layer. **FR40a is an explicit architecture deliverable**: produce a versioned risk-tier classification spec.
- **Standards doc (FR43–FR48):** target-repo `docs/standards.md`; ≤10 criteria hard cap; deterministic regeneration from `discipline-rules.yaml`; example template shipped with plugin.
- **Orchestration & blockers (FR49–FR54):** polling loop (default 120s); detects stuck stories and stale claims; one-line terminal surface; cannot mutate dev-loop state.
- **Retro & calibration (FR55–FR64a):** story-level retro on each completion; cycle-level retro produces a single proposal markdown file containing rule, skill, hire, unhire, *and rule-retirement* proposals; all user-gated through `accept-proposal`.
- **Telemetry & outcome verification (FR65–FR70):** structured local JSONL; agreement-metric and outcome-stats helpers (deterministic, no LLM); per-cycle archive to `sprint-history/`.
- **Install, distribution & onboarding (FR71–FR75):** clone-and-load (no npm); bundled example target repo; README with verifiable checkpoints; one-page session-death recovery guide.
- **Non-engineer ergonomics (FR76–FR78):** `/ask <role>` translate-a-comment affordance; plain-language story bodies (guideline); "discard a built feature" as a planning outcome.
- **Permissions & authority (FR79–FR81):** every agent declares allowed tools; runtime enforcement at the tool layer, not prompt; no canonical-state mutation without user confirmation or dedicated MCP tool.
- **Team formation & persona management (FR82–FR97):** catalogue at `plugins/<plugin>/catalogue/<role>.md`; persona files at `<target-repo>/team/<role>/PERSONA.md`; hiring manager catalogue-bound in v1; `skip hiring` fast path; diff-then-confirm persona-knowledge appends.
- **Domain-aware yield protocol (FR98–FR104):** locked handoff phrase, role-by-`domain:` lookup, in-domain insistence, out-of-domain deference; routing-failure surfaced as a blocker, not silently swallowed.
- **Team-change proposals & team observability (FR105–FR110):** retro analyst emits hire/unhire proposals with predicted-impact; `/team` snapshot; `/ask <role>` side-session; `computeOutcomeStats` reports fire counts across team-composition changes.

**Non-Functional Requirements (29 NFRs, 5 active categories):**

- **Performance:** reviewer ≤3 min soft / 8 min hard; dev default 30 min hard; orchestration pass ≤30s; install-to-first-merged-PR ≤1 hour for a first-time user.
- **Reliability:** no silent failures (CI-asserted artifact-pairing); recoverable session death (fault-injection-tested at three checkpoints); atomic state transitions; no story-state corruption on agent failure; idempotent skills and reviewer reruns.
- **Security & permissions:** bounded agent authority enforced at the tool layer; permission specs reviewable in version control; no remote exfiltration; local-first by construction; negative capabilities enforced at the tool allowlist.
- **Integration:** `gh` CLI is the only GitHub surface; recoverable-error classification table for `gh` exit codes/stderr → `defer | retry | needs-human`; filesystem-only inter-session coordination; Claude Code is the only runtime.
- **Observability:** structured JSONL telemetry; standards-doc version *and* plugin semver stamped on every verdict; deterministic helpers for outcome stats and agreement metric; persona files are plain Markdown, git-recoverable; every yield handoff recorded in telemetry.

**Explicitly out of v1:** scalability, accessibility (no plugin-owned UI), localisation, RBAC/multi-user, backwards compatibility.

**Scale & Complexity:**

- Primary domain: AI agent orchestration / developer tooling (locally-run Claude Code plugin).
- Complexity level: **high** (per PRD classification).
- Estimated architectural components: ~10 — catalogue, persona store, MCP server, three session runtimes, filesystem state machine, standards/rule pipeline, telemetry pipeline, risk-tier classifier, install/example bundle.

## Technical Constraints & Dependencies

- **Runs *inside* the user's existing Claude Code installation.** No bundled runtime, no bundled model, no API key. Inherits user's Claude Code auth, `gh` auth, and shell environment.
- **`gh` CLI is the only GitHub integration.** No new tokens, no GitHub Apps, no REST/GraphQL clients.
- **`docs/standards.md` must exist** in the target repo for v1; hard cap of 10 criteria; missing/malformed → hard error pointing at the shipped example template.
- **Plugin/target-repo split:** v1 must support both (a) plugin and target repo as the same repo (Jack dog-fooding) and (b) plugin in one repo, target in another (Maya). Workspace root is configurable.
- **No daemon, no background process.** All three sessions are Claude Code sessions the user explicitly starts; recovery is "re-run the skill."
- **No Claude Code hooks in v1.** User-facing surface is skills + agents + MCP server only. Hook registration is an explicit Growth-phase decision.
- **No npm channel, no auto-update.** Install path is "clone the repo and load the plugin."
- **`FR40a` is an open architecture deliverable:** the concrete risk-tier classification rules (path globs, change-type signals, diff-size thresholds) and the spec format (`docs/risk-tiering.md` or equivalent) are not pinned by the PRD and must be produced before v1 ships. Until then, planning agent assigns `risk_tier` manually with user confirmation.

## Cross-Cutting Concerns Identified

1. **Multi-session coordination without races.** Atomic `mv` as the only state-transition primitive; claim-by-directory-move; stale-claim detection in the orchestration session; never-two-states-at-once invariant. Required by NFR6–NFR10; backed by fault-injection integration tests at three checkpoints (mid-claim, mid-dev, post-handoff-pre-review).
2. **LLM nondeterminism control.** Clean per-story subagent contexts (no mega-agent context drift); reviewer reruns that *edit* the prior verdict comment rather than stack; version-stamped prompts and standards so retros across model upgrades are interpretable.
3. **Permissions as code.** Every agent declares its allowed tools and `gh` subcommands in its catalogue spec; persona files inherit the catalogue allowlist at hire time; enforcement at the plugin runtime / tool layer, not prompt; permission changes flow through the same PR review path as application code.
4. **Calibration loop integrity.** Rule registry (`discipline-rules.yaml`) is canonical; `docs/standards.md` regenerates from it; verdicts stamp both versions; retro proposals are user-gated through a unified `accept-proposal` flow; outcome stats are deterministic local computation (no LLM).
5. **Telemetry as substrate, not feature.** Agreement metric, outcome stats, and team-fitness signals all derive from the same local JSONL; helpers must be parseable without an LLM in the loop; per-cycle archive to `sprint-history/`.
6. **Idempotency everywhere.** Every `/<plugin>:*` slash-command can be re-run safely (resume or no-op with a clear message); reviewer reruns produce identical PR-state shape; `accept-proposal` is idempotent on already-applied proposal ids; tested via the NFR10 paired-invocation integration assertion.
7. **Plugin/target-repo split as a first-class concern.** Path resolution must distinguish plugin-shipped artifacts (catalogue, example, template) from target-repo artifacts (`stories/`, `team/`, `docs/standards.md`, `discipline-rules.yaml`, telemetry, retro proposals) cleanly in both same-repo and split-repo configurations.
8. **Failure visibility.** No silent failures invariant (NFR6) is CI-asserted by pairing every JSONL invocation entry with an artifact at its declared sink — applies across PR comments, story-frontmatter fields, orchestration-surface lines, and a `failure-log/` for catch-all cases.

