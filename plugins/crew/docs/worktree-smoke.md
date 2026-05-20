# Worktree smoke-test recipe for the crew plugin

> **Two workflows exist — choose the right one:**
>
> | Situation | Workflow |
> |-----------|----------|
> | Editing TypeScript or SKILL.md on the current branch | **Daily dev loop** (below) — ~5–8 s |
> | Switching to a different branch to test it | **Branch switching** (`## Recipe` below) — full uninstall cycle |

## Daily dev loop

> **This is the 99% case.** Claude Code runs the plugin directly from the live
> source tree — no install copy, no cache layer. See the spike report at
> [`plugins/crew/docs/spikes/symlink-dev-install.md`](spikes/symlink-dev-install.md)
> for the evidence.

**MCP server changes (TypeScript src/):**

1. Start the watch compiler in a terminal:
   ```sh
   pnpm --dir plugins/crew/mcp-server build:watch
   ```
   `tsc --watch` incrementally recompiles into `dist/` in 1–3 seconds.
2. After each rebuild, in the Claude Code TUI: `/reload-plugins`

**Skill-only changes (SKILL.md files):** no rebuild needed — just `/reload-plugins`.

## Why this exists

The crew plugin is installed via `/plugin install crew@crew`.
When switching to a worktree branch, a naive `/plugin install crew@crew` silently
skips installation because Claude Code sees the plugin as already installed — a
**no-op** — even when the source on disk has changed. **Uninstall first** or the
worktree's updated code never loads.

This trap was first recorded at
`~/.claude/projects/-Users-jackmcintyre-projects-crew/memory/project_smoke_test_install.md`
during the Story 2.7 ship-story smoke gate.

## Recipe

> **Use this only when switching branches**, not for daily editing (see Daily dev
> loop above).

> **One-command alternative:** `pnpm --dir plugins/crew dev:install` (shell command,
> not a TUI slash-command) replaces the three steps below with a single call and
> a Claude Code restart. See [`docs/dev-loop.md`](dev-loop.md) for details.

Paste these three commands into the Claude Code TUI **in order**:

```
/plugin uninstall crew@crew
/plugin install crew@crew
/reload-plugins
```

**Why this works:** uninstalling forces a cache flush; reinstalling from the
current working directory picks up the worktree's code; `/reload-plugins` rebinds
the MCP servers without killing the running session.

**Why a simple `/plugin install` is not enough:** Claude Code's install command
is idempotent — it sees the existing installation and skips, even if the source
on disk has changed.

## Helper script

`plugins/crew/scripts/worktree-smoke.sh` prints the recipe above with your
current branch and version interpolated:

```sh
./plugins/crew/scripts/worktree-smoke.sh
```

**Exit codes:**

| Exit code | Meaning |
|-----------|---------|
| `0` | Inside a worktree; recipe printed to stdout |
| `2` | Not inside a worktree — `worktree-smoke: refusing to run outside a worktree — cd into .worktrees/<branch>/ first` |
| `3` | Preflight failure (e.g. `git` not on PATH) |

The script has **no side-effects** and requires only `git` and standard POSIX
shell built-ins.

## Verifying the recipe worked

After running `/reload-plugins`, verify the worktree code is loaded:

1. Insert a known string into `plugins/crew/skills/ask/SKILL.md`'s
   `# What this skill does` section (e.g. `WORKTREE-SENTINEL-2.8`).
2. Save the file (no rebuild needed for skill body changes).
3. Run the recipe above.
4. Run `/crew:ask <role> "<question>"` or `/help crew:ask`.
5. Observe the sentinel string in the response.

If the sentinel is absent, repeat the recipe and check that `/crew:status`
reports the expected version.

## Cross-references

- Spike report (live-source behaviour): [`plugins/crew/docs/spikes/symlink-dev-install.md`](spikes/symlink-dev-install.md)
- Story 1.8 user-surface gate: [`plugins/crew/docs/user-surface-acs.md`](user-surface-acs.md)
- Story 2.7 `/crew:ask` skill: [`plugins/crew/skills/ask/SKILL.md`](../skills/ask/SKILL.md)
- `_meta.role` enforcement record: [`plugins/crew/docs/ask-mode-enforcement.md`](ask-mode-enforcement.md)
- Original trap discovery record:
  `~/.claude/projects/-Users-jackmcintyre-projects-crew/memory/project_smoke_test_install.md`
