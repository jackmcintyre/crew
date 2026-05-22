/**
 * AC6 — SKILL.md content structure check — Story 4.3b.
 * AC3 — SKILL.md content structure check — Story 4.3c.
 *
 * Reads the on-disk `plugins/crew/skills/start/SKILL.md`, splits its YAML
 * front-matter, and asserts the deterministic structural anchors required by AC6:
 *
 *   (i)    `allowed_tools` is exactly {getStatus, mintSessionUlid, claimNextStory,
 *           processDevTranscript, processReviewerTranscript, buildPersonaSpawnPrompt,
 *           Task, completeStory}.
 *   (ii)   Body contains the `# Inner cycle: dev → reviewer → rework` section.
 *   (iii)  That section contains `invoke the Task tool with the devPrompt returned by buildPersonaSpawnPrompt`.
 *   (iv)   That section contains `invoke the Task tool with the reviewerPrompt returned by processDevTranscript`.
 *   (v)    That section contains `pass the captured devTranscript to processDevTranscript`.
 *   (vi)   That section contains `pass the captured reviewerTranscript to processReviewerTranscript`.
 *   (vii)  That section contains `MUST pass the transcript verbatim`.
 *   (viii) The `# Failure modes` section names `HandoffGrammarDriftError`, `blocked_by: handoff-grammar`,
 *          `ReviewerGrammarDriftError`, `blocked_by: reviewer-grammar`.
 *
 * Additional AC3 anchors (Story 4.3c):
 *   (AC3-i)   `allowed_tools` equals exactly the 8-tool set including `completeStory`.
 *   (AC3-iii) Inner-cycle section contains the literal string `completeStory`.
 *   (AC3-iv)  Inner-cycle section contains `call completeStory({ targetRepoRoot, ref, sessionUlid })`.
 *   (AC3-v)   Inner-cycle section contains `story <ref> moved to done — claiming next` (em dash).
 *   (AC3-vi)  Inner-cycle section contains `MUST NOT call completeStory`.
 *   (AC3-vii) `# Failure modes` section contains `completeStory`.
 *
 * Story 4.3b Task 11.1; Story 4.3c Task 5.
 */
export {};
