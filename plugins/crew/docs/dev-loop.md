# crew plugin — developer loop guide

> **This guide is for engineers iterating on the plugin itself.** If you are
> installing the plugin as an end-user, follow [`README-install.md`](./README-install.md).

## Two install paths

| Path | Command | Use when |
|------|---------|----------|
| **Production** | `/plugin install crew@crew` (inside Claude Code) | End-user installing from main — see `README-install.md` |
| **Dev** | `pnpm --dir plugins/crew dev:install` (shell) | Engineer iterating on a worktree branch — this guide |

## When to use which

Use the **production path** when you are a first-time installer following the six
checkpoints in `README-install.md`, or when you want to reset to the main-branch
plugin state.

Use the **dev-install path** when you have checked out a worktree branch (e.g.
`.worktrees/story/1-11-…/`) and you want the next Claude Code session to run the
worktree's `skills/`, `mcp-server/dist/`, and catalogue — not the main-branch copy
that the marketplace already knows about.

## Dev-install command

Run from anywhere inside the repo (git root or worktree root):

```bash
pnpm --dir plugins/crew dev:install
```

Optional flag: add `--kill-daemon` to also kill the running crew MCP server process
so `/reload-plugins` picks up fresh code without requiring a full restart.

```bash
pnpm --dir plugins/crew dev:install --kill-daemon
```

## What it does

1. **Verifies preflight conditions** — confirms you are inside a git repo, that
   `plugins/crew/.claude-plugin/plugin.json` exists, and that
   `plugins/crew/mcp-server/dist/index.js` is present (if `dist/` is missing,
   it exits with a message naming the build command instead of auto-building).
2. **Replaces the install-cache entry** — removes
   `~/.claude/plugins/cache/crew/crew/<version>/` (if it is a regular directory
   from a previous `/plugin install`) and creates a symlink there pointing at
   the worktree's `plugins/crew/` directory. On a no-op re-run the existing
   symlink is left in place (idempotent).
3. **Prints a one-line confirmation** — the success line contains the literal
   `~/.claude/plugins/cache/crew/crew` so you can paste it as smoke evidence.

## After running it

Restart Claude Code (quit and reopen). A full restart is required for new skills
to appear in the slash-command picker — `/reload-plugins` alone does not re-scan
the skill index after a cold install-cache change.

If you only changed MCP server TypeScript (no new skills), `/reload-plugins` is
enough after the symlink is in place.

See [`spikes/dev-install-decision.md`](spikes/dev-install-decision.md) for the
empirical research behind this guidance.

## Relationship to the daily dev loop

If you are editing on the **current branch** (not switching branches), the
watch-build + `/reload-plugins` loop in
[`worktree-smoke.md` § Daily dev loop](worktree-smoke.md#daily-dev-loop) is still
the fastest path (~5–8 s per change).

Use `pnpm --dir plugins/crew dev:install` only when **switching to a worktree
branch** that the marketplace does not already know about — i.e. when
`/plugin install crew@crew` would silently re-copy from main instead of your
branch.

## Troubleshooting

| Exit code | Meaning | Fix |
|-----------|---------|-----|
| `2` | Preflight failure — not in a git repo, or `plugin.json` missing | Run from inside the repo; check `plugins/crew/.claude-plugin/plugin.json` exists |
| `3` | `dist/index.js` not found | Run `pnpm --dir plugins/crew/mcp-server build` first |
| `4` | Cache write failure — could not remove or create symlink | Check permissions on `~/.claude/plugins/cache/`; `ls -la` to inspect |
| `5` | Sentinel verify failure — version mismatch after symlink | Check `plugins/crew/.claude-plugin/plugin.json` version field matches what was expected |
