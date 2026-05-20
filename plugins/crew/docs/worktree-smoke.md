# Worktree smoke-test recipe for the crew plugin

> **Cache-reload trap:** `/plugin install crew@crew` is a **no-op** when the
> plugin is already installed globally — even if the source on disk has
> changed. **Uninstall first** or the worktree's updated code never loads.

## Why this exists

The crew plugin is installed into Claude Code via `/plugin install crew@crew`.
When a contributor is working on a worktree branch (e.g. under `.worktrees/<branch>/`),
a naive `/plugin install crew@crew` silently skips installation because Claude Code
sees the plugin as already installed — even when the worktree branch has different
code. The symptom is that stale main-branch code surfaces instead of the worktree edits.

This trap was first recorded at
`~/.claude/projects/-Users-jackmcintyre-projects-crew/memory/project_smoke_test_install.md`
during the Story 2.7 ship-story smoke gate. It costs at least one confused smoke
session per `(user-surface)`-tagged story that hits it for the first time.

The fix is a three-step sequence that forces a fresh plugin load without killing
the operator's Claude Code session. This doc and the companion helper script
(`plugins/crew/scripts/worktree-smoke.sh`) move that recipe out of tribal memory
and into the repo so every future contributor can find it in two minutes.

## Recipe

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
current branch and version interpolated, so you can copy-paste with confidence:

```sh
./plugins/crew/scripts/worktree-smoke.sh
```

**Exit codes and stdout contract (AC3):**

| Exit code | Meaning | Output |
|-----------|---------|--------|
| `0` | Inside a worktree; recipe printed to stdout | Preamble + three slash-command lines + footer |
| `2` | Not inside a worktree — refusing to print | Diagnostic to stderr: `worktree-smoke: refusing to run outside a worktree — cd into .worktrees/<branch>/ first` |
| `3` | Preflight failure (e.g. `git` not on PATH) | Diagnostic to stderr naming the missing dependency |

The script has **no side-effects**: it does not invoke `claude`, does not shell
out to any Claude Code binary, and does not modify `~/.claude/`. It only writes
to stdout / stderr.

The script requires only `git` and standard POSIX shell built-ins. `node` is
used optionally for version display in the confirmation footer; if absent the
footer shows `unknown` and the recipe still works.

## Verifying the recipe worked

After running `/reload-plugins`, verify the worktree code is loaded by using a
sentinel-surface check:

1. Insert a known string into `plugins/crew/skills/ask/SKILL.md`'s
   `# What this skill does` section (e.g. `WORKTREE-SENTINEL-2.8`).
2. Save the file (no rebuild needed for skill body changes).
3. Run the recipe above.
4. Run `/crew:ask <role> "<question>"` or `/help crew:ask`.
5. Observe the sentinel string surfaced in the printed response or skill help.

If the sentinel is absent, the worktree code did not load — repeat the recipe,
confirm you ran it from inside the worktree, and check that `/crew:status`
reports the expected version.

## Cross-references

- Story 1.8 user-surface gate: [`plugins/crew/docs/user-surface-acs.md`](user-surface-acs.md)
- Story 2.7 `/crew:ask` skill: [`plugins/crew/skills/ask/SKILL.md`](../skills/ask/SKILL.md)
- `_meta.role` enforcement record: [`plugins/crew/docs/ask-mode-enforcement.md`](ask-mode-enforcement.md)
- Original trap discovery record:
  `~/.claude/projects/-Users-jackmcintyre-projects-crew/memory/project_smoke_test_install.md`
