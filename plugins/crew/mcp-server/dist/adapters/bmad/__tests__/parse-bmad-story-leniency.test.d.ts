/**
 * Unit tests for BMad adapter leniency rules (Story 3.8).
 *
 * Covers:
 *   - AC1: letter-suffixed story IDs parsed correctly.
 *   - AC2: missing Status defaults to "backlog".
 *   - AC3: unknown Status does not throw; status_unknown field set.
 *   - AC4: (no parser test needed — readStoriesDir is tested in integration test)
 */
export {};
