/**
 * AC6 — SKILL.md content structure check — Story 4.3b.
 * AC3 — SKILL.md content structure check — Story 4.3c (revised tool-layer seam architecture).
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC6:
 *
 *   (i)    `allowed_tools` is exactly {getStatus, mintSessionUlid, claimNextStory,
 *           processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt,
 *           Task} — seven tools, no completeStory (reversed from original Story 4.3c spec).
 *   (ii)   Body contains the `# Inner cycle: dev → reviewer → rework` section.
 *   (iii)  That section contains `invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt`.
 *   (iv)   That section contains `invoke the Task tool with the reviewerPrompt returned by processDevTranscript`.
 *   (v)    That section contains `pass the captured devTranscript to processDevTranscript`.
 *   (vi)   That section contains `pass the captured reviewerTranscript to processReviewerTranscript`.
 *   (vii)  That section contains `MUST pass the transcript verbatim`.
 *   (viii) The `# Failure modes` section names `HandoffGrammarDriftError`, `blocked_by: handoff-grammar`,
 *          `ReviewerGrammarDriftError`, `blocked_by: reviewer-grammar`.
 *
 * Additional AC3 anchors (Story 4.3c revised):
 *   (AC3-vii)  `allowed_tools` equals exactly the 7-tool Story 4.3b set — NO `completeStory` entry.
 *              completeStory is now called internally by processReviewerTranscript, not through
 *              the MCP allowed_tools surface.
 *   (AC3-iii)  Inner-cycle section contains the literal string `completeStory` (referenced as an
 *              internal detail, not as a prose-layer call).
 *   (AC3-iv-new) Inner-cycle section contains `MUST NOT invoke completeStory directly` (new invariant).
 *   (AC3-v)   Inner-cycle section contains `story <ref> moved to done — claiming next` (em dash).
 *   (AC3-vi)  Inner-cycle section contains `claimNextStory` (loop-back step).
 *   (AC3-viii) `# Failure modes` section contains `completeStory`.
 *
 * Story 4.3b Task 11.1; Story 4.3c Task 7.
 */
export {};
