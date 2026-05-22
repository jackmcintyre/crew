/**
 * Integration tests for the inner dev → reviewer cycle through tool composition
 * — Story 4.3b Task 10.
 *
 * Composes `processDevTranscript` and `processReviewerTranscript` in the order
 * the SKILL.md prose will compose them: processDevTranscript →
 * processReviewerTranscript → (maybe loop). The Claude Code `Task` tool is NOT
 * in the loop — this is a unit-level integration test of the MCP layer's
 * composition correctness.
 *
 * Each test case seeds a fixture tmpdir with:
 *   - `.crew/config.yaml` (native adapter)
 *   - `.crew/state/in-progress/<ref>.yaml` (pre-claimed manifest)
 *   - `team/generalist-dev/PERSONA.md`
 *   - `team/generalist-reviewer/PERSONA.md`
 *
 * Covers the AC4 branches (a)–(g):
 *   (a) Happy handoff + READY FOR MERGE.
 *   (b) Rework loop: NEEDS CHANGES × 1 → READY FOR MERGE.
 *   (c) Grammar drift (handoff drift).
 *   (d) Two-iteration rework convergence.
 *   (e) Reviewer grammar drift.
 *   (f) Reviewer BLOCKED passthrough.
 *   (g) Tool count assertion (21 tools, contains new tools, does not contain runDevSession).
 *
 * Story 4.3b Task 10.1–10.4.
 */
export {};
