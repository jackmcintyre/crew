# Domain-Specific Requirements

Domain is *AI agent orchestration / developer tooling*. No statutory compliance (no HIPAA / PCI / GDPR data flows — the product operates on the user's own code, locally and via GitHub API). The domain-specific concerns are about trust calibration, LLM nondeterminism, and the operational surface of multi-agent runtimes.

## Trust & Calibration

- **Every agent is an LLM** — dev, reviewer, planning, retro. They hallucinate, miss real issues, contradict themselves on rerun, and drift over time as upstream model versions change. The PRD treats this as the first-class operational risk, not a side note.
- **The standards doc is falsifiable on purpose.** Each criterion must be checkable from a diff or PR-attached files. Vague criteria ("code should be clean") are disallowed by the doc's contract.
- **No silent authority escalation.** Agent permissions are bounded by explicit allowed-tool lists in their agent specs. The reviewer cannot push commits. The retro agent cannot mutate the rule registry directly — it produces proposals that the user gates. The planning agent cannot commit story files without user confirmation. Authority limits are enforced at the plugin-permission layer, not just by prompt.
- **The calibration loop is the safeguard against drift.** Without retros producing rule and skill updates from observed misses, the system's quality compounds in the wrong direction. The product designs for this explicitly — the loop is not optional polish.

## LLM Nondeterminism

- **Same input, different output, sometimes.** A reviewer agent can produce different verdicts on the same PR across runs. The product mitigates by making the verdict comment idempotent (rerun edits the prior comment rather than stacking) and by treating verdict disagreement across reruns as a signal the standard needs sharpening — not a system fault.
- **Long-running session drift.** Continuous-flow sessions can run for hours. Agent context windows fill; behaviour shifts. The product mitigates by spawning per-story subagents from a clean context rather than running one mega-agent across all stories.
- **Cross-model upgrades.** When the underlying model family upgrades, agent behaviour changes. The product mitigates by version-stamping agent prompts and standards doc; retros across a model upgrade are flagged so the user can interpret deltas in context.

## GitHub API integration constraints

- **`gh` is the only integration surface.** No new tokens, no GitHub Apps, no direct REST/GraphQL clients. Relies on the user's existing `gh` auth.
- **Rate limits.** A repo running many PRs per cycle can hit secondary rate limits. Agent invocations must recognise `gh` rate-limit errors and treat them as recoverable (defer / retry / fall back to `needs-human`), not as story failures.
- **Permissions surface.** Each agent's allowed `gh` subcommands are declared explicitly in its agent spec. Permission grants are reviewable in version control.

## Repo-shape constraints

- **`docs/standards.md` must exist in the target repo** for v1. No remote standards, no fallback default. Plugin errors clearly when missing, pointing at the example template.
- **Standards doc is version-controlled** in the same repo it governs. Changes to it go through the same PR flow the standard reviews, creating a self-applying audit trail.
- **The plugin and the target repo can be the same repo** (Jack dog-fooding the plugin on itself) or different repos (Maya running the plugin against her CLI project). The product must handle both.

## Cost & runtime constraints

- **Token cost per cycle is observable** via per-agent telemetry. No hard cap in v1 — soft monitoring only. A hard cap is a Growth-phase item once observed cost patterns justify the risk of orphaned mid-story aborts.
- **Wall-clock budgets per agent invocation.** Soft target 3 min for reviewer; hard 8 min before orchestrator routes to `needs-human`. Dev agent budgets are story-dependent; explicit budget per story is a Growth item.
- **Three concurrent sessions = three concurrent token budgets.** Cost is meaningfully higher than single-session orchestration. Telemetry must make this visible per cycle so users can detect runaway cost early.

## Risks & Mitigations (domain-level — strategic risks are in their own section below)

| Risk | Mitigation |
|---|---|
| Reviewer false-greens a real bug | Calibration loop catches it via retro; first occurrence pauses the auto-merge tier until the standard tightens |
| Reviewer false-positives (false rigour) | User overrides freely (auto-merge only on `READY FOR MERGE`; user keeps the merge button in all other cases); pattern surfaces in retro; standard relaxed |
| Standards doc bloats into "definition of perfect" | Hard cap of 10 criteria in v1; growth only from observed misses; explicit "remove or relax" target per cycle |
| Agents drift across model upgrades | Version-stamped prompts and standards; upgrade-spanning retros flagged for human interpretation |
| GitHub rate limits stall the dev loop | `gh` errors classified as recoverable; orchestration session surfaces a "stalled on rate limit" status, not a story failure |
| Three concurrent sessions burn unexpected cost | Per-cycle telemetry surface; soft alert when cost exceeds prior cycle's by a configurable factor |
| Long-running session context drift | Per-story subagent spawns from clean context, not one persistent mega-agent |
| Filesystem race on atomic moves | `mv` is the atomic primitive; claim mechanism uses directory move (not lockfile or frontmatter write); stale-claim detection in the orchestration session |
