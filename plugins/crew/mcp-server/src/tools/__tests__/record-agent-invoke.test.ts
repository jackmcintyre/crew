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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { recordAgentInvoke } from "../record-agent-invoke.js";
import { RuntimeBoundsInvalidError } from "../../errors.js";
import { TelemetryEventSchema } from "../../schemas/telemetry-events.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { DEV_BUDGET_MS, REVIEWER_HARD_CAP_MS } from "../../lib/runtime-limits.js";
import type { PostReviewerCommentsOptions } from "../post-reviewer-comments.js";
import type { ApplyReviewerLabelsOptions } from "../apply-reviewer-labels.js";
import type { LogTelemetryEventOpts } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJsonlLines(filePath: string): Promise<string[]> {
  const body = await fs.readFile(filePath, "utf8");
  return body
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

async function readAllJsonlLines(root: string, now: Date): Promise<string[]> {
  const month = now.toISOString().slice(0, 7);
  const filePath = path.join(root, ".crew", "telemetry", `${month}.jsonl`);
  try {
    return await readJsonlLines(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function parseAllEvents(lines: string[]) {
  return lines.map((l) => JSON.parse(l));
}

const T0 = "2026-05-26T10:00:00.000Z";
const T0_MS = Date.parse(T0);

function msAfter(baseMs: number, addMs: number): string {
  return new Date(baseMs + addMs).toISOString();
}

const FIXED_NOW = new Date("2026-05-26T12:00:00.000Z");
const nowImpl = () => FIXED_NOW;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC5(a) / 5b: `agent.invoke` written on every spawn
// ---------------------------------------------------------------------------

describe("(5b) agent.invoke written on every spawn", () => {
  it("writes three agent.invoke events for three calls, each with correct fields", async () => {
    const sessions = [
      "SESSION-001",
      "SESSION-002",
      "SESSION-003",
    ];

    for (const sessionUlid of sessions) {
      const result = await recordAgentInvoke({
        sessionUlid,
        agent: "pm",
        startedAt: T0,
        completedAt: msAfter(T0_MS, 60_000),
        targetRepoRoot: tmpRoot,
        nowImpl,
      });
      expect(result).toEqual({ kind: "ok" });
    }

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(3);

    const events = parseAllEvents(lines);
    expect(events[0].type).toBe("agent.invoke");
    expect(events[0].session_id).toBe("SESSION-001");
    expect(events[0].agent).toBe("pm");
    expect(events[0].data.runtime_ms).toBe(60_000);

    expect(events[1].session_id).toBe("SESSION-002");
    expect(events[2].session_id).toBe("SESSION-003");

    // Assert no other event types were written
    for (const e of events) {
      expect(e.type).toBe("agent.invoke");
    }
  });

  it("includes optional tokens_in / tokens_out when provided", async () => {
    await recordAgentInvoke({
      sessionUlid: "SESSION-TOKEN",
      agent: "generalist-dev",
      storyId: "bmad:1.2",
      startedAt: T0,
      completedAt: msAfter(T0_MS, 120_000),
      tokensIn: 500,
      tokensOut: 1200,
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const event = JSON.parse(lines[0]!);
    expect(event.data.tokens_in).toBe(500);
    expect(event.data.tokens_out).toBe(1200);
  });

  it("omits tokens fields when not provided", async () => {
    await recordAgentInvoke({
      sessionUlid: "SESSION-NO-TOKENS",
      agent: "generalist-dev",
      startedAt: T0,
      completedAt: msAfter(T0_MS, 30_000),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const event = JSON.parse(lines[0]!);
    expect(event.data.tokens_in).toBeUndefined();
    expect(event.data.tokens_out).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC5(c) / 5d: Hard-8-min substitution
// ---------------------------------------------------------------------------

describe("(5d) hard-8-min reviewer substitution", () => {
  it("(c1) returns reviewer-timed-out with stubbed URL and labels", async () => {
    const stubbedUrl = "https://github.com/owner/repo/pull/42#pullrequestreview-9999";
    const postImpl = vi.fn().mockResolvedValue({
      next: "posted",
      postedReviewId: 9999,
      url: stubbedUrl,
    });
    const applyImpl = vi.fn().mockResolvedValue({
      next: "applied",
      labelsApplied: ["reviewed-by-agent", "needs-human"],
    });

    const overCapRuntime = REVIEWER_HARD_CAP_MS + 60_001;
    const result = await recordAgentInvoke({
      sessionUlid: "SESSION-REVIEWER-OVER-CAP",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, overCapRuntime),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string; url?: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    expect(result.kind).toBe("reviewer-timed-out");
    if (result.kind === "reviewer-timed-out") {
      expect(result.substitutedCommentUrl).toBe(stubbedUrl);
      expect(result.labelsApplied).toEqual(["reviewed-by-agent", "needs-human"]);
    }
  });

  it("(c2) JSONL has one agent.invoke with over-cap runtime_ms", async () => {
    const overCapRuntime = REVIEWER_HARD_CAP_MS + 1;
    const postImpl = vi.fn().mockResolvedValue({ next: "posted", postedReviewId: 1 });
    const applyImpl = vi.fn().mockResolvedValue({ next: "applied", labelsApplied: ["reviewed-by-agent", "needs-human"] });

    await recordAgentInvoke({
      sessionUlid: "SESSION-CAP-JSONL",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, overCapRuntime),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    // Should have only agent.invoke (reviewer.verdict is emitted by postReviewerComments stub, not us)
    const agentInvokeEvents = parseAllEvents(lines).filter(e => e.type === "agent.invoke");
    expect(agentInvokeEvents).toHaveLength(1);
    expect(agentInvokeEvents[0].data.runtime_ms).toBe(overCapRuntime);
    expect(agentInvokeEvents[0].agent).toBe("generalist-reviewer");
  });

  it("(c3) substituted comment body contains the 8-minute header and runtime in seconds", async () => {
    const overCapRuntime = 9 * 60 * 1000 + 1; // 540001 ms = 540 seconds
    let capturedBody: string | undefined;

    const postImpl = vi.fn().mockImplementation(async (opts: PostReviewerCommentsOptions) => {
      capturedBody = opts.verdictBodyOverride;
      return { next: "posted", postedReviewId: 1 };
    });
    const applyImpl = vi.fn().mockResolvedValue({ next: "applied", labelsApplied: [] });

    await recordAgentInvoke({
      sessionUlid: "SESSION-BODY-CHECK",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, overCapRuntime),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody).toContain("## Reviewer exceeded 8-minute hard cap");
    expect(capturedBody).toContain("540 seconds");
  });

  it("(c4) story manifest under .crew/state/review/ is unchanged before and after", async () => {
    // Create a fake manifest to verify it's not touched
    const manifestDir = path.join(tmpRoot, ".crew", "state", "review");
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, "bmad:4.12.yaml");
    const manifestContent = "ref: bmad:4.12\nstatus: review\n";
    await atomicWriteFile(manifestPath, manifestContent);

    const postImpl = vi.fn().mockResolvedValue({ next: "posted", postedReviewId: 1 });
    const applyImpl = vi.fn().mockResolvedValue({ next: "applied", labelsApplied: [] });

    await recordAgentInvoke({
      sessionUlid: "SESSION-MANIFEST-CHECK",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, REVIEWER_HARD_CAP_MS + 1),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    // Manifest should be unchanged
    const afterContent = await fs.readFile(manifestPath, "utf8");
    expect(afterContent).toBe(manifestContent);
  });

  it("(c5) applyReviewerLabels is called with verdictOverride: 'reviewer-failure'", async () => {
    const applyImpl = vi.fn().mockResolvedValue({ next: "applied", labelsApplied: ["reviewed-by-agent", "needs-human"] });
    const postImpl = vi.fn().mockResolvedValue({ next: "posted", postedReviewId: 1 });

    await recordAgentInvoke({
      sessionUlid: "SESSION-APPLY-CHECK",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, REVIEWER_HARD_CAP_MS + 1),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    expect(applyImpl).toHaveBeenCalledOnce();
    const callOpts = applyImpl.mock.calls[0]![0] as ApplyReviewerLabelsOptions;
    expect(callOpts.verdictOverride).toBe("reviewer-failure");
  });

  it("(c6) best-effort: when postReviewerComments raises, JSONL has agent.invoke but no reviewer.verdict, returns timed-out without throwing", async () => {
    const postImpl = vi.fn().mockRejectedValue(new Error("gh network failure"));
    const applyImpl = vi.fn().mockResolvedValue({ next: "applied", labelsApplied: [] });

    const result = await recordAgentInvoke({
      sessionUlid: "SESSION-POST-FAIL",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, REVIEWER_HARD_CAP_MS + 1),
      targetRepoRoot: tmpRoot,
      postReviewerCommentsImpl: postImpl as unknown as (opts: PostReviewerCommentsOptions) => Promise<{ next: string }>,
      applyReviewerLabelsImpl: applyImpl as unknown as (opts: ApplyReviewerLabelsOptions) => Promise<{ next: string; labelsApplied?: string[] }>,
      nowImpl,
    });

    // Should NOT throw
    expect(result.kind).toBe("reviewer-timed-out");
    if (result.kind === "reviewer-timed-out") {
      expect(result.substitutedCommentUrl).toBe("");
    }

    // JSONL has agent.invoke but postImpl raised before emitting reviewer.verdict
    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const events = parseAllEvents(lines);
    const agentInvoke = events.filter(e => e.type === "agent.invoke");
    const reviewerVerdict = events.filter(e => e.type === "reviewer.verdict");
    expect(agentInvoke).toHaveLength(1);
    expect(reviewerVerdict).toHaveLength(0);
  });

  it("does NOT trigger cap for exactly REVIEWER_HARD_CAP_MS (must be strictly greater)", async () => {
    const result = await recordAgentInvoke({
      sessionUlid: "SESSION-EXACT-CAP",
      agent: "generalist-reviewer",
      startedAt: T0,
      completedAt: msAfter(T0_MS, REVIEWER_HARD_CAP_MS),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });
    expect(result.kind).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// AC5(d) / 5e: 30-min dev budget
// ---------------------------------------------------------------------------

describe("(5e) 30-min dev budget", () => {
  it("(d1) first two 10-min calls return ok; third (cumulative 30 min) returns dev-budget-exceeded", async () => {
    const storyId = "bmad:1.2";
    const tenMin = 10 * 60 * 1000;

    // Build a shared JSONL accumulator to simulate the real read-write cycle
    let accumulatedJsonl = "";

    const readJsonl = vi.fn().mockImplementation(async () => accumulatedJsonl);
    const logImpl = vi.fn().mockImplementation(async (opts: LogTelemetryEventOpts) => {
      // Simulate appending to JSONL
      const stamped = { ...opts.event, ts: FIXED_NOW.toISOString() };
      accumulatedJsonl += JSON.stringify(stamped) + "\n";
    });

    const call = (sessionUlid: string) =>
      recordAgentInvoke({
        sessionUlid,
        agent: "generalist-dev",
        storyId,
        startedAt: T0,
        completedAt: msAfter(T0_MS, tenMin),
        targetRepoRoot: tmpRoot,
        nowImpl,
        readCurrentMonthJsonlImpl: readJsonl,
        logTelemetryEventImpl: logImpl,
      });

    const r1 = await call("SES-1");
    expect(r1.kind).toBe("ok");

    const r2 = await call("SES-2");
    expect(r2.kind).toBe("ok");

    const r3 = await call("SES-3");
    expect(r3.kind).toBe("dev-budget-exceeded");
    if (r3.kind === "dev-budget-exceeded") {
      expect(r3.cumulativeRuntimeMs).toBe(DEV_BUDGET_MS);
      expect(r3.budgetMs).toBe(DEV_BUDGET_MS);
    }

    // Count emitted events
    const emittedEvents = accumulatedJsonl
      .split("\n")
      .filter(l => l.trim())
      .map(l => JSON.parse(l));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentInvokeEvents = emittedEvents.filter((e: any) => e.type === "agent.invoke");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const budgetEvents = emittedEvents.filter((e: any) => e.type === "dev.budget_exceeded");
    expect(agentInvokeEvents).toHaveLength(3);
    expect(budgetEvents).toHaveLength(1);
  });

  it("(d2) fourth call after budget exceeded returns ok (only first crossing triggers)", async () => {
    const storyId = "bmad:1.2";
    const tenMin = 10 * 60 * 1000;

    let accumulatedJsonl = "";
    const readJsonl = vi.fn().mockImplementation(async () => accumulatedJsonl);
    const logImpl = vi.fn().mockImplementation(async (opts: LogTelemetryEventOpts) => {
      const stamped = { ...opts.event, ts: FIXED_NOW.toISOString() };
      accumulatedJsonl += JSON.stringify(stamped) + "\n";
    });

    const call = (sessionUlid: string) =>
      recordAgentInvoke({
        sessionUlid,
        agent: "generalist-dev",
        storyId,
        startedAt: T0,
        completedAt: msAfter(T0_MS, tenMin),
        targetRepoRoot: tmpRoot,
        nowImpl,
        readCurrentMonthJsonlImpl: readJsonl,
        logTelemetryEventImpl: logImpl,
      });

    await call("SES-1");
    await call("SES-2");
    await call("SES-3"); // first crossing → dev-budget-exceeded

    const r4 = await call("SES-4");
    expect(r4.kind).toBe("ok");

    // Still only one dev.budget_exceeded event
    const emittedEvents = accumulatedJsonl
      .split("\n")
      .filter(l => l.trim())
      .map(l => JSON.parse(l));
    const budgetEvents = emittedEvents.filter((e: { type: string }) => e.type === "dev.budget_exceeded");
    expect(budgetEvents).toHaveLength(1);
  });

  it("(d3) generalist-dev WITHOUT storyId: no dev.budget_exceeded even if runtime > 30 min", async () => {
    const overBudget = DEV_BUDGET_MS + 1;

    const result = await recordAgentInvoke({
      sessionUlid: "SES-NO-STORYID",
      agent: "generalist-dev",
      // No storyId
      startedAt: T0,
      completedAt: msAfter(T0_MS, overBudget),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    expect(result.kind).toBe("ok");

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const events = parseAllEvents(lines);
    expect(events.filter((e: { type: string }) => e.type === "dev.budget_exceeded")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC5(f): Error and edge cases
// ---------------------------------------------------------------------------

describe("(5f) error and edge cases", () => {
  it("throws RuntimeBoundsInvalidError when completedAt < startedAt; no events written", async () => {
    await expect(
      recordAgentInvoke({
        sessionUlid: "SES-NEG",
        agent: "generalist-dev",
        startedAt: msAfter(T0_MS, 60_000), // later
        completedAt: T0,                    // earlier
        targetRepoRoot: tmpRoot,
        nowImpl,
      }),
    ).rejects.toThrow(RuntimeBoundsInvalidError);

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(0);
  });

  it("throws RuntimeBoundsInvalidError on malformed startedAt; no events written", async () => {
    await expect(
      recordAgentInvoke({
        sessionUlid: "SES-BAD-START",
        agent: "generalist-dev",
        startedAt: "not-a-timestamp",
        completedAt: T0,
        targetRepoRoot: tmpRoot,
        nowImpl,
      }),
    ).rejects.toThrow(RuntimeBoundsInvalidError);

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(0);
  });

  it("throws RuntimeBoundsInvalidError on malformed completedAt; no events written", async () => {
    await expect(
      recordAgentInvoke({
        sessionUlid: "SES-BAD-END",
        agent: "generalist-dev",
        startedAt: T0,
        completedAt: "bad-ts",
        targetRepoRoot: tmpRoot,
        nowImpl,
      }),
    ).rejects.toThrow(RuntimeBoundsInvalidError);

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(0);
  });

  it("matches error class name for RuntimeBoundsInvalidError", async () => {
    await expect(
      recordAgentInvoke({
        sessionUlid: "SES-MATCH",
        agent: "pm",
        startedAt: msAfter(T0_MS, 1000),
        completedAt: T0,
        targetRepoRoot: tmpRoot,
        nowImpl,
      }),
    ).rejects.toMatchObject({ name: "RuntimeBoundsInvalidError" });
  });

  it("non-dev/non-reviewer role: writes agent.invoke, no cap/budget events", async () => {
    const result = await recordAgentInvoke({
      sessionUlid: "SES-PM",
      agent: "pm",
      storyId: "bmad:1.1",
      startedAt: T0,
      completedAt: msAfter(T0_MS, 5 * 60 * 1000),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });
    expect(result.kind).toBe("ok");

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event.type).toBe("agent.invoke");
    expect(event.agent).toBe("pm");
  });

  it("reviewer under cap: returns ok, writes only agent.invoke", async () => {
    const underCap = REVIEWER_HARD_CAP_MS - 1;
    const result = await recordAgentInvoke({
      sessionUlid: "SES-REVIEWER-OK",
      agent: "generalist-reviewer",
      storyId: "bmad:4.12",
      startedAt: T0,
      completedAt: msAfter(T0_MS, underCap),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });
    expect(result.kind).toBe("ok");

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).type).toBe("agent.invoke");
  });
});

// ---------------------------------------------------------------------------
// AC5(g): Round-trip JSONL parseability
// ---------------------------------------------------------------------------

describe("(5g) round-trip JSONL parseability", () => {
  it("all written events parse successfully with TelemetryEventSchema.safeParse", async () => {
    // Write several events: agent.invoke for dev and pm roles
    await recordAgentInvoke({
      sessionUlid: "SES-RT-1",
      agent: "generalist-dev",
      storyId: "bmad:1.2",
      startedAt: T0,
      completedAt: msAfter(T0_MS, 60_000),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    await recordAgentInvoke({
      sessionUlid: "SES-RT-2",
      agent: "pm",
      startedAt: T0,
      completedAt: msAfter(T0_MS, 30_000),
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    for (const line of lines) {
      const parsed = TelemetryEventSchema.safeParse(JSON.parse(line));
      expect(parsed.success, `Line failed schema: ${line}`).toBe(true);
    }
  });
});
