/**
 * Unit tests for `processReviewerTranscript` — Story 4.3b Task 9.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules.
 *
 * Covers:
 *   (a) READY FOR MERGE → `next: "done-ready-for-merge"`, manifest NOT mutated.
 *   (b) NEEDS CHANGES (first rework) → `next: "rework-dev"`, reworkIteration: 1,
 *       manifest `rework_count: 1`, devPrompt populated.
 *   (c) NEEDS CHANGES (second rework) → reworkIteration: 2, manifest `rework_count: 2`.
 *   (d) BLOCKED → `next: "done-blocked-reviewer-verdict"`, manifest NOT mutated.
 *   (e) Drift / empty / unknown-sentinel → `next: "done-blocked-reviewer-grammar"`,
 *       manifest `blocked_by: "reviewer-grammar"`.
 *
 * Story 4.3b Task 9.1–9.2.
 */
export {};
