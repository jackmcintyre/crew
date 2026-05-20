# Non-Functional Requirements

Only the categories that materially apply to v1 are included. Categories explicitly excluded are listed at the end.

## Performance

- **NFR1 (Reviewer runtime, soft):** Reviewer subagent completes review and posts verdict within **3 minutes** wall-clock on a typical story PR (≤500 LOC diff, ≤10 standards criteria).
- **NFR2 (Reviewer runtime, hard):** Reviewer subagent invocations exceeding **8 minutes** are treated as failed by the dev session and routed to the failure path (verdict comment substituted with failure comment, `needs-human` label applied, story not marked failed).
- **NFR3 (Dev subagent runtime, hard):** Dev subagent invocations exceeding a configurable per-story budget (default 30 minutes) are treated as stuck and surfaced by the orchestration session.
- **NFR4 (Orchestration polling cadence):** Orchestration session polling loop completes one pass within **30 seconds** under normal load, including filesystem scan and surface generation.
- **NFR5 (Install-to-first-merged-PR, target user):** On a clean machine for a first-time user, the elapsed time from `gh repo clone` to first merged PR via the canonical scenario is **≤1 hour**, including reading the README.

## Reliability

- **NFR6 (No silent failures):** 100% of agent invocations produce a visible artifact — a verdict comment, a failure comment, a blocker entry, a retro entry, an orchestration-session surface, or a clear error message. No agent invocation ever ends without producing a trace. **Measurement:** an integration test in the plugin's test suite asserts that for every recorded invocation in the JSONL telemetry log (NFR21), a paired artifact exists at the declared sink (PR comment, story-frontmatter field, orchestration-surface line, or `failure-log/` entry); CI fails on any unpaired invocation.
- **NFR7 (Recoverable session death):** If any session (planning, dev, orchestration) dies for any reason, re-running its launching slash-command resumes cleanly from filesystem state without data loss or duplicated work. **Measurement:** an integration test kills each session at three checkpoints (mid-claim, mid-dev, post-handoff-pre-review), relaunches the slash-command, and asserts (a) no story is observed in two state directories simultaneously, (b) no story claimed by the dead session blocks a relaunch, (c) no duplicate PR or duplicate verdict comment is produced on the same story.
- **NFR8 (Atomic state transitions):** Story file state moves between `to-do/`, `in-progress/`, `blocked/`, and `done/` are atomic at the filesystem level (single `mv` syscall). No story can be observed simultaneously in two states.
- **NFR9 (No story-state corruption from agent failure):** An agent failure (timeout, rate-limit, model error) never mutates a story's canonical state from done-shaped to failed-shaped or vice versa. **Measurement:** a fault-injection integration test triggers each failure class (model timeout, `gh` rate-limit, subprocess crash) during dev and reviewer phases, then asserts (a) story directory location is unchanged from the pre-fault snapshot for any story not yet acted on, and (b) any story acted on is in exactly one of `to-do/`, `in-progress/`, `blocked/`, or `done/` — never observed as done-then-failed or failed-then-done.
- **NFR10 (Idempotent skill invocations):** Re-invoking any `/<plugin>:*` slash-command is safe — it either resumes existing work or no-ops with a clear message; it never duplicates or corrupts state. **Measurement:** an integration test invokes each `/<plugin>:*` skill twice back-to-back from the same workspace state and asserts (a) no new story files are created on the second run, (b) no new PRs or duplicate comments are posted, (c) no persona file gains a duplicate knowledge-section entry, (d) the second run's terminal output explicitly states the no-op or resume condition.
- **NFR11 (Idempotent reviewer re-run):** Re-running the reviewer subagent on a PR produces the same PR-state shape as a first run (one verdict comment, one set of inline comments, one set of labels) — not stacked artifacts.

## Security & Permissions

- **NFR12 (Bounded agent authority):** Every agent's effective permissions are exactly the tools declared in its agent spec. No agent can invoke an unlisted tool. Enforced at the plugin runtime, not at the prompt layer.
- **NFR13 (No silent authority escalation):** Changes to agent permission specs are reviewed in version control via the same PR flow as application code.
- **NFR14 (No remote data exfiltration):** No agent transmits diff contents, repo contents, or user code to any destination other than the user's own GitHub (via `gh`) and the model API the user's Claude Code installation is configured to use. Every other network path is forbidden by agent permissions.
- **NFR15 (Local-first by construction):** No telemetry is sent to any remote service. All state — story files, rule registry, retro proposals, telemetry logs — lives on the user's local filesystem.
- **NFR16 (Negative-capability enforcement):** Reviewer subagent cannot close, merge, or request-changes on PRs; cannot push commits; cannot edit repo files. Retro agent cannot mutate rule registry or standards doc directly. Planning agent cannot commit story files without user confirmation. All enforced at the tool-allowlist layer.

## Integration

- **NFR17 (`gh` is the only GitHub surface):** The plugin interacts with GitHub exclusively via the user's installed `gh` CLI, using the user's existing auth. No new tokens, no GitHub Apps, no direct REST/GraphQL clients.
- **NFR18 (Graceful `gh` failure handling):** When `gh` returns an error (rate limit, auth expired, network failure), the plugin classifies it as recoverable and either defers, retries, or routes to a `needs-human` surface — never marks a story failed for a `gh` error alone. **Measurement:** the recoverable-error classification is encoded in a versioned mapping table (`gh` exit codes and stderr patterns → `defer | retry | needs-human`) shipped in the plugin source; an integration test stubs `gh` to return each mapped error class and asserts (a) the story remains in `in-progress/` or moves to `blocked/`, never to a failed state, and (b) a `needs-human` surface line is produced within one orchestration loop.
- **NFR19 (Filesystem is the only coordination surface):** Inter-session coordination uses atomic filesystem moves on story files. No daemon, no shared in-memory store, no message broker.
- **NFR20 (Claude Code is the only runtime):** The plugin runs inside the user's existing Claude Code installation. No bundled runtime, no separate process manager, no background daemon.

## Observability

- **NFR21 (Structured telemetry):** Every agent invocation produces a structured local log entry (JSONL or equivalent) parseable without an LLM — single-line, well-typed.
- **NFR22 (Standards and plugin version traceability):** Every reviewer verdict comment includes both the standards-doc version it ran against and the plugin's own semantic version. Reviewing a PR weeks later, anyone can recover which version of the rubric was applied *and* which plugin build produced the verdict.
- **NFR23 (Outcome-stats observability):** The user can compute rule fire counts (before/after a rule's introduction) at any time without an LLM in the loop — pure helper, deterministic output.
- **NFR24 (Agreement-metric observability):** The user can compute the rolling verdict-vs-action agreement metric across a configurable window at any time without an LLM in the loop.
- **NFR25 (Persona-file readability):** Every persona file is plain Markdown, human-readable, editable in any text editor, and committable through standard git.
- **NFR26 (Persona-update gate):** Every append to a persona's knowledge section in v1 is gated through diff-then-confirm; no agent can silently mutate its own persona.
- **NFR27 (Persona-file integrity):** Persona files are version-controlled in the target repo. Bad accumulation is recoverable via `git revert` on the persona file without affecting other repo state.
- **NFR28 (Team-state observability):** The current team's roster, each role's domain, recent persona-knowledge entries, and fire counts are readable without an LLM in the loop — pure file reads.
- **NFR29 (Yield-protocol observability):** Every yield handoff between agents is recorded in telemetry with both roles named and the triggering domain; an LLM is not required to inspect the handoff history.

## Explicitly out of scope (v1 NFR-wise)

- **Scalability** — v1 is single-user, single-target-repo, single-cycle-at-a-time. No expectation of thousands of concurrent dev subagents or multi-tenant isolation. Capacity questions are deferred to Growth.
- **Accessibility** — output surfaces are terminal text, PR comments rendered by GitHub, and local Markdown files. The plugin renders no UI it controls; accessibility concerns route to Claude Code and GitHub upstream.
- **Localisation** — English only. Standards docs, story files, and agent prompts are in the language the user authors them in; no translation layer in v1.
- **Multi-user permissions / RBAC** — only the operator runs the plugin. No multi-user authorisation surface in v1.
- **Backwards compatibility** — greenfield product; no migration constraints from sprint-orchestrator or any prior shape.
