# Routines

Remote Claude Code agents that run on a cron schedule against this repo.
Each one wakes up, clones the repo fresh, runs its prompt, and reports
findings as a GitHub issue.

## Why this folder exists

The prompt for each routine lives here as the source of truth. The
cloud copy (configured via the `RemoteTrigger` API) is the *deployed*
version. When you want to tune a prompt:

1. Edit the file here.
2. Re-run the routine via Claude Code with the schedule skill, asking
   it to update the routine from this file. Or open the routine in the
   web UI and paste the new prompt in directly.
3. Commit the edit so the source of truth stays in sync.

Editing the cloud copy without updating the file here will drift —
future edits will reference the wrong baseline.

## The five routines

| # | Name              | Cadence            | Label             | What it does                                                 |
| - | ----------------- | ------------------ | ----------------- | ------------------------------------------------------------ |
| 1 | drift-digest      | Daily 08:30 Sydney | `drift-digest`    | Diffs merged PRs against epic acceptance criteria            |
| 2 | backlog-readiness | Weekly Mon 09:30   | `backlog-ready`   | Checks the next epic is fully shaped before work starts      |
| 3 | docs-freshness    | Weekly Mon 10:00   | `docs-freshness`  | Catches stale paths / claims in CLAUDE.md and top-level docs |
| 4 | platform-tracker  | Weekly Mon 10:30   | `platform-track`  | Watches Claude Code platform changes that affect crew        |
| 5 | dist-drift        | Daily 09:00 Sydney | `dist-drift`      | Catches built `dist/` drifting from `src/` overnight         |

All times are Australia/Sydney local; the cron expressions in each
routine's frontmatter are UTC.

## Conventions

- **Bail silently.** Every routine must check whether it has anything
  material to report and exit cleanly without opening an issue if not.
  An empty digest is worse than no digest.
- **One issue per run.** Don't fan out into multiple issues — one issue,
  labelled, with the date in the title.
- **GitHub label.** Each routine uses its own label so you can filter or
  mute one without losing the others.
- **No commits, no PRs.** Routines are read-only against the codebase.
  They surface findings as issues; humans decide what to do with them.

## When routines should be re-pointed at a different repo

Today every routine targets `jackmcintyre/crew`. When the AI Engineering
Team plugin starts being used against real downstream repos, several of
these (especially #3 docs-freshness and #5 dist-drift) become candidates
to fork per-target-repo. That's a future decision — for now they all
watch crew itself.
