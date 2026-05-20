#!/bin/sh
# plugins/crew/scripts/dev-install.sh — make the active worktree's plugin tree
# authoritative for the next Claude Code session by replacing the install-cache
# directory with a symlink that points at the source tree.
#
# Story 1.11. Chosen mechanism: hybrid symlink — see
# plugins/crew/docs/spikes/dev-install-decision.md.
#
# Usage (canonical form):
#   pnpm --dir plugins/crew dev:install [--kill-daemon]
#
# Flags:
#   --kill-daemon   After creating the symlink, kill the running crew MCP server
#                   process (targeted via pgrep -f). The daemon respawns it on the
#                   next /reload-plugins. Does NOT cause the skill index to re-scan;
#                   a full Claude Code restart is still required for new skills.
#
# Exit codes:
#   0  success — symlink created (or already correct); restart Claude Code to pick
#                up new skills in the slash-command picker.
#   2  preflight failure — not in a git repo, or plugin.json missing.
#   3  build failure — dist/index.js missing; run:
#                       pnpm --dir plugins/crew/mcp-server build
#   4  cache write failure — could not remove existing cache dir or create symlink.
#   5  sentinel verify failure — symlink exists but plugin.json version mismatch.

set -e

# ── helpers ──────────────────────────────────────────────────────────────────

die() {
  printf 'dev:install: %s\n' "$*" >&2
  exit "${_EXIT_CODE:-1}"
}

die2() { _EXIT_CODE=2; die "$@"; }
die3() { _EXIT_CODE=3; die "$@"; }
die4() { _EXIT_CODE=4; die "$@"; }
die5() { _EXIT_CODE=5; die "$@"; }

# ── parse flags ──────────────────────────────────────────────────────────────

kill_daemon=0
for arg in "$@"; do
  case "$arg" in
    --kill-daemon) kill_daemon=1 ;;
    --help|-h)
      sed -n '2,/^[^#]/{ /^#/s/^# \{0,1\}//p }' "$0"
      exit 0
      ;;
    *)
      printf 'dev:install: unknown flag: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# ── step 1: preflight ────────────────────────────────────────────────────────

if ! command -v git >/dev/null 2>&1; then
  die2 "preflight: git not found on PATH"
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || die2 "preflight: not inside a git repository"

plugin_json="$root/plugins/crew/.claude-plugin/plugin.json"
if [ ! -f "$plugin_json" ]; then
  die2 "preflight: missing $plugin_json"
fi

# Read version from plugin.json using node (already a dep via pnpm workspace).
# Pass the path via env var to avoid single-quote injection if the path contains quotes.
version=$(plugin_json="$plugin_json" node -e "process.stdout.write(require(process.env.plugin_json).version)" 2>/dev/null) || \
  die2 "preflight: could not read version from $plugin_json"

if [ -z "$version" ]; then
  die2 "preflight: version field is empty in $plugin_json"
fi

source_dir="$root/plugins/crew"

# ── step 2: build check ──────────────────────────────────────────────────────

dist_index="$source_dir/mcp-server/dist/index.js"
if [ ! -f "$dist_index" ]; then
  die3 "build check: dist/index.js not found — run: pnpm --dir plugins/crew/mcp-server build"
fi

# ── step 3: cache resolution ─────────────────────────────────────────────────

# Target path. The literal $HOME/.claude/plugins/cache/crew/crew is used throughout
# this script and its output — this is the substring asserted by AC6.
target="$HOME/.claude/plugins/cache/crew/crew/$version"

if [ -L "$target" ]; then
  # Already a symlink — check if it already points at our source.
  existing_target=$(readlink "$target")
  if [ "$existing_target" = "$source_dir" ]; then
    printf 'dev:install ok → %s (already up to date)\n' "$target"
    printf 'next: restart Claude Code to pick up skill-index changes, or run /reload-plugins for MCP-only changes — see plugins/crew/docs/dev-loop.md\n'
    exit 0
  fi
  # Symlink exists but points elsewhere — remove and recreate.
  rm "$target" || die4 "cache write: could not remove stale symlink at $target"
elif [ -e "$target" ]; then
  # Regular directory (e.g. from a previous /plugin install). Verify the path is
  # safely scoped to the crew cache before removing.
  # NOTE: the case guard below is defensive belt-and-braces — $target is always
  # constructed as "$HOME/.claude/plugins/cache/crew/crew/$version" (three lines above)
  # so this branch cannot fire in normal usage. Kept as a future-refactor guard.
  case "$target" in
    "$HOME/.claude/plugins/cache/crew/crew/"*) ;;
    *)
      die4 "cache write: refusing to remove $target — path is outside expected cache scope"
      ;;
  esac
  rm -rf "$target" || die4 "cache write: could not remove existing cache directory at $target"
fi

# Create parent dirs if needed.
parent=$(dirname "$target")
mkdir -p "$parent" || die4 "cache write: could not create parent directory $parent"

# ── step 4: create symlink ───────────────────────────────────────────────────

ln -s "$source_dir" "$target" || die4 "cache write: ln -s failed for $target"

# ── step 5: sentinel verify ──────────────────────────────────────────────────

sentinel="$target/.claude-plugin/plugin.json"
if [ ! -f "$sentinel" ]; then
  die5 "sentinel verify: $sentinel not readable via symlink — check symlink target"
fi

installed_version=$(plugin_json="$sentinel" node -e "process.stdout.write(require(process.env.plugin_json).version)" 2>/dev/null) || \
  die5 "sentinel verify: could not parse version from $sentinel"

if [ "$installed_version" != "$version" ]; then
  die5 "sentinel verify: version mismatch — source=$version, cache=$installed_version"
fi

# ── step 6: success ──────────────────────────────────────────────────────────

printf 'dev:install ok → %s (source: %s)\n' "$target" "$source_dir"

# ── optional step 7: kill daemon ─────────────────────────────────────────────

if [ "$kill_daemon" = "1" ]; then
  # Only target processes whose command line matches our specific dist/index.js.
  # Use pkill -f directly to avoid the multi-PID-string pitfall from pgrep: if
  # multiple matching processes exist, pgrep returns a newline-separated list and
  # passing that as a single quoted arg to kill would fail. pkill handles this
  # atomically. Pattern anchored to "node .*" so editors/viewers of the path
  # are never matched. NEVER kill arbitrary PIDs.
  if pkill -f "node .*plugins/crew/mcp-server/dist/index.js" 2>/dev/null; then
    printf 'killed crew mcp daemon process(es) matching node .*plugins/crew/mcp-server/dist/index.js\n'
  else
    printf '(no crew mcp daemon process found to kill)\n'
  fi
fi

printf 'next: restart Claude Code to pick up skill-index changes (or /reload-plugins for MCP-only changes) — see plugins/crew/docs/dev-loop.md\n'
exit 0
