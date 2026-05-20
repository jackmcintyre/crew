# Success Criteria

## The single test of success (scenario, not metric)

**One external reader of Jack's eventual writeup clones the repo on a clean machine, installs the plugin, primes a continuous-flow backlog with a planning conversation, walks away, and comes back to a stack of merged PRs that delivers a working piece of software they want to keep using — without Jack on the chat at any point.**

This is the ship-or-don't ship test. Not a metric. Not a percentage. A specific human, a specific repo, a specific outcome. If it happens once, the product works. If it doesn't happen after a reasonable trial — even if every internal metric is green — the product has failed its founding promise and the next move is to figure out why, not to declare victory on lagging indicators.

## User Success

The user is Jack first, and a "relatively technical non-engineer" second (pressure-tested in the User Journeys section below). User success looks like:

- **"I primed the backlog, walked away, came back to merged PRs."** The continuous-flow loop ran without the user babysitting the agents or rescuing them from stuck states. The orchestration session surfaced what genuinely needed surfacing; everything else self-resolved.
- **"I trusted what shipped without reading every line."** Reviewer agents and `docs/standards.md` did enough work that the user merged on skim, not on full diff inspection, for the majority of stories.
- **"I caught misdirection at the backlog level, not at the diff level."** When the agents shipped the wrong thing, the user's recovery move was to re-prime the queue, not to debug the code by hand. This is the failure-mode-prevention behaviour: it forces attention onto whether the *right* thing is being built, not whether the code compiles.
- **"The retro told me something I didn't already know."** At least once per cycle, the retro file named a pattern, miss, or lesson the user wouldn't have noticed unaided. This is the calibration loop earning its keep.

## Business Success

"Business" here means the project's stated vision: replace the traditional product engineering team with AI tooling, judged on a non-engineer's ability to ship.

- **Soft-release coverage.** At least one external user attempts the canonical scenario above within three months of v1 ship. Even a failed attempt is a successful business signal — it produces the first real data point on what a non-Jack user trips over.
- **Calibration loop is closing.** Across cycles, `docs/standards.md` grows from real misses, not speculation, and retros produce rule/skill proposals that get accepted at a non-zero rate. A static standard or zero accepted proposals would mean the learning loop is theatre, not function.
- **No "shipped well, used by no one" outcome.** The product itself is the first test of its own thesis. If Jack ships v1 and finds himself not using it after week two — or finds external readers bouncing off it after install — that is the failure-mode-realised signal, and the product enters a course-correct, not a "build more features" phase.

## Technical Success

- **End-to-end run on a clean machine.** From `gh repo clone` to "first PR merged via the continuous-flow loop" takes under one hour on a target user's machine, with no manual file edits beyond priming the queue and configuring agent permissions.
- **No silent failure modes.** Every agent failure produces a visible artifact: a blocker story, a `needs-human` label, a retro entry, or an orchestration-session surface. Nothing fails into a state where the user only notices days later.
- **State is recoverable.** If a session dies or the laptop closes mid-flow, the filesystem state (`to-do/` / `in-progress/` / `blocked/` / `done/`) is enough to resume cleanly on next launch. No daemon dependency, no lockfile recovery rituals.
- **The reviewer is trusted enough to auto-merge low-risk.** By the end of the first dog-fooding period, the verdict-vs-action agreement metric (inherited from the Pattern A PRD) is high enough to enable low-risk auto-merge without producing a regression that ships.

## Measurable Outcomes

| Outcome | Target | When measured |
|---|---|---|
| Canonical scenario succeeds for an external user | ≥1 success | Within 3 months of v1 ship |
| Install-to-first-merged-PR time on clean machine | ≤1 hour | Continuous; spot-checked per release |
| % of merged PRs that user skim-merged (not full-read) | ≥70% | End of second cycle post-ship |
| Verdict-vs-action agreement (low-risk tier eligibility) | ≥80% | End of second cycle post-ship |
| Retros producing accepted rule/skill proposals | ≥1 accepted proposal per cycle | Continuous |
| Standards doc evolves from observed misses | ≥1 add and ≥1 remove/relax per cycle | End of each cycle |
| Silent failures (agent fails without visible artifact) | 0 | Continuous; trip-wire |
| "Shipped well, used by no one" outcomes (Jack's worst case) | 0 | Self-reported at each cycle retro |
