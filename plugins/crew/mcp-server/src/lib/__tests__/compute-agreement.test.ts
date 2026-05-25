/**
 * Integration tests for `lib/compute-agreement.ts` (Story 4.10 AC4).
 *
 * Each test seeds a tmpdir with `.crew/telemetry/<YYYY-MM>.jsonl`
 * files, calls `computeAgreement`, and asserts on the return value.
 * No mocking of `fs`; no clock mocking.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAgreement } from "../compute-agreement.js";
import { atomicWriteFile } from "../managed-fs.js";

type Verdict = "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED";
type EventualAction =
  | "merged"
  | "closed-without-merge"
  | "superseded-by-rework"
  | null;

interface VerdictEventOpts {
  verdict: Verdict;
  eventualAction: EventualAction;
  prNumber?: number;
  ts?: string;
}

function verdictEvent(opts: VerdictEventOpts): Record<string, unknown> {
  return {
    ts: opts.ts ?? "2026-05-25T12:00:00.000Z",
    session_id: "01KSEDYC9938DJ8VCA91C0YX43",
    agent: "generalist-reviewer",
    story_id: "bmad:test",
    type: "reviewer.verdict",
    data: {
      pr_number: opts.prNumber ?? 1,
      verdict: opts.verdict,
      standards_version: "1.0.0",
      plugin_version: "0.4.10",
      eventual_merge_action: opts.eventualAction,
    },
  };
}

async function writeJsonl(
  targetRepoRoot: string,
  month: string,
  events: Array<Record<string, unknown> | string>,
): Promise<void> {
  const dir = path.join(targetRepoRoot, ".crew", "telemetry");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${month}.jsonl`);
  const body =
    events
      .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
      .join("\n") + "\n";
  await atomicWriteFile(filePath, body);
}

let targetRepoRoot: string;

beforeEach(async () => {
  targetRepoRoot = path.join(
    os.tmpdir(),
    `crew-compute-agreement-${crypto.randomUUID()}`,
  );
  await fs.mkdir(targetRepoRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(targetRepoRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC4c — fully-resolved window
// ---------------------------------------------------------------------------
describe("(a) fully-resolved window", () => {
  it("returns ratio === 0.8 for 40 agreeing + 10 disagreeing in a window of 50", async () => {
    const events: Array<Record<string, unknown>> = [];
    // 40 agreeing: 20× (READY FOR MERGE / merged) + 20× (NEEDS CHANGES / closed-without-merge).
    for (let i = 0; i < 20; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    for (let i = 0; i < 20; i++) {
      events.push(
        verdictEvent({
          verdict: "NEEDS CHANGES",
          eventualAction: "closed-without-merge",
          prNumber: 100 + i,
        }),
      );
    }
    // 10 disagreeing: 5× (READY FOR MERGE / closed-without-merge) + 5× (NEEDS CHANGES / merged).
    for (let i = 0; i < 5; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "closed-without-merge",
          prNumber: 200 + i,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      events.push(
        verdictEvent({
          verdict: "NEEDS CHANGES",
          eventualAction: "merged",
          prNumber: 300 + i,
        }),
      );
    }

    await writeJsonl(targetRepoRoot, "2026-05", events);

    const result = await computeAgreement({ targetRepoRoot });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.ratio).toBe(0.8);
    expect(result.agreementCount).toBe(40);
    expect(result.windowSize).toBe(50);
    expect(
      result.distribution.READY_FOR_MERGE +
        result.distribution.NEEDS_CHANGES +
        result.distribution.BLOCKED,
    ).toBe(50);
    expect(result.distribution.READY_FOR_MERGE).toBe(25);
    expect(result.distribution.NEEDS_CHANGES).toBe(25);
    expect(result.distribution.BLOCKED).toBe(0);
    expect(result.malformedLines).toBe(0);
    expect(result.malformedFiles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC4d — partially-resolved window
// ---------------------------------------------------------------------------
describe("(b) partially-resolved window", () => {
  it("returns null when 45 resolved < default 50; returns metric with windowSize 40 when N=40", async () => {
    const events: Array<Record<string, unknown>> = [];
    // 45 resolved-agreeing events.
    for (let i = 0; i < 45; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    // 15 unresolved events, interleaved at the end.
    for (let i = 0; i < 15; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: null,
          prNumber: 500 + i,
        }),
      );
    }
    await writeJsonl(targetRepoRoot, "2026-05", events);

    const defaultResult = await computeAgreement({ targetRepoRoot });
    expect(defaultResult).toBeNull();

    const result = await computeAgreement({
      targetRepoRoot,
      lastNVerdicts: 40,
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.windowSize).toBe(40);
    // All 45 resolved events agree → 40 of them agree.
    expect(result.agreementCount).toBe(40);
    expect(result.ratio).toBe(1);
    expect(result.distribution.READY_FOR_MERGE).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// AC4e — empty log
// ---------------------------------------------------------------------------
describe("(c) empty log", () => {
  it("returns null when .crew/telemetry/ directory is absent", async () => {
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).toBeNull();
  });

  it("returns null when directory present but no *.jsonl files", async () => {
    await fs.mkdir(path.join(targetRepoRoot, ".crew", "telemetry"), {
      recursive: true,
    });
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).toBeNull();
  });

  it("returns null when JSONL files present but contain no reviewer.verdict events", async () => {
    const agentInvokeEvent = {
      ts: "2026-05-25T12:00:00.000Z",
      session_id: "01KSEDYC9938DJ8VCA91C0YX43",
      agent: "generalist-dev",
      type: "agent.invoke",
      data: { runtime_ms: 42 },
    };
    await writeJsonl(targetRepoRoot, "2026-05", [agentInvokeEvent]);
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC4f — all-unresolved
// ---------------------------------------------------------------------------
describe("all-unresolved", () => {
  it("returns null when 50 events all have eventual_merge_action: null", async () => {
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: null,
          prNumber: i + 1,
        }),
      );
    }
    await writeJsonl(targetRepoRoot, "2026-05", events);
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC4g — cross-file window assembly
// ---------------------------------------------------------------------------
describe("cross-file window assembly", () => {
  it("spans two month-bucket files in lexicographic order, excluding the 5 oldest", async () => {
    // 25 events in April; verdicts are NEEDS CHANGES with merged → all DISAGREE.
    const aprEvents: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 25; i++) {
      aprEvents.push(
        verdictEvent({
          verdict: "NEEDS CHANGES",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    // 30 events in May; verdicts are READY FOR MERGE with merged → all AGREE.
    const mayEvents: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 30; i++) {
      mayEvents.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: 100 + i,
        }),
      );
    }
    await writeJsonl(targetRepoRoot, "2026-04", aprEvents);
    await writeJsonl(targetRepoRoot, "2026-05", mayEvents);

    const result = await computeAgreement({ targetRepoRoot });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.windowSize).toBe(50);
    // The 5 oldest (from 2026-04) are excluded. The window has 20 from
    // April (NEEDS CHANGES + merged → DISAGREE) and 30 from May
    // (READY FOR MERGE + merged → AGREE). So agreementCount === 30.
    expect(result.agreementCount).toBe(30);
    expect(result.ratio).toBe(0.6);
    expect(result.distribution.NEEDS_CHANGES).toBe(20);
    expect(result.distribution.READY_FOR_MERGE).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// AC4h — agreement matrix coverage (one test per row)
// ---------------------------------------------------------------------------
describe("agreement matrix coverage", () => {
  const matrix: Array<{
    verdict: Verdict;
    eventualAction: Exclude<EventualAction, null>;
    expectedAgrees: boolean;
  }> = [
    { verdict: "READY FOR MERGE", eventualAction: "merged", expectedAgrees: true },
    { verdict: "READY FOR MERGE", eventualAction: "closed-without-merge", expectedAgrees: false },
    { verdict: "READY FOR MERGE", eventualAction: "superseded-by-rework", expectedAgrees: false },
    { verdict: "NEEDS CHANGES", eventualAction: "merged", expectedAgrees: false },
    { verdict: "NEEDS CHANGES", eventualAction: "closed-without-merge", expectedAgrees: true },
    { verdict: "NEEDS CHANGES", eventualAction: "superseded-by-rework", expectedAgrees: true },
    { verdict: "BLOCKED", eventualAction: "merged", expectedAgrees: false },
    { verdict: "BLOCKED", eventualAction: "closed-without-merge", expectedAgrees: true },
    { verdict: "BLOCKED", eventualAction: "superseded-by-rework", expectedAgrees: true },
  ];

  for (const row of matrix) {
    it(`(${row.verdict}, ${row.eventualAction}) ${row.expectedAgrees ? "agrees" : "disagrees"}`, async () => {
      // 49 known-agreeing fillers + 1 row-under-test = 50 resolved events.
      const events: Array<Record<string, unknown>> = [];
      // The probe event goes FIRST so the rest of the window are pure
      // fillers; trailing slice of 50 keeps every event in the window.
      events.push(
        verdictEvent({
          verdict: row.verdict,
          eventualAction: row.eventualAction,
          prNumber: 1,
        }),
      );
      for (let i = 0; i < 49; i++) {
        events.push(
          verdictEvent({
            verdict: "READY FOR MERGE",
            eventualAction: "merged",
            prNumber: 100 + i,
          }),
        );
      }
      await writeJsonl(targetRepoRoot, "2026-05", events);
      const result = await computeAgreement({ targetRepoRoot });
      expect(result).not.toBeNull();
      if (result === null) return;
      const expectedAgreement = 49 + (row.expectedAgrees ? 1 : 0);
      expect(result.agreementCount).toBe(expectedAgreement);
    });
  }
});

// ---------------------------------------------------------------------------
// AC4i — malformed-line tolerance
// ---------------------------------------------------------------------------
describe("malformed-line tolerance", () => {
  it("counts malformed lines but still returns a metric over valid events", async () => {
    const events: Array<Record<string, unknown> | string> = [];
    for (let i = 0; i < 50; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    // 1 line of invalid JSON.
    events.push("not json {{{");
    // 1 line of valid JSON but unknown discriminator value.
    events.push(
      JSON.stringify({
        ts: "2026-05-25T12:00:00.000Z",
        session_id: "01KSEDYC9938DJ8VCA91C0YX43",
        agent: "generalist-dev",
        type: "compute.agreement",
        data: {},
      }),
    );
    await writeJsonl(targetRepoRoot, "2026-05", events);

    const result = await computeAgreement({ targetRepoRoot });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.ratio).toBe(1);
    expect(result.agreementCount).toBe(50);
    expect(result.windowSize).toBe(50);
    expect(result.malformedLines).toBe(2);
    expect(result.malformedFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC4j — distribution sum invariant
// ---------------------------------------------------------------------------
describe("distribution sum invariant", () => {
  it("distribution sums to windowSize across a varied verdict mix", async () => {
    const events: Array<Record<string, unknown>> = [];
    // 20 READY_FOR_MERGE / merged (agree)
    for (let i = 0; i < 20; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    // 15 NEEDS_CHANGES / closed-without-merge (agree)
    for (let i = 0; i < 15; i++) {
      events.push(
        verdictEvent({
          verdict: "NEEDS CHANGES",
          eventualAction: "closed-without-merge",
          prNumber: 100 + i,
        }),
      );
    }
    // 15 BLOCKED / superseded-by-rework (agree)
    for (let i = 0; i < 15; i++) {
      events.push(
        verdictEvent({
          verdict: "BLOCKED",
          eventualAction: "superseded-by-rework",
          prNumber: 200 + i,
        }),
      );
    }
    await writeJsonl(targetRepoRoot, "2026-05", events);
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).not.toBeNull();
    if (result === null) return;
    const sum =
      result.distribution.READY_FOR_MERGE +
      result.distribution.NEEDS_CHANGES +
      result.distribution.BLOCKED;
    expect(sum).toBe(result.windowSize);
    expect(result.distribution.READY_FOR_MERGE).toBe(20);
    expect(result.distribution.NEEDS_CHANGES).toBe(15);
    expect(result.distribution.BLOCKED).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// AC3d — most-recent event is unresolved
// ---------------------------------------------------------------------------
describe("unresolved-event exclusion", () => {
  it("excludes a trailing unresolved event entirely; windows the prior 50 resolved", async () => {
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50; i++) {
      events.push(
        verdictEvent({
          verdict: "READY FOR MERGE",
          eventualAction: "merged",
          prNumber: i + 1,
        }),
      );
    }
    // Trailing unresolved event.
    events.push(
      verdictEvent({
        verdict: "BLOCKED",
        eventualAction: null,
        prNumber: 999,
      }),
    );
    await writeJsonl(targetRepoRoot, "2026-05", events);
    const result = await computeAgreement({ targetRepoRoot });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.windowSize).toBe(50);
    expect(result.distribution.BLOCKED).toBe(0);
    expect(result.distribution.READY_FOR_MERGE).toBe(50);
  });
});
