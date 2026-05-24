/**
 * AC6 — SKILL.md content structure check — Story 4.3b.
 * AC3 — SKILL.md content structure check — Story 4.3c (revised tool-layer seam architecture).
 * Story 4.6 revision 2 — operator-surface migration anchors.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC6:
 *
 *   (i)    `allowed_tools` is exactly {getStatus, mintSessionUlid, claimNextStory,
 *           processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt,
 *           runReviewerSession, Task} — eight tools, no completeStory.
 *   (ii)   Body contains the `# Inner cycle: dev → reviewer → rework` section.
 *   (iii)  That section contains `invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt`.
 *   (iv)   That section contains `invoke the Task tool with the reviewerPrompt returned by processDevTranscript`.
 *   (v)    That section contains `pass the captured devTranscript to processDevTranscript`.
 *   (vi)   That section contains `invoke processReviewerTranscript` WITHOUT a `reviewerTranscript` param
 *          (Story 4.6 rev-2: the reviewer transcript is no longer passed; the file is the verdict transport).
 *   (vii)  That section contains `MUST pass the transcript verbatim` (dev transcript invariant).
 *   (viii) The `# Failure modes` section names `HandoffGrammarDriftError`, `blocked_by: handoff-grammar`,
 *          and the three new reviewer verdict variants from Story 4.6 rev-2:
 *          `done-blocked-reviewer-needs-changes`, `done-blocked-reviewer-blocked`,
 *          `done-blocked-no-session-result`.
 *
 * Story 4.6 rev-2 operator-surface anchors (H3 fix):
 *   - SKILL.md does NOT contain `reviewerTranscript` (deleted param must stay deleted).
 *   - SKILL.md does NOT contain `ReviewerGrammarDriftError` (removed in rev-2).
 *   - SKILL.md contains switch branches for `done-blocked-reviewer-needs-changes`,
 *     `done-blocked-reviewer-blocked`, `done-blocked-no-session-result`.
 *   - SKILL.md references `reviewer-result.json` (the verdict transport introduced in rev-2).
 *
 * Additional AC3 anchors (Story 4.3c revised):
 *   (AC3-vii)  `allowed_tools` equals exactly the 8-tool Story 4.6 set — NO `completeStory` entry.
 *              completeStory is now called internally by processReviewerTranscript, not through
 *              the MCP allowed_tools surface.
 *   (AC3-iii)  Inner-cycle section contains the literal string `completeStory` (referenced as an
 *              internal detail, not as a prose-layer call).
 *   (AC3-iv-new) Inner-cycle section contains `MUST NOT invoke completeStory directly` (new invariant).
 *   (AC3-v)   Inner-cycle section contains `story <ref> moved to done — claiming next` (em dash).
 *   (AC3-vi)  Inner-cycle section contains `claimNextStory` (loop-back step).
 *   (AC3-viii) `# Failure modes` section contains `completeStory`.
 *
 * Story 4.3b Task 11.1; Story 4.3c Task 7; Story 4.6 rev-2 H3 fix.
 */
export {};
