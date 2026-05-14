# sprint-orchestrator

A Claude Code plugin that turns sprint backlogs into autonomous-but-supervised execution. Deterministic state and guardrails live in TypeScript; the LLM only does the irreducibly fuzzy parts (implementation, review).

Works standalone or with BMAD v6 planning artefacts. When BMAD layout is detected, the plugin auto-configures; otherwise it asks once where your PRD / architecture / story files live.

## Status

**Active development.** Core state machine is shipped; tools, hooks, and agents are live.

## Quickstart

Install the plugin into Claude Code from this repo's marketplace:

```
/plugin marketplace add jackmcintyre/claude-dev-loop
/plugin install sprint-orchestrator
```

On first run in a project, the plugin asks where your planning docs live (or detects BMAD v6 layout automatically) and writes `.sprint-orchestrator/config.yaml`.

## Running a sprint

### Step 1 — Get a backlog into the orchestrator

When you have any external planning context (an epic doc, a brief, a stack
of story files, meeting notes), the recommended entrypoint is the adopt
skill:

```
/sprint-orchestrator:adopt <path>
```

The flow is universal: source → an LLM subagent drafts a conforming
backlog → you review (accept / edit / abort) → on accept, `lintSprint`
validates the draft → write to `sprint-status.yaml`. The skill never
writes without your acceptance, and never writes a draft that doesn't
pass `lintSprint`.

#### Adaptor pattern (extension point)

For producer-specific fast paths — when a planning tool emits structured
output and you'd rather skip the LLM drafting step — the orchestrator
exposes an in-plugin **adaptor pattern**. An adaptor is a small, in-plugin
module that converts producer-native output into a conforming backlog and
hands it to the same validate-and-write path adopt uses.

BMad is one example; the pattern works for any producer that can emit a conforming backlog.
The one-way-coupling rule is strict: The orchestrator core does not import adaptors; adaptors depend on the schema, not the other way round.
This keeps the core ignorant of any specific producer and lets adaptors
come and go without churning the state machine. `lintSprint` is the
schema source of truth — any adaptor's output must pass it.

No adaptors ship in this sprint; the pattern is documented for future extension.

#### adapt-bmad — first concrete adaptor

`/sprint-orchestrator:adapt-bmad` is the first concrete adaptor shipped under this pattern: a deterministic, instant fast path for BMad-authored stories. Reach for it when your stories were authored by BMad; reach for universal `/sprint-orchestrator:adopt` for any other source.

The convention is a BMad-side authoring responsibility: every BMad story file must include a `## Verification` section containing at least one fenced `shell` block. When the section is missing or empty, `adapt-bmad` refuses the run with a named error — there is no silent fallback.

A minimal Verification section is a single fenced shell block under the heading. The fenced block looks like this:

```shell
pnpm --dir plugins/sprint-orchestrator test -- story-one
```

`adapt-bmad` extracts the fenced shell command(s) into the story's `acceptance_criteria.checks` and writes a conforming `sprint-status.yaml` — the same validate-and-write path universal `/sprint-orchestrator:adopt` uses.

### Step 2 — Run the sprint

Once `sprint-status.yaml` exists, the recommended entrypoint is the
`run-sprint` wrapper. It reads `sprint-status.yaml`, computes a turn cap
from the story count, and hands the drain condition to `/goal` so the
orchestrator keeps swinging until the backlog is fully resolved (or it
hits the cap):

```
/sprint-orchestrator:run-sprint
```

#### What you see on screen

The wrapper computes the turn cap (see the formula below) and then
prints two locked lines at the end of its output: a one-line
fresh-context guidance note, followed by the canonical `/goal` command.
The wrapper prints the canonical /goal command as the final line of its output, so you can triple-click the last line to copy it.

Paste the /goal command in a fresh context window. A clean transcript gives the /goal evaluator the best chance of correctly deciding when the drain condition is met.

Clipboard auto-copy of the /goal command was investigated this sprint but does not ship — it is tracked as a follow-up. See `_bmad-output/planning-artifacts/follow-ups.md` for the spike notes and promotion criteria.

### Computed turn cap

The wrapper computes the cap as:

```
cap = ceil(story_count * turn_cap_per_story)
```

`turn_cap_per_story` defaults to **3** and can be overridden in
`.sprint-orchestrator/config.yaml`:

```yaml
turn_cap_per_story: 5
```

So a 7-story sprint with the default cap will run for at most
`ceil(7 * 3) = 21` turns before pausing.

### Manual override: raw /goal

If you want to set the drain condition yourself (different cap, extra
predicate, debugging a misbehaving wrapper), invoke `/goal` directly. The
canonical condition string is:

```
/goal /sprint-orchestrator:process-backlog UNTIL every story in sprint-status.yaml is status=done or status=failed, OR stop after <N> turns
```

Copy that verbatim and adjust `<N>` for your sprint size.

### Fallback: /loop

If `/goal` misbehaves (rare), you can fall back to a fixed-interval loop:

```
/loop 5m /sprint-orchestrator:process-backlog
```

This is a fallback, not the primary path — `/goal` reads the end-of-run
summary line (below) to decide whether to keep going, while `/loop` just
re-fires on a timer regardless of outcome.

### End-of-run summary lines

Every `process-backlog` run prints one of three distinct final lines so
the `/goal` evaluator (and you, watching the transcript) can tell drain
from cap-stop from blocked:

- `Sprint drain confirmed: 0 ready stories remaining. Outcome: <D> done, <F> failed.`
- `Sprint paused at hard cap: <R> ready stories remaining. Outcome so far: <D> done, <F> failed.`
- `Sprint blocked: <reason>. <R> ready stories remaining.`

The leading tokens (`Sprint drain confirmed:`, `Sprint paused at hard cap:`,
`Sprint blocked:`) are stable contracts — grep-by-prefix to disambiguate
outcomes in transcripts or tooling.

## Install from source

```bash
git clone <this-repo>
cd sprint-orchestrator
pnpm install
pnpm -r build
```

Then in Claude Code:

```
/plugin install <path-to-this-repo>
```

> **Heads-up — adding or renaming MCP tools requires a full Claude Code restart.** `/reload-plugins` reloads the MCP server but does not refresh Claude Code's deferred-tools registry, so newly registered tools (or renames) stay invisible until you exit and relaunch. If you upgrade this plugin and the orchestrator can't see a new tool, restart Claude Code.

## Configuration

On first run the orchestrator writes `.sprint-orchestrator/config.yaml` automatically via `getOrInitConfig`. To pre-configure or customise knobs before the first run, copy the example and edit it:

```bash
cp plugins/sprint-orchestrator/docs/example-config.yaml .sprint-orchestrator/config.yaml
```

See [`docs/example-config.yaml`](docs/example-config.yaml) for the full list of optional settings (`turn_cap_per_story`, `pr_per_story`, `force_release_stale`, etc.).

## Story lifecycle

Each story moves through a deterministic pipeline. The orchestrator owns state transitions; LLM subagents only handle implementation and review.

```
                       getReadyStories
                              |
                              v
                        +-----------+
                        |   ready   |
                        +-----------+
                              |
                              | claimStory
                              v
                        +-------------+
                        | in_progress |  <-- dev subagent implements
                        +-------------+
                              |
                              | validateAcceptanceCriteria
                              v
                        +-------------+
                        |  validated  |
                        +-------------+
                              |
                              | commitStoryArtefacts
                              v
                        +-------------+
                        |  committed  |  <-- reviewer subagent inspects
                        +-------------+
                            /     \
            recordStorySuccess       recordStoryRework
                          /           \
                         v             v
                  +----------+    +-------------+
                  | complete |    |   ready     |  (re-queued with notes)
                  +----------+    +-------------+
```

Key transitions:

- `getReadyStories` — list unblocked stories whose dependencies are satisfied.
- `claimStory` — atomically reserve a story for one worker (prevents double-claims).
- `validateAcceptanceCriteria` — run the deterministic checks declared in the story spec.
- `commitStoryArtefacts` — stage and commit the implementation diff with a structured message.
- `recordStorySuccess` — finalize a story after reviewer approval (formerly `markStoryComplete`).
- `recordStoryRework` — bounce a story back for another attempt with reviewer feedback attached (formerly `markStoryNeedsRework`).
- `recordStoryFailure` — give up on a story with a structured reason (formerly `markStoryFailed`).
- `recordStoryReopen` — human-only recovery path: transition a `failed` story back to `ready` with an audit-trail entry. Clears `failed_at`, `last_failure_reason`, and the stale claim, but preserves `rework_count` so the prior attempts remain visible. The automated reviewer never calls this — `failed` is a terminal state for the orchestrator.

## Modes

- **One-shot supervised** — install in Claude Code, run the slash command, watch it process up to 5 ready stories, and stop.
- **Recurring unattended (still inside Claude Code)** — keep a Claude Code session open and run `/loop 30m /sprint-orchestrator:process-backlog`. The orchestrator re-fires every 30 minutes, draining ready stories as they become available. Uses your existing Claude Code auth (Max / Pro / API key) — no separate runner needed.

## Development

```bash
pnpm -r build       # compile all packages
pnpm -r test        # vitest
pnpm -r typecheck   # tsc --noEmit
pnpm lint           # eslint
```

## Writing acceptance criteria

Acceptance criteria (`acceptance_criteria.checks` in `sprint-status.yaml`) are
the deterministic gate between "dev says done" and "story is committed". They
are only as strong as you make them — a single literal-grep is trivially
satisfiable by an agent that decides to write the matching string into a file.

Guidance:

- **Layer multiple checks.** Combine regex/shell assertions with a real build
  or test invocation. A typical story should have at least one structural check
  (regex/file-exists) plus one behavioural check (`pnpm verify`, `pnpm test`,
  `tsc --noEmit`, etc.). The whole list must pass.
- **Avoid bare literal greps as the sole criterion.** `grep "TODO done"` proves
  nothing. Prefer regex patterns that anchor to real code shapes
  (function/export signatures, config keys, route paths) and back them with a
  command that exercises the behaviour.
- **For genuinely-impossible or "do not implement" stories**, use an
  unreachable assertion such as `shell: "false"` or a check that asserts the
  absence of forbidden patterns. Do not rely on a passing-by-default check.
- **Prefer `expect_exit: 0` shell checks** for anything that has a real test
  harness — they fail loudly when the code regresses, unlike a regex that may
  silently still match.

## Hand-editing sprint-status.yaml

`sprint-status.yaml` is the canonical state file, but it is not the only source
of truth the orchestrator relies on — every transition the orchestrator
performs is also appended to `.sprint-orchestrator/run.log`. Direct edits to
`sprint-status.yaml` (or reverts via `git checkout`) bypass `run.log`
entirely.

This is fine for occasional repair (unsticking a stale claim, fixing a typo in
a story spec), but be aware:

- `run.log` will be **incomplete** for any span where state changed out of
  band. Audit trails, retrospectives, and any tooling that reconstructs
  history from the log will see a gap.
- If you revert `sprint-status.yaml` after a bad run, the log still contains
  the now-orphaned transitions. Consider annotating the log manually, or
  truncating it alongside the revert if you need a clean baseline.
- Prefer the orchestrator's tools (`releaseStaleClaims`, `recordStoryFailure`,
  `recordStoryReopen`, etc.) over hand edits whenever an equivalent tool
  exists — they keep state and log in sync.

## Recovering a failed story

`failed` is a terminal state in the automated workflow: the reviewer cannot
walk a story out of it, and the orchestrator will not retry it on its own.
This is intentional — once the rework cap is hit (or a no-code failure is
recorded), the right move is for a human to look at what went wrong before
asking the agents to take another swing.

When you want to put a failed story back into the queue, call the
`recordStoryReopen` MCP tool:

```
recordStoryReopen(storyId: "S1", reason: "deferred dep landed; agent was right to give up first time")
```

What it does:

- Transitions the story from `failed` back to `ready`.
- Clears `failed_at`, `last_failure_reason`, and any stale `claimed_by` /
  `claimed_at` left over from the prior agent.
- **Preserves `rework_count`** so the next reviewer can see the prior attempts
  in the audit trail.
- Appends one entry to `orchestrator.reopen_history` (with timestamp, your
  reason, and the prior failure reason) so the recovery itself is auditable.
- Commits the mutation as `chore(sprint): reopen <id> — <reason>` so the
  reset shows up in git history.

The tool refuses (with `InvalidStateTransitionError`) on any non-`failed`
status — it is not a free reset. To unstick a stuck `in_progress` claim, use
`releaseStaleClaims` instead.

## Known issue: orphan code commit on state-write failure

The reviewer's flow is `validateAcceptanceCriteria → commitStoryArtefacts → recordStorySuccess`. If the final `recordStorySuccess` call fails for any reason (file lock, schema validation error, harness classifier intercepts), the code commit produced by `commitStoryArtefacts` has already landed on the branch with no matching state commit. The state machine is split between the working tree (committed) and `sprint-status.yaml` (still `in_progress`).

Recovery (4 steps):

1. Hand-edit `sprint-status.yaml`: set the story's `status: ready` and clear `claimed_by` / `claimed_at`.
2. Re-run `/sprint-orchestrator:process-backlog`. The reviewer will re-validate and complete the state transition.
3. Verify by calling `getSprintStatus` (via MCP) — confirm the story is now `status: done` with a fresh `completed_at`.
4. The orphan code commit from before the failure is real and stays in history. Reverting it will undo the work; leave it unless you know you want it gone.

A future sprint will replace this with proper atomic commit-and-mark or rollback-on-failure semantics. Until then, this is the documented workaround.

## License

MIT
