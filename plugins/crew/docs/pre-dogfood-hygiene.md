# Pre-dogfood hygiene checklist

Run this checklist before promoting `dev → main` ahead of a dogfood resumption attempt. It exists because the 2026-05-25 rollback was preceded by latent state drift that nobody noticed until things broke under load.

## Invariants verified at promotion time

Run each command from the repo root. Every line should return the empty / "no match" state shown.

```bash
# 1. Working tree clean on dev (or current trunk)
git status --short
#   expected: no output
```

```bash
# 2. No stale ship-story worktrees
git worktree list | grep -v "^$(pwd)\s"
#   expected: no output (only the main repo worktree should be listed)
```

```bash
# 3. No leftover story branches local
git branch | grep "story/" || echo "ok"
#   expected: ok
```

```bash
# 4. No leftover story branches remote
git branch -r | grep "story/" || echo "ok"
#   expected: ok
```

```bash
# 5. No stale stashes
git stash list
#   expected: no output (drop or land any leftover stashes before promotion)
```

```bash
# 6. Runtime state directory empty
find .crew/state -mindepth 1 2>/dev/null || echo "ok"
#   expected: ok (or .crew/state does not exist — also fine)
```

```bash
# 7. Pending ship-story cleanups drained
python3 .claude/skills/ship-story/scripts/ship.py pending-cleanup
#   expected: {"pending": []}
```

## Promotion procedure

After all seven invariants pass:

```bash
# Fast-forward dev → main locally
git checkout main
git pull --ff-only origin main
git merge --ff-only dev
git push origin main

# Tag the promotion commit
git tag pre-dogfood-resumption-N  # bump N per attempt
git push origin pre-dogfood-resumption-N

# Switch back to dev for ongoing work
git checkout dev
```

`--ff-only` on both `pull` and `merge` is load-bearing — it refuses to create a merge commit, ensuring `main` is exactly the dev tip. Per memory `feedback_never_commit_to_local_main`, this is the only way `main` should ever change locally.

## Branch protection re-enable

After the push lands:

```bash
gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]=build \
  -f enforce_admins=true \
  -f restrictions=null \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Or toggle via the GitHub web UI: **Settings → Branches → main → Block force pushes ON**.

The block-force-pushes setting is the load-bearing line per memory `project_branch_protection_load_bearing` — it's what stopped the 2026-05-25 rollback from going further wrong. Never leave it off across a promotion.

## When this checklist should run

- Before every dogfood attempt (the obvious case).
- After any incident that touches branch state or git history (force-push, history rewrite, mass branch cleanup).
- On a cadence (e.g. weekly) if dogfood is paused for an extended period.

## Known recurring drift

The `plugins/crew/mcp-server/dist/*.d.ts` files occasionally show pure key-ordering churn (`medium`/`low` swap inside Zod enum inferences) between local `tsc` rebuilds and the committed copy. This is cosmetic — the runtime types are identical — but it trips the working-tree-clean check above. Workaround: `git restore plugins/crew/mcp-server/dist/` before running the checklist; investigating the underlying TS/Zod determinism is a separate substrate follow-up.
