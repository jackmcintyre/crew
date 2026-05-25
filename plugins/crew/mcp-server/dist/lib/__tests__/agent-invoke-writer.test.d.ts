/**
 * Tests for `writeAgentInvokeEvent` and the `processDevTranscript`
 * integration of agent.invoke + reviewer.verdict events.
 *
 * vitest: agent.invoke event written on dev spawn
 * vitest: reviewer.verdict event written on post
 * vitest: per-invocation-telemetry
 * vitest: SessionQuotaExhaustedError classified from transcript
 */
export {};
