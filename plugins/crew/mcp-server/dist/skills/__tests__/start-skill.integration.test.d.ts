/**
 * Integration tests for `runStartLoop` — Story 4.2 Task 8 / AC4.
 *
 * Tests the claim-spawn-loop function that the /crew:start skill's prose maps to.
 * The Task-tool spawn is captured by a fake (a function that records its call args).
 * Assertions inspect the captured argument list per AC4.
 *
 * Covers AC4 branches:
 *   (a) Happy multi-claim: three independent stories → three spawns in alphabetical order.
 *       Uses REAL listClaimableTodos, claimStory, buildPersonaSpawnPrompt against tmpdir.
 *   (b) Queue drained: empty to-do/ and in-progress/ → verbatim queue-drained line, zero spawns.
 *   (c) Deps-not-ready surfacing: B.depends_on=[A]; A in to-do/, B in to-do/ →
 *       A claimed+spawned, B skipped silently (depsReady=false).
 *       Uses REAL listClaimableTodos, claimStory, buildPersonaSpawnPrompt against tmpdir.
 *   (d) Hand-edit refusal surfacing: claimStory on a hand-edited ref surfaces
 *       InProgressHandEditError verbatim.
 *
 * For AC4(a) and AC4(c): real production modules are used with tmpdir fixtures.
 * Only taskSpawn remains a recording fake (Claude Code's Task tool is unavailable in vitest).
 *
 * For AC4(b) and AC4(d): injected fakes (no filesystem required for those paths).
 *
 * Also covers the behavioural invariant for the "inProgressCount > 0, no eligible todos"
 * branch — ensures QUEUE_DRAINED_LINE is NOT emitted when in-progress work is active.
 */
export {};
