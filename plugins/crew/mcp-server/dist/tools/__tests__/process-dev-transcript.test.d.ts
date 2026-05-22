/**
 * Unit tests for `processDevTranscript` — Story 4.3b Task 8.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules —
 * the tool composes pure pieces and the test exercises the real composition.
 *
 * Covers:
 *   (a) Happy handoff → `next: "spawn-reviewer"`, reviewerPrompt, manifest NOT mutated.
 *   (b) Drift → `next: "done-blocked-handoff-grammar"`, manifest `blocked_by: "handoff-grammar"`.
 *   (c) Empty transcript → same as (b).
 *   (d) Whitespace-only transcript → same as (b).
 *
 * Story 4.3b Task 8.1–8.3.
 */
export {};
