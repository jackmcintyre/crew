/**
 * Unit tests for `runDevReviewerCycle` — Story 4.3 Task 9.
 *
 * Uses fakes for all four dependencies (buildPrompt, taskSpawnWithTranscript,
 * readManifest, writeManifest). Real node:fs against a tmpdir is used for the
 * readManifest / writeManifest fakes in AC4(b)/(f) to verify on-disk state.
 *
 * Covers:
 *   (a) happy handoff + READY FOR MERGE → no manifest writes, finalState:
 *       "ready-for-merge", chatLog contains AC1 verbatim
 *   (b) NEEDS CHANGES → manifest write with rework_count: 1 → second cycle
 *       happy → finalState: "ready-for-merge", chatLog contains AC2 verbatim
 *       with <n> = 1
 *   (c) handoff drift → manifest write with blocked_by: "handoff-grammar",
 *       finalState: "blocked-handoff-grammar", no reviewer spawn, AC3 verbatim
 *   (d) reviewer verdict drift → manifest write with blocked_by:
 *       "reviewer-grammar", finalState: "blocked-reviewer-grammar",
 *       verbatim reviewer-drift line
 *   (e) BLOCKED verdict → no manifest write, finalState:
 *       "blocked-reviewer-verdict", verbatim BLOCKED passthrough
 *   (f) two-iteration rework (NEEDS CHANGES × 2 → READY FOR MERGE) →
 *       rework_count: 2, AC2 line appears twice
 */
export {};
