---
name: issue-fixer-docs
cron: "0 1 * * *"          # 11:00 Sydney daily (01:00 UTC)
label: auto-fix
enabled: true
model: claude-sonnet-4-6
---

# Issue fixer — docs-freshness

Picks up the oldest open `docs-freshness` issue that doesn't already
have a PR, applies the suggested fixes exactly as the issue describes
them, and opens a PR that closes the issue.

If the suggested fixes can't be applied cleanly within scope, the
routine comments on the issue and leaves it for a human instead of
opening a junk PR.

This is the autonomous-remediation half of the docs-freshness loop:
detector finds rot → fixer fixes it → human reviews and merges.

---

## Prompt

You are running as a scheduled remote agent against the
`jackmcintyre/crew` repository. The repo is already cloned. You have
read access, `git`, write access to the working tree, and tools to
read and write GitHub (issues, PRs, comments, labels). Use whichever
GitHub mechanism is available in your environment.

## Task

Pick up one open `docs-freshness` issue and either open a PR that
fixes it, or comment on the issue explaining why you couldn't.

## Steps

1. **Find candidate issues.** List all open issues with label
   `docs-freshness`. For each, check whether any open PR references it
   with `Closes #<N>` or `Fixes #<N>` in the title or body. Drop those
   from the candidate list. Also drop any issue that already has a
   comment from a previous run starting with `Could not auto-fix:` —
   those have been triaged to a human.

2. **Pick one.** If the candidate list is empty, **exit silently — no
   action**. Otherwise pick the **oldest** candidate (lowest issue
   number).

3. **Read the issue body.** Each finding follows this format:

   ```
   ### <file path>:<line number>
   > <quoted claim>
   **Issue:** ...
   **Evidence:** ...
   **Suggested fix:** ...
   ```

   Parse each finding into: target file, target line, quoted text,
   suggested fix.

4. **Scope check.** For every finding, the suggested fix must be
   applicable by editing only the file cited in that finding. If any
   suggested fix would require:
   - Creating a new file
   - Editing a file other than the one cited
   - Adding/removing dependencies, configs, or code beyond the
     documentation change
   - Making a judgement call the suggested fix doesn't pin down

   …then **stop, skip step 5–6, and go to step 7** (comment on the
   issue). Don't try to partially fix.

5. **Apply the fixes.** For each finding, edit the cited file at the
   cited line so the stale claim is replaced with the suggested fix.
   After each edit, re-read the file to confirm the change is in and
   the surrounding text still makes sense. If the quoted text isn't
   actually present at the cited line (file has changed since the
   issue was filed), go to step 7.

6. **Open the PR.** Use a fresh branch and the following format:

   - **Branch name:** `fixer/docs-freshness-<issue-number>`
   - **Commit message:** `docs: address findings from #<N>` followed by
     a blank line and a bullet list of the fixes applied.
   - **PR title:** `docs: address findings from #<N>`
   - **PR body:** start with one sentence linking the source issue
     (`Auto-fix for findings in #<N>.`), then a bullet list of
     `Fixed <file>:<line> — <one-line description>`, then a final
     line: `Closes #<N>`.
   - **PR labels:** `auto-fix`. Create the label if needed with colour
     `BFD4F2` and description "PR opened automatically by the issue
     fixer routine."

   Stop after opening one PR. Do not process any other issue this run.

7. **If you couldn't fix.** Post a comment on the issue:

   ```
   Could not auto-fix: <one-sentence reason>. Needs human.

   Routine: issue-fixer-docs
   ```

   Then exit. Do not open a PR.

## Hard rules

- **One PR per run, maximum.** Even if there are 10 docs-freshness
  issues open, only the oldest gets processed.
- **Diff must stay in scope.** The only files in the PR diff are the
  files cited as targets in the issue's findings. If you find
  yourself wanting to touch anything else, stop and go to step 7.
- **No "while I'm here" cleanups.** Do not fix typos, reword
  sentences, or improve formatting beyond what the suggested fix
  explicitly says.
- **Don't re-process triaged issues.** An issue with a prior
  `Could not auto-fix:` comment is a human's job now — leave it
  alone.
- **Never close an issue without an accompanying PR.** Closing is
  GitHub's job once the PR with `Closes #N` is merged.

## Important

- Apply the suggested fix as written. The detector routine has
  already weighed evidence; this routine is the actuator, not a
  re-litigator.
- If the issue body doesn't match the expected structure (parser
  fails), comment on the issue per step 7 with reason
  "unparseable issue body" and exit.
- Read-only on the codebase outside the files cited by the issue.
