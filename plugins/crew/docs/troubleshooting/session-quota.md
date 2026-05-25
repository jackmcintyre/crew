# Session quota exhausted

Sometimes a dev or reviewer subagent hits Claude's per-session or per-account
usage limit mid-run. The transcript will contain a line like:

> You've hit your session limit

When that happens, the dev session classifies the failure as a typed
`SessionQuotaExhaustedError`, the manifest is moved to `blocked/` with
`blocked_by: session-quota-exhausted`, and `/crew:start` emits:

> Story `<ref>` paused — session quota exhausted; retry after quota resets

## What the operator sees

- A chat line on `/crew:start` saying the story was paused.
- The manifest moved to `.crew/state/blocked/<ref>.yaml` (not `done/`).
- `failure: { class: "session-quota-exhausted", recoverable: true }` recorded
  in the dev-outcome / reviewer-outcome JSON.

## How to recover

1. Wait for the Claude session/account quota to reset (typically within a
   few hours; check the Claude console for the exact window).
2. Re-run `/crew:start`. The blocked manifest auto-promotes back into the
   ready queue once the block is cleared.

No code changes are required — this is recoverable failure on Claude's side,
not a bug in the plugin or your project.

## Why this exists

Without the typed classification, a quota-exhausted run would fall through
as generic handoff-grammar drift and the operator would have to debug a
"missing locked phrase" error. The typed class is the explicit recovery
surface (Story 4.12 retro AC6).
