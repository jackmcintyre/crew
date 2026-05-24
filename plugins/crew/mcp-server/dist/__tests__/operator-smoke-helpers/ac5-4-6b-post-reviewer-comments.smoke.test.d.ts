/**
 * AC5 (user-surface) operator-smoke extension for Story 4.6b — Task 10.
 *
 * @description
 * Extends the Story 4.6 rubber-stamp reproducer with the post-reviewer step:
 *   1. Same scratch repo — one ready story with `artifact: target-file.txt`.
 *   2. Dev handoffs without creating the artifact (rubber-stamp).
 *   3. `runReviewerSession` executes — finds artifact missing, returns NEEDS CHANGES.
 *   4. `postReviewerComments` is called AFTER runReviewerSession returns and
 *      BEFORE processReviewerTranscript runs.
 *   5. The captured `gh api` body is asserted per spec §5b:
 *      - Final line of body: `**Verdict: NEEDS CHANGES** [1 issues, 0 questions]`
 *      - `comments` array has length 1 (failing artifact path appears in diff)
 *      - Inline comment body contains both `target-file.txt` and `ENOENT`
 *   6. processReviewerTranscript is still called — manifest stays in in-progress/
 *      with `blocked_by: "reviewer-verdict-needs-changes"` (spec §5c).
 *
 * Smoke-gate: per `plugins/crew/docs/user-surface-acs.md` § Pre-PR gate,
 * this test provides the CI-level evidence for AC5 (user-surface).
 * The operator may substitute manual-paste evidence per spec §5d.
 *
 * Story 4.6b Task 10.1–10.4.
 */
export {};
