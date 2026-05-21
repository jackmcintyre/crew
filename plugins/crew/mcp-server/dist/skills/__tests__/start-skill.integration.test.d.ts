/**
 * Integration tests for `runStartLoop` — Story 4.2 Task 8 / AC4.
 *
 * Tests the claim-spawn-loop function that the /crew:start skill's prose maps to.
 * The Task-tool spawn is captured by a fake (a function that records its call args).
 * Assertions inspect the captured argument list per AC4.
 *
 * Covers AC4 branches:
 *   (a) Happy multi-claim: three independent stories → three spawns in alphabetical order.
 *   (b) Queue drained: empty to-do/ and in-progress/ → verbatim queue-drained line, zero spawns.
 *   (c) Deps-not-ready surfacing: B.depends_on=[A]; A in to-do/, B in to-do/ →
 *       A claimed+spawned, B skipped silently (depsReady=false).
 *   (d) Hand-edit refusal surfacing: claimStory on a hand-edited ref surfaces
 *       InProgressHandEditError verbatim.
 *
 * The loop is driven via injection point (test seam) — no Claude Code harness required.
 */
export {};
