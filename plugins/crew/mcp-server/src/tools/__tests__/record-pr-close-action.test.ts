/**
 * Integration tests for `recordPrCloseAction` — Story 4.12 Task 8.2.
 *
 * AC5 coverage:
 *   (b2) merge-action emission (5c)
 *   Extra: verbatim merge_action passthrough (5f)
 *   Extra: round-trip JSONL parseability (5g)
 *
 * Tmpdir convention: `fs.mkdtemp(path.join(os.tmpdir(), "telemetry-"))`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { recordPrCloseAction } from "../record-pr-close-action.js";
import { TelemetryEventSchema } from "../../schemas/telemetry-events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJsonlLines(filePath: string): Promise<string[]> {
  const body = await fs.readFile(filePath, "utf8");
  return body.split("\n").filter((l) => l.trim().length > 0);
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
});

// ---------------------------------------------------------------------------
// (5c)(b2): merge-action emission
// ---------------------------------------------------------------------------

describe("(5c)(b2) reviewer.verdict.merge_action event emission", () => {
  it("writes one merge_action event with correct fields for merged PR", async () => {
    const result = await recordPrCloseAction({
      sessionUlid: "SESSION-CLOSE-001",
      storyId: "bmad:4.12",
      prNumber: 42,
      mergeAction: "merged",
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    expect(result).toEqual({ kind: "ok" });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]!);
    expect(event.type).toBe("reviewer.verdict.merge_action");
    expect(event.session_id).toBe("SESSION-CLOSE-001");
    expect(event.agent).toBe("generalist-reviewer");
    expect(event.story_id).toBe("bmad:4.12");
    expect(event.data.pr_number).toBe(42);
    expect(event.data.merge_action).toBe("merged");
    expect(event.data.resolved_at).toBe(FIXED_NOW.toISOString());
  });

  it("uses explicit resolvedAt when provided", async () => {
    const resolvedAt = "2026-05-26T11:30:00.000Z";
    await recordPrCloseAction({
      sessionUlid: "SESSION-CLOSE-002",
      prNumber: 99,
      mergeAction: "closed-unmerged",
      resolvedAt,
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const event = JSON.parse(lines[0]!);
    expect(event.data.resolved_at).toBe(resolvedAt);
    expect(event.data.merge_action).toBe("closed-unmerged");
  });

  it("emits still-open merge action", async () => {
    await recordPrCloseAction({
      sessionUlid: "SESSION-CLOSE-003",
      prNumber: 7,
      mergeAction: "still-open",
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const event = JSON.parse(lines[0]!);
    expect(event.data.merge_action).toBe("still-open");
  });

  it("omits story_id when not provided", async () => {
    await recordPrCloseAction({
      sessionUlid: "SESSION-CLOSE-NOSTORY",
      prNumber: 5,
      mergeAction: "merged",
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    const event = JSON.parse(lines[0]!);
    expect(event.story_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (5f): verbatim merge_action passthrough
// ---------------------------------------------------------------------------

describe("(5f) verbatim merge_action passthrough", () => {
  it.each(["merged", "closed-unmerged", "still-open"] as const)(
    "writes merge_action='%s' verbatim to JSONL",
    async (mergeAction) => {
      await recordPrCloseAction({
        sessionUlid: `SESSION-PASSTHROUGH-${mergeAction}`,
        prNumber: 1,
        mergeAction,
        targetRepoRoot: tmpRoot,
        nowImpl,
      });

      const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
      const event = JSON.parse(lines[lines.length - 1]!);
      expect(event.data.merge_action).toBe(mergeAction);
    },
  );
});

// ---------------------------------------------------------------------------
// (5g): Round-trip JSONL parseability
// ---------------------------------------------------------------------------

describe("(5g) round-trip JSONL parseability", () => {
  it("all written events parse successfully with TelemetryEventSchema.safeParse", async () => {
    await recordPrCloseAction({
      sessionUlid: "SESSION-RT-CLOSE",
      storyId: "bmad:4.12",
      prNumber: 123,
      mergeAction: "merged",
      targetRepoRoot: tmpRoot,
      nowImpl,
    });

    const lines = await readAllJsonlLines(tmpRoot, FIXED_NOW);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    for (const line of lines) {
      const parsed = TelemetryEventSchema.safeParse(JSON.parse(line));
      expect(parsed.success, `Line failed schema: ${line}`).toBe(true);
    }
  });
});
