/**
 * `BLOCKED_BY_HINTS` — Story 5.13, AC3.
 *
 * A single exported lookup table mapping every `BlockedBy` enum member to a
 * per-case operator hint. The hint text is the deterministic seam (per project
 * memory `feedback_default_to_deterministic_seams`) — it lives here, not in
 * SKILL.md prose, so the skill can reference the tool-written artefact's return
 * shape verbatim.
 *
 * Hint format: `[<member>] {ref} — <operator action>`
 * where `{ref}` is a literal placeholder the caller substitutes at render time.
 *
 * The thirteen members are the closed v1 enum defined in `execution-manifest.ts`
 * § AC2. Any new block reason requires a deliberate schema-change story.
 */

import type { BlockedBy } from "../schemas/execution-manifest.js";

export type { BlockedBy };

/**
 * Per-case operator hints for every `BlockedBy` enum member.
 *
 * `{ref}` is a literal placeholder — callers should replace it with the actual
 * story ref before displaying the hint to the operator.
 */
export const BLOCKED_BY_HINTS: Readonly<Record<BlockedBy, string>> = {
  "handoff-grammar":
    "[handoff-grammar] {ref} — the dev subagent did not emit the verbatim locked handoff phrase on its last output line; clear `blocked_by` from the in-progress manifest, then re-run /crew:start",

  "gh-defer":
    "[gh-defer] {ref} — a GitHub API call was rate-limited or deferred; wait and re-run /crew:start",

  "gh-retry":
    "[gh-retry] {ref} — a transient network error hit the GitHub API; re-run /crew:start (v2 will auto-retry)",

  "gh-needs-human":
    "[gh-needs-human] {ref} — GitHub auth failed; run `gh auth login` then re-run /crew:start",

  "reviewer-no-session-result":
    "[reviewer-no-session-result] {ref} — the reviewer subagent ran but did not call runReviewerSession; inspect the reviewer transcript, fix the issue, clear `blocked_by` from the in-progress manifest, then re-run /crew:start",

  "reviewer-verdict-needs-changes":
    "[reviewer-verdict-needs-changes] {ref} — the reviewer found failing ACs; the inner cycle will loop back to dev rework automatically on the next /crew:start",

  "reviewer-verdict-blocked":
    "[reviewer-verdict-blocked] {ref} — the reviewer returned BLOCKED (empty or manual-check-required ACs); human operator must intervene before the story can proceed",

  "routing-failure":
    "[routing-failure] {ref} — no hired role matches the story domain; run /crew:hire to add a role with this domain, then re-run /crew:start",

  "routing-self-yield":
    "[routing-self-yield] {ref} — in-domain insistence: the specialist attempted to yield to its own domain; inspect the yield phrase and fix the persona, then re-run /crew:start",

  "planning-discipline":
    "[planning-discipline] {ref} — the source spec violates one or more planning-discipline rules; fix the source story's ACs or narrative, then re-run /crew:scan",

  "orphan-no-transcript":
    "[orphan-no-transcript] {ref} — the in-progress manifest's session has no persisted transcript; manual recovery required — inspect .crew/state/sessions/ and re-run /crew:start",

  "reviewer-grammar":
    "[reviewer-grammar] {ref} — reserved for reviewer-grammar drift (Story 4.3); clear `blocked_by` from the in-progress manifest after diagnosing the reviewer's output, then re-run /crew:start",

  "deps-drift":
    "[deps-drift] {ref} — fix the spec's \"Depends on:\" prose or the source story's ## Dependencies section so prose and manifest deps agree, then re-run /crew:scan",
} as const;

/**
 * Render the per-case operator hint for a blocked manifest, substituting
 * the actual `ref` string for the `{ref}` placeholder.
 *
 * Returns the verbatim hint string with `{ref}` replaced by `ref`.
 * Called by `/crew:start`'s blocked-recovery surface.
 */
export function renderBlockedRecoveryHint(blockedBy: BlockedBy, ref: string): string {
  const template = BLOCKED_BY_HINTS[blockedBy];
  return template.replace(/\{ref\}/g, ref);
}
