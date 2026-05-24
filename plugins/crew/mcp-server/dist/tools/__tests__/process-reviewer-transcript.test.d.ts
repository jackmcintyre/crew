/**
 * Unit tests for `processReviewerTranscript` — Story 4.3b Task 9; Story 4.3c Task 5.
 *
 * Uses a real tmpdir with real `node:fs` ops. No mocking of imported modules.
 *
 * Covers:
 *   (a) READY FOR MERGE → `next: "done-ready-for-merge"`, `completed: true`,
 *       manifest moved to done/ with `status: "done"` and preserved `claimed_by`.
 *       (AC3(ii) seam contract — Story 4.3c)
 *   (b) NEEDS CHANGES (first rework) → `next: "rework-dev"`, reworkIteration: 1,
 *       manifest `rework_count: 1`, devPrompt populated, no `completed` field.
 *   (c) NEEDS CHANGES (second rework) → reworkIteration: 2, manifest `rework_count: 2`.
 *   (d) BLOCKED → `next: "done-blocked-reviewer-verdict"`, manifest NOT mutated,
 *       no `completed` field. (AC3(iii) — Story 4.3c)
 *   (e) Drift / empty / unknown-sentinel → `next: "done-blocked-reviewer-grammar"`,
 *       manifest `blocked_by: "reviewer-grammar"`, no `completed` field. (AC3(iv) — Story 4.3c)
 *
 * Story 4.3b Task 9.1–9.2; Story 4.3c Task 5.1–5.5.
 */
export {};
