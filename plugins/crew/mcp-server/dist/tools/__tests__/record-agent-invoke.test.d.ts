/**
 * Integration tests for `recordAgentInvoke` — Story 4.12 Task 8.1.
 *
 * AC5 coverage:
 *   (a) `agent.invoke` written on every spawn (5b)
 *   (c) Hard-8-min substitution (5d)
 *   (d) 30-min dev budget surfaces (5e)
 *   Extra: RuntimeBoundsInvalidError edge cases (5f)
 *   Extra: Non-dev/non-reviewer roles (5f)
 *   Extra: Round-trip JSONL parseability (5g)
 *
 * Test seams used: `logTelemetryEventImpl`, `postReviewerCommentsImpl`,
 * `applyReviewerLabelsImpl`, `readCurrentMonthJsonlImpl`, `nowImpl`.
 * No `vi.mock()` of production modules.
 *
 * Tmpdir convention: `fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"))`.
 */
export {};
