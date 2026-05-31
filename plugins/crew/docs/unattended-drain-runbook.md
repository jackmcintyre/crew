# Operator runbook — unattended multi-story drain

> **Goal:** queue a stack of low-risk stories, launch the drain, walk away, and
> come back to a stack of merged (or human-pending) PRs — without re-deriving the
> invocation from the workflow source each time.

This runbook walks the end-to-end operator flow for the `crew-drain` workflow
(`plugins/crew/workflows/drain.workflow.js`). The drain is a serial,
single-story-at-a-time loop: for each story it claims the next ready story,
runs the generalist-dev to implement it and open a PR, runs the reviewer,
derives a verdict, and runs the auto-merge gate. It does this entirely through
one-shot CLI seams, so no persistent MCP server sits on the drain path.

## 1. Queue the stories

The drain only ever works the **claimable to-do queue** — it cannot author
stories. Before you launch it, get the stories you want drained into that queue:

1. **Author or confirm the stories.** Each should be a real, ready-for-dev
   story spec in your backlog. For an unattended run, favour **low-risk**
   stories — docs-only or purely-additive changes — so the auto-merge gate can
   take them the whole way without a human eyeball. (Risk tiers are defined in
   [`risk-tiering.md`](./risk-tiering.md).)
2. **Run `/crew:scan`.** Scanning reads your active adapter's source stories and
   writes one execution manifest per story into `.crew/state/to-do/`. Only
   stories that land in `to-do/` are claimable by the drain. `/crew:scan` is
   idempotent — re-running it is safe and only picks up new or changed stories.

After the scan, confirm the manifests are present (`.crew/state/to-do/`) before
launching. A story whose dependencies are not yet in `.crew/state/done/` will
not be claimed until those deps complete.

## 2. Launch the drain

Run the `crew-drain` workflow via the Workflow tool. It takes three inputs:

| Arg | Required | What it is |
|-----|----------|------------|
| `targetRepoRoot` | yes | Absolute path to the repo being built (the repo whose stories you are draining). |
| `cli` | yes | Absolute path to the plugin's compiled CLI entrypoint, `mcp-server/dist/cli.js`. This is the stateless seam transport and lives in the **plugin**, not the target repo. |
| `maxStories` | no | A positive-integer safety cap on stories claimed this run. Omit it to drain until the queue is empty. See [§3](#3-unattended-walk-away-mode-vs-the-safety-cap). |

The workflow `args` are delivered as a JSON string. A typical launch passes:

```json
{
  "targetRepoRoot": "/absolute/path/to/your/target/repo",
  "cli": "/absolute/path/to/plugins/crew/mcp-server/dist/cli.js"
}
```

> ### The `scriptPath` MUST be absolute
>
> When you point the Workflow tool at the drain script, the `scriptPath` you
> pass **must be an absolute path** (e.g.
> `/Users/you/projects/crew/plugins/crew/workflows/drain.workflow.js`).
>
> A **relative** path is resolved against the plugin directory, which **doubles
> the prefix** — the runtime looks for the script under the plugin dir *plus*
> your relative path and fails to find it. Always pass the fully-qualified
> absolute path to `drain.workflow.js`.

The `cli` arg above has the same constraint for the same reason: it is an
absolute path to `mcp-server/dist/cli.js`, never a relative one.

## 3. Unattended "walk away" mode vs. the safety cap

This is the headline behaviour of the drain:

- **`maxStories` omitted → unbounded drain.** The loop runs until the queue is
  empty. This is the unattended "walk away" mode: launch it, leave, and come
  back to the finished stack. When the queue drains, the workflow returns with
  `drainedReason: "queue-drained"` and `drained: true`.
- **`maxStories` set to a positive integer → capped run.** The loop stops after
  claiming that many stories, even if more remain in the queue. The cap is a
  **safety backstop**, not a queue state: it returns
  `drainedReason: "max-stories-reached"` and `drained: false`. Use it when you
  want to babysit the first few stories of a long backlog before letting the
  rest run unattended. (A non-positive or garbage value is treated as omitted —
  i.e. unbounded.)

**Why an unbounded drain always terminates:** claiming a story is **atomic** —
`claimNextStory` moves the manifest from `.crew/state/to-do/` to
`.crew/state/in-progress/` in one step, so the to-do queue **strictly shrinks**
by one on every successful claim. Because the queue can only get smaller, the
loop is guaranteed to reach an empty queue and exit; an unbounded drain cannot
loop forever.

The drain never silently swallows a story. When it finishes, every claimed ref
lands in exactly one bucket of the return object:

- `merged` — the auto-merge gate took the PR all the way.
- `pausedForHuman` — the verdict was green but the gate held the PR for a human
  to merge (the expected Stage-1 outcome before any agreement history exists).
- `completed` — the story passed review (it appears here and in either `merged`
  or `pausedForHuman`).
- `blocked` — the dev or reviewer could not finish cleanly; the ref carries a
  `blocked_by` reason.

## 4. After the run

The drain runs the generalist-dev **directly in `targetRepoRoot`** — it does
**not** use an isolated worktree. (In v1 the loop is single-story serial, so the
dev's `runDevTerminalAction` infers the repo from the current working directory;
a worktree would mismatch and the changes would land where `git -C
targetRepoRoot` can't see them.) The practical consequence: when the drain
finishes, **your local checkout is left on the last story's branch**, not on
`dev`.

To reconcile after a run:

1. **Return to the trunk and pull:**

   ```sh
   git checkout dev && git pull
   ```

   This moves you off the last story's leftover branch and pulls down the PRs
   that merged during the drain (and any human merges you completed for the
   `pausedForHuman` set).

2. **Mark the drained stories `done` in the sprint-status tracker.** Edit
   `_bmad-output/implementation-artifacts/sprint-status.yaml` and set each
   drained story's entry under `development_status:` to `done`. Use the
   workflow's `merged` and `completed` lists as the authoritative record of
   what shipped.

3. **Commit the reconciliation:**

   ```sh
   git add _bmad-output/implementation-artifacts/sprint-status.yaml
   git commit -m "chore(planning): reconcile sprint-status — drained stories done"
   ```

Any story that came back in `pausedForHuman` still needs a human to merge its PR
before you mark it `done`; review and merge those first, then reconcile as above.
Any story in `blocked` did not ship — re-queue or re-author it once you've
addressed the `blocked_by` reason.
