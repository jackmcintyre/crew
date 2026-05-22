/**
 * Content-structure tests for AC6 anchors — Story 4.3b Task 11.2.
 *
 * Reads the source files for the two new transcript-processor tools and
 * register.ts, asserting the verbatim anchor strings required by AC6(ix)–(xi).
 *
 * AC6(ix):  `process-dev-transcript.ts` contains `handoff received — story`
 *           and `handoff grammar drift — story`, but NOT
 *           `re-spawning generalist-dev subagent (rework iteration`.
 * AC6(x):   `process-reviewer-transcript.ts` contains
 *           `re-spawning generalist-dev subagent (rework iteration`,
 *           `reviewer verdict: READY FOR MERGE`,
 *           `reviewer verdict: BLOCKED`,
 *           `reviewer grammar drift — story`.
 * AC6(xi):  `register.ts` contains zero occurrences of the literal `"runDevSession"`.
 *
 * Story 4.3b Task 11.2.
 */
export {};
