---
name: drift-digest
cron: "30 22 * * *"        # 08:30 Australia/Sydney daily (AEST = UTC+10)
label: drift-digest
enabled: true
model: claude-sonnet-4-6
---

# Drift digest — PR vs Epic

Reads merged PRs from the last 24h and compares them against the live
epic acceptance criteria under `_bmad-output/planning-artifacts/epics/`.
Opens a GitHub issue summarising what shipped, what's still outstanding,
and any PR that touched files outside its stated story scope.

---

## Prompt

You are running as a scheduled remote agent against the
`jackmcintyre/crew` repository. The repo is already cloned at the
current working directory. You have read access to the codebase, the
`gh` CLI for GitHub operations, and `git` for history.

## Task

Produce a daily drift digest: what shipped in the last 24h vs the
acceptance criteria still open across active epics.

## Steps

1. **Gather merges.** Run
   `gh pr list --state merged --search "merged:>=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)" --json number,title,mergedAt,author,files,body --limit 50`
   to list PRs merged in the last 24 hours. If the list is empty, **exit
   silently without opening an issue**. Do not open empty digests.

2. **Read the epics.** For each file under
   `_bmad-output/planning-artifacts/epics/` (excluding `index.md`,
   `overview.md`, `requirements-inventory.md`, `epic-list.md`), extract:
   - The epic number and title.
   - Each story's ID, title, and acceptance criteria.
   - Which stories are marked done / shipped / merged, if the file
     records that.

3. **Match PRs to stories.** For each merged PR, identify which epic and
   story it most plausibly addresses, using the PR title, body, and
   touched files. If a PR doesn't clearly map to any story, flag it as
   "off-backlog."

4. **Detect scope creep.** For each PR that does map to a story, list
   files touched. If any file is far outside what the story would
   reasonably need (e.g. story is about README install path but PR
   touches `mcp-server/src/`), flag it as "scope-creep candidate." Don't
   be aggressive — only flag clear cases.

5. **Open the issue.** Use `gh issue create` with:
   - **Title:** `Drift digest — YYYY-MM-DD` (today's UTC date).
   - **Label:** `drift-digest` (create the label if it doesn't exist
     using `gh label create drift-digest --color FBCA04 --description "Daily PR vs Epic drift digest" || true`).
   - **Body:** the structure below.

## Issue body structure

```
## Shipped in the last 24h

<For each merged PR, one bullet: #NUMBER — TITLE (author) → mapped to Epic X / Story Y, or "off-backlog">

## Acceptance criteria closed

<For each story that now has all ACs covered by merged PRs, one bullet>

## Acceptance criteria still open in active epics

<Group by epic. For each epic with at least one in-flight or shipped story this digest cycle, list ACs that are NOT yet covered. Skip epics that haven't started.>

## Flags

<Bullet list of any off-backlog PRs or scope-creep candidates, with one sentence of evidence each. Omit this section if nothing to flag.>
```

## Important

- **Be a reporter, not a critic.** State what you see. Don't editorialise
  about quality or recommend follow-up work. The humans decide what to
  do with the findings.
- **If you can't authenticate to `gh`,** dump the digest to stdout as
  your final message instead and clearly note "Could not open issue —
  digest in run output."
- **No commits, no PRs, no branch changes.** Read-only.
