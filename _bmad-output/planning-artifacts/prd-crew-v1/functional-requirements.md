# Functional Requirements

This FR list is the capability contract for AI Engineering Team v1. Each FR is a testable capability. Implementation choices (which `gh` flag, which agent prompt phrasing, which JSONL format, which directory exactly) are left to architecture. Actors: **User** (Jack / Maya-like operator), **Planning agent**, **Dev agent**, **Reviewer agent**, **Orchestration agent**, **Retro agent**, **Plugin runtime** (MCP server + skills), **Standards doc** (`docs/standards.md` in target repo), **Rule registry** (`discipline-rules.yaml`).

## Planning conversation

- **FR1:** The user can open a planning conversation via a slash-command (`/<plugin>:plan`).
- **FR2:** The planning agent can interpret a free-form intent into a candidate set of stories.
- **FR3:** The planning agent can produce story files that conform to the story file shape (FR9–FR13). Target: ≥90% of planning runs over a rolling 20-cycle window produce story files the user commits without structural edits (frontmatter shape, AC presence, dependency declaration) — body-text edits do not count against the metric.
- **FR4:** The planning agent can elicit acceptance criteria at the user-value level (what the user *does*), not at the implementation level.
- **FR5:** The planning agent can detect that a story is state-mutating and require at least one integration AC before accepting the story as complete.
- **FR6:** The planning agent can detect implicit cross-story dependencies and prompt the user to make them explicit in `depends_on`.
- **FR7:** The planning agent can refuse to commit a backlog that is missing a ship-gate story.
- **FR8:** The planning agent can be re-opened mid-cycle to add stories, modify pending stories in `to-do/`, or discard a built feature by producing a new "revert" story.

## Story files and backlog management

- **FR9:** The plugin can persist each story as a single Markdown file with YAML frontmatter under `stories/{to-do,in-progress,blocked,done}/`.
- **FR10:** Story frontmatter can carry: `id`, `title`, `depends_on`, `status`, `blocked_by`, `claimed_by`, `risk_tier`.
- **FR11:** Story frontmatter can carry retro fields after completion: `lessons[]`, `failure_class`, `duration_seconds`, `rework_count`. Each entry in `lessons[]` carries a `kind:` field constrained to one of `pitfall` (failure-driven lesson; surfaces as a candidate rule), `pattern` (success-driven lesson; surfaces as a candidate skill), `tool-quirk` (workaround for an external tool's behaviour), or `discipline` (process or planning lesson). The retro agent uses `kind` to route lessons into the two-section proposal output (FR59).
- **FR12:** Story body can carry: narrative description, acceptance criteria (at least one integration AC for state-mutating stories), implementation notes.
- **FR13:** The plugin can validate a story file against the story-file contract and refuse malformed stories with a human-readable error.
- **FR14:** The user can edit any story file directly (text editor) while it is in `to-do/` or `blocked/`. Edits to stories in `in-progress/` are not supported in v1.

## Continuous-flow runtime

- **FR15:** The user can launch the dev session via a slash-command (`/<plugin>:start`).
- **FR16:** The user can launch the orchestration session via a slash-command (`/<plugin>:watch`).
- **FR17:** The plugin can claim a story for dev work by atomic move from `to-do/` to `in-progress/`.
- **FR18:** The plugin can verify a story's `depends_on` list by checking presence of the dependency story files in `done/`; the dev session can refuse to claim a story whose dependencies are not all in `done/`.
- **FR19:** The plugin can complete a story by atomic move from `in-progress/` to `done/`.
- **FR20:** The plugin can mark a story blocked by atomic move from `in-progress/` to `blocked/` with `blocked_by` set in frontmatter.
- **FR21:** The dev session can pick the next available story from `to-do/` after marking the current story blocked, without waiting for the blocker to be resolved.
- **FR22:** The dev session can terminate naturally when `to-do/` and `in-progress/` are both empty.
- **FR23:** All three sessions can be relaunched after death without state corruption; on relaunch they read filesystem state and resume.

## Dev loop

- **FR24:** The dev session can spawn a per-story dev subagent from a clean context for each claimed story.
- **FR25:** The dev subagent can implement the story against its narrative and acceptance criteria.
- **FR26:** The dev subagent can signal handoff to a reviewer subagent via a locked phrase.
- **FR27:** The dev session can spawn a per-story reviewer subagent from a clean context on handoff.
- **FR28:** The dev subagent can record an integration-AC failure as a rework signal rather than a story failure when the reviewer marks the story as needs-rework.
- **FR29:** The dev subagent can `git push` and open a PR via `gh pr create` as its terminal action.

## Review and verdict

- **FR30:** The reviewer subagent can read the story file, the diff, and `docs/standards.md` from the target repo.
- **FR31:** The reviewer subagent can run story acceptance criteria as part of its review.
- **FR32:** The reviewer subagent can judge the diff against `docs/standards.md` criteria.
- **FR33:** The reviewer subagent can post inline review comments on the PR.
- **FR34:** The reviewer subagent can post a summary verdict comment whose final line matches one of: `**Verdict: READY FOR MERGE**`, `**Verdict: NEEDS CHANGES** [N issues, M questions]`, `**Verdict: BLOCKED** [<reason>]`.
- **FR35:** The reviewer subagent can stamp both the standards-doc version and the plugin's own semantic version (read from the plugin manifest) into the verdict comment.
- **FR36:** The reviewer subagent can apply the label `reviewed-by-agent` on every successful run and `needs-human` on `NEEDS CHANGES` / `BLOCKED` / reviewer-failure.
- **FR37:** The reviewer subagent cannot close, merge, or formally request changes on the PR (negative capability, enforced by tool allowlist).
- **FR38:** The reviewer subagent cannot push commits or edit files in the target repo (negative capability).
- **FR39:** On re-invocation against the same PR, the reviewer subagent can locate its prior verdict comment by footer marker and edit it in place rather than posting a new one.
- **FR40:** The plugin can auto-merge a PR with verdict `READY FOR MERGE` *only* when its story `risk_tier` is `low` AND the rolling verdict-vs-action agreement metric is at or above the configured threshold (default 80%).
- **FR40a (risk-tier classification rules — v1 architecture deliverable):** The concrete rules that assign a `risk_tier` to a story (`low | medium | high`) — based on path patterns, change-type signals (revert, migration, schema change, dependency bump), and diff-size thresholds — are a required v1 architecture deliverable. The PRD does not pin the rule set; architecture must produce a versioned classification spec (`docs/risk-tiering.md` or equivalent) before v1 ships. Until then, the planning agent assigns `risk_tier` manually with user confirmation.
- **FR41:** The plugin can pause a PR for the user when its story `risk_tier` is `medium` or `high`, regardless of verdict.
- **FR42:** The user can merge any PR manually, including ones with `NEEDS CHANGES` or `BLOCKED` verdicts (override authority is preserved).

## Standards doc

- **FR43:** The plugin can locate `docs/standards.md` at a conventional path in the target repo.
- **FR44:** The plugin can parse `docs/standards.md` and extract: version, list of criteria (with name, what, check, anti-criterion), updated date.
- **FR45:** The plugin can detect a missing or malformed `docs/standards.md` and produce a clear human-readable error pointing at the example template.
- **FR46:** The plugin can refuse to run when `docs/standards.md` declares more than 10 criteria (hard cap).
- **FR47:** The plugin can ship a `docs/standards-example.md` template inside the plugin directory as a copy-target.
- **FR48:** The plugin can regenerate `docs/standards.md` deterministically from `discipline-rules.yaml` on `accept-proposal`.

## Orchestration and blocker handling

- **FR49:** The orchestration session can poll `in-progress/` and `blocked/` on a loop (default 120 seconds; configurable).
- **FR50:** The orchestration session can detect stuck stories (in-progress beyond a configurable timeout) and surface them.
- **FR51:** The orchestration session can detect stale claims (`claimed_by` references a session id that is not currently live) and surface them.
- **FR52:** The orchestration session can surface blockers, stuck stories, and stale claims as a single one-line terminal surface per item.
- **FR53:** The user can resolve a blocker by editing the story file and moving it back to `to-do/` (or by letting the orchestration session move it on next loop after the user updates frontmatter to clear `blocked_by`).
- **FR54:** The orchestration session cannot mutate dev-loop state directly — it can only surface and (optionally) move resolved blockers back to `to-do/`.

## Retro and calibration

- **FR55:** The reviewer subagent can record story-level retro entries (structured `lessons[]`, `failure_class`, duration, rework count) into the story frontmatter on completion.
- **FR56:** The user can invoke a cycle-level retro via slash-command (`/<plugin>:retro`).
- **FR57:** The retro agent can read all story retros in the current cycle, the rule registry, and the outcome stats.
- **FR58:** The retro agent can produce a single proposal markdown file under `_bmad-output/retro-proposals/<ISO-timestamp>.md`.
- **FR59:** The retro agent's proposal file can contain failure-driven rule proposals (text, target_failure_class, recommended promotion_level) and success-driven skill proposals (proposed path, frontmatter description, body).
- **FR60:** The retro agent cannot mutate the rule registry, `docs/standards.md`, sprint-history, or plugin skills directly (negative capability, enforced by tool allowlist).
- **FR61:** The user can invoke a proposal-apply flow via slash-command (`/<plugin>:accept-proposal <id>`) that presents a diff and requires confirmation before mutating canonical state.
- **FR62:** The plugin can apply an accepted rule proposal by mutating `discipline-rules.yaml` and regenerating `docs/standards.md` (and `planning-discipline.md` if present).
- **FR63:** The plugin can apply an accepted skill proposal by writing the proposed `SKILL.md` to its path; the plugin refuses to overwrite an existing file at that path.
- **FR64:** The plugin can detect a promotion threshold being hit for any `failure_class` in the current cycle and flag it for the retro agent.
- **FR64a (rule retirement):** The retro agent can detect rules in `discipline-rules.yaml` whose target `failure_class` has not fired for a configurable number of consecutive cycles (default `M = 5`) and emit a retirement proposal alongside rule, skill, and team-change proposals. A retirement proposal carries: target rule id, fire count over the observation window, recommended action (retire | relax to advisory). The user applies a retirement proposal via the same `/<plugin>:accept-proposal <id>` flow (FR61); on accept, the rule is removed from `discipline-rules.yaml` (or its `level:` field demoted) and `docs/standards.md` is regenerated. Closes the eighth step of the calibration loop ("retire stale rules"); paired with the "≥1 add and ≥1 remove/relax per cycle" measurable outcome in §Success Criteria.

## Telemetry and outcome verification

- **FR65:** The plugin can record a structured local log entry per agent invocation containing: agent type, story id, wall-clock runtime, timestamp.
- **FR66:** The plugin can record a structured local log entry per reviewer verdict containing: PR number, verdict, standards version, eventual merge action (computed retrospectively).
- **FR67:** The plugin can compute the rolling verdict-vs-action agreement metric across a configurable window.
- **FR68:** The plugin can compute outcome stats per rule in `discipline-rules.yaml`: target-failure-class fire counts before and after `introduced_at`, plus delta.
- **FR69:** The plugin can archive a drained cycle's state to `_bmad-output/sprint-history/<cycle-id>-<timestamp>.yaml` (or equivalent) so historical data survives across cycles.
- **FR70:** The user can read all telemetry artifacts directly as local files; no remote service is required.

## Install, distribution, and onboarding

- **FR71:** The plugin can be installed by cloning the repo it ships in and loading it into the user's Claude Code installation; no npm install or remote channel is required.
- **FR72:** The plugin can ship a bundled example target repo at `plugins/<plugin-name>/example/` containing a primed `to-do/` queue, an example `docs/standards.md`, and the canonical scenario the user runs on first install.
- **FR73:** The plugin's README can walk the install path end-to-end with verifiable checkpoints (install Claude Code, install plugin, copy standards template, run example, point at own repo).
- **FR74:** The plugin can run against either the same repo it ships in (Jack's dog-fooding configuration) or against a different target repo (Maya's configuration).
- **FR75:** The plugin can document a one-page "what to do if a session dies" recovery guide as part of the README.

## Non-engineer ergonomics

- **FR76:** The planning agent can be consulted in a separate session about an open reviewer verdict comment without breaking the dev loop ("ask a non-dev agent to translate" affordance).
- **FR77 (guideline, non-testable):** The planning agent should produce story files whose body and ACs are written in plain language accessible to a non-engineer who can read code at skim level. This is a stylistic guideline included in the planning agent's prompt rather than a testable contract; behaviour is shaped via the planning agent's persona and refined through retros, not asserted by an automated check.
- **FR78:** The planning agent can support "discard a built feature" as a first-class conversational outcome, producing a revert/deprecate story rather than a code-edit story.

## Permissions and authority

- **FR79:** Every agent declares its allowed tools and `gh` subcommands explicitly in its agent spec file, which is version-controlled.
- **FR80:** The plugin runtime enforces agent permissions at the tool layer, not via prompt alone (an agent attempting an unlisted tool is refused, not just discouraged).
- **FR81:** No agent has authority to mutate canonical state (story files, rule registry, standards doc, persona files) without either user confirmation or its dedicated MCP tool boundary.

## Team formation and persona management

- **FR82:** The plugin can ship a catalogue of pre-defined agent roles at `plugins/<plugin-name>/catalogue/<role>.md`, each declaring `domain:`, default model tier, default tool allowlist, locked phrases (handoff, yield, verdict format), and prompt body.
- **FR83:** The catalogue can include at minimum: planner, generalist dev, generalist reviewer, retro analyst, orchestrator, security specialist, test specialist, docs specialist, debugger.
- **FR84:** The user can open a hiring conversation via slash-command (`/<plugin>:hire`).
- **FR85:** The hiring manager can read the target repo at a high level (language, layout, README, recent git activity, dependency manifest) to detect project signals.
- **FR86:** The hiring manager can recommend a starting team from the catalogue with one-sentence justification per role.
- **FR87:** The hiring manager can default to a general-purpose roster (planner, generalist dev, generalist reviewer, retro analyst, orchestrator) when no specialist signals are detected.
- **FR88:** The user can approve all recommended hires, approve a subset, decline, or request a specific catalogue role not initially recommended.
- **FR89:** The plugin can instantiate a hired role as a persona file at `<target-repo>/team/<role>/PERSONA.md` containing: `domain:`, prompt body copied from the catalogue at hire time, empty knowledge section.
- **FR90:** The user can run `/<plugin>:hire` against an existing team to edit composition (hire one more, unhire, view persona); the hiring manager surfaces current roster on re-run.
- **FR91:** The user can opt out of the hiring conversation via a "skip hiring, use default team" fast path that hires the default roster directly without an interactive flow.
- **FR92:** The hiring manager cannot generate new agent specs outside the catalogue in v1 (negative capability); a manual escape hatch lets the user hand-author a role file under `<target-repo>/team/custom/` that the hiring manager can then propose.
- **FR93:** Each hired agent reads its persona file at session start and operates against the prompt body + accumulated knowledge.
- **FR94:** Each hired agent can propose appends to its persona file's knowledge section at session end ("what I learned this cycle").
- **FR95:** Persona-knowledge appends are gated through diff-then-confirm in v1; the user reviews each proposed append before it persists.
- **FR96:** The user can read and edit any persona file directly with a text editor at any time.
- **FR97:** Persona files are stored in the target repo's working tree and committed via the same `git` flow as other repo files; bad accumulation is recoverable via `git revert`.

## Domain-aware yield protocol

- **FR98:** Every catalogue role declares a `domain:` field — a short string naming the area of expertise the role owns.
- **FR99:** The plugin runtime can look up hired roles by `domain:` to support routing.
- **FR100:** A hired agent can yield work to another hired agent via a locked handoff phrase ("This sits in <role>'s domain — handing off"); the runtime routes the yield automatically when the named role exists in the hired team and its `domain:` matches the triggering string. When no matching role is found, the yield is surfaced to the user as a routing-failure entry on the orchestration surface (handled like a blocker), not silently swallowed.
- **FR101:** A specialist agent can refuse to defer when work falls inside its own `domain:`, even when another agent has produced a contrary verdict (in-domain insistence).
- **FR102:** A generalist agent can be expected to yield when work falls inside a hired specialist's `domain:` (out-of-domain deference).
- **FR103:** The yield protocol records each handoff in telemetry so retros can observe which roles fire how often.
- **FR104:** When no hired role's `domain:` matches the work, the generalist in the relevant lane (dev or reviewer) handles it without yield.

## Team-change proposals and team observability

- **FR105:** The retro analyst can emit team-change proposals (hire, unhire) alongside rule and skill proposals.
- **FR106:** Each team-change proposal includes: proposed action, target role, justification, predicted impact (which failure classes are expected to change).
- **FR107:** The user can apply an accepted team-change proposal via `/<plugin>:accept-proposal <id>`; hire proposals hand off to the hiring manager to draft a persona file; unhire proposals create a "decommission" record (the persona file is archived, not deleted).
- **FR108:** The user can view the current team via slash-command (`/<plugin>:team`) — roles, domains, fire counts per role, recent persona-knowledge entries.
- **FR109:** The user can open a side-session with a specific hired role via slash-command (`/<plugin>:ask <role>`) without mutating dev-loop state — used to ask the planner to translate a reviewer comment, the security specialist to explain a finding, etc.
- **FR110:** `computeOutcomeStats` can report failure-class fire counts before and after each team-composition change (hires and unhires), in addition to before/after each rule introduction.
