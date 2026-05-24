/**
 * Integration test for BMad adapter leniency against a real-world-shaped
 * fixture (Story 3.8 AC6).
 *
 * The fixture at `fixtures/sample-real-world-repo/` mirrors the organic
 * deviations present in this repo's own BMad backlog:
 *   - `3-1-canonical-story.md`        — happy path (Status: backlog)
 *   - `4-8-no-suffix-followup.md`     — no-suffix companion for sort-order coverage
 *   - `4-8b-follow-up-story.md`       — letter-suffixed story ID (Status: backlog)
 *   - `5-1-no-status.md`              — no Status line (defaults to backlog)
 *   - `5-2-free-text-status.md`       — Status: revised — re-implement per 4.6 retro
 *   - `epic-1-retro-2026-05-20.md`    — non-story file, must be silently skipped
 *   - `sprint-status.yaml`            — non-.md file, must be silently skipped
 *
 * AC6 sub-assertions:
 *   1. listSourceStories() returns exactly 5 stories (bmad:3.1, bmad:4.8,
 *      bmad:4.8b, bmad:5.1, bmad:5.2) — retro and YAML not included.
 *   2. Manifests for bmad:3.1, bmad:4.8, bmad:4.8b, bmad:5.1 land under to-do/.
 *   3. Manifest for bmad:5.2 lands under blocked/.
 *   4. Exactly one warning names 5-2-free-text-status.md and the raw value.
 *   5. No error thrown; scan completes end-to-end.
 */
export {};
