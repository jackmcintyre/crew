---
name: backlog-readiness
cron: "30 23 * * 0"        # 09:30 Sydney Monday (Sunday 23:30 UTC)
label: backlog-ready
enabled: true
model: claude-sonnet-4-6
---

# Backlog readiness pre-flight

Walks the next epic in line and checks that every story in it is fully
shaped — acceptance criteria, sizing, dependencies, planning-discipline
compliance — before implementation work begins. Catches the bugfix-1
class of problem: under-specified stories sneaking into a sprint.

---

## Prompt

You are running as a scheduled remote agent against the
`jackmcintyre/crew` repository. The repo is already cloned. You have
read access, `git`, and tools to read and write GitHub (issues,
labels). Use whichever GitHub-write mechanism is available in your
environment.

## Task

Audit the **next active epic** for readiness and report any gaps.

## Steps

1. **Identify the next epic.** Read
   `_bmad-output/planning-artifacts/epics/epic-list.md` and each
   `epic-N-*.md` file. The next epic is the lowest-numbered one whose
   stories are not all marked done/shipped/merged. If every epic is
   complete, **exit silently — no issue**.

2. **Locate the planning-discipline rules.** Search the tracked PRD
   under `_bmad-output/planning-artifacts/prd-crew-v1/` for content
   referencing "planning discipline," "integration AC," "ship gate,"
   "source drift," and "depends_on." Extract the rules you find. If you
   cannot find any, use this fallback set:
   - Every story must have explicit acceptance criteria.
   - Every story must declare dependencies (`depends_on`) on other
     stories where applicable.
   - Every story that integrates with surrounding code must include at
     least one integration AC (not just unit-level).
   - Every story must be sized (point estimate, t-shirt, or hours).
   - No story should silently expand scope beyond its stated ACs.

3. **Check each story in the epic.** For every story file or section
   under the next epic, check:
   - Are acceptance criteria present? Are they concrete (testable) or
     vague ("should work well")?
   - Is the story sized?
   - Are dependencies declared, and do they reference real stories?
   - If integration is implied (touches existing modules), is there an
     integration AC?
   - Any violation of the planning-discipline rules you extracted?

4. **Decide whether to report.** If every story passes every check,
   **exit silently — no issue**. Otherwise, proceed.

5. **Open the issue.** Create a GitHub issue with:
   - **Title:** `Backlog readiness — Epic N — YYYY-MM-DD`
   - **Label:** `backlog-ready` (if the label doesn't exist, create it
     with colour `0E8A16` and description "Backlog readiness
     pre-flight").
   - **Body:** see structure below.

## Issue body structure

```
## Epic N — <title>

**Status:** <how many stories total, how many fully ready, how many with gaps>

## Stories with gaps

### Story <id> — <title>

- [ ] <specific gap, with quote or pointer into the story file>
- [ ] <next gap>

<Repeat for each story with gaps. Only list stories that have problems — don't list passing stories.>

## Planning-discipline rules applied

<List the rules you checked against, with a one-line summary of each. This makes the audit auditable.>
```

## Important

- **Don't gold-plate.** If a story has every required field and the ACs
  are concrete and testable, it passes — even if you can think of ways
  it could be more detailed. Only flag real gaps.
- **Quote evidence.** When you say a story has a gap, paste the relevant
  line or note its absence. Don't claim "AC2 is vague" without showing
  why.
- **Read-only on the codebase.** No commits, no PRs, no branch
  changes. Issue creation is the only write.
