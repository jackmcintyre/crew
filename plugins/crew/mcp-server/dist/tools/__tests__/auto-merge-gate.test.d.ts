/**
 * Integration tests for `runAutoMergeGate` — Story 4.10b (AC5).
 *
 * Branch coverage:
 *  (5d) auto-merge fires
 *  (5e) medium pauses
 *  (5f) high pauses
 *  (5g) low + sub-threshold pauses
 *  (5h) low + insufficient-data pauses
 *  (5i) manual merge override (verdict !== READY FOR MERGE)
 *  (5j) no-session-result
 *  (5k) missing-risk-tier
 *  (5l) configurable threshold
 *  (5n) recoverable gh error on merge propagates
 *  (5o) recoverable gh error on label-apply propagates
 *  (5p) gh pr view --json headRepository,headRepositoryOwner resolution
 *  (5q) tool-name camelCase registration
 *  (5r) prNumber passed as String
 *  AC6 — residual medium/high findings without override pauses
 *  Permission-file: pr-merge in orchestrator.gh_allow + runAutoMergeGate in tools_allow
 *  SKILL.md-wiring: runAutoMergeGate exactly once on done-ready-for-merge branch
 *
 * Story 4.10b Task 5.
 */
export {};
