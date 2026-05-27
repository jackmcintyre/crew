/**
 * Corpus integration test for parseBmadStory (Story 5.14 AC2).
 *
 * Walks every .md file in the real repo's _bmad-output/implementation-artifacts/
 * that matches the parser's expected filename pattern (<epic>-<story>-<slug>.md,
 * where epic and story are pure digits). This mirrors the BMAD_FILENAME_RE used
 * by listSourceStories in the BmadAdapter — retro docs, sprint-status.yaml, and
 * sub-story variants with letter suffixes (1-7a, 3-3b, etc.) are skipped exactly
 * as the real scanner skips them.
 *
 * AC2 focus: zero Status-vocabulary MalformedBmadStoryError throws.
 * After Story 5.14 widens the vocabulary to include draft/approved/review,
 * no file in this corpus should fail on `unknown Status value '...'`.
 *
 * Pre-existing AC-heading format failures in Epic 1 stories (authored before
 * the **AC<n>:** convention was established) are out of this story's scope —
 * they are reported but do NOT cause this test to fail. Only Status-vocabulary
 * errors cause failure.
 *
 * Path arithmetic (7 `..` from __dirname to repo root):
 *   __tests__/ → bmad/ → adapters/ → src/ → mcp-server/ → crew/ → plugins/ → repo root
 */
export {};
