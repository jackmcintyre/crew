/**
 * Integration tests for Story 4.12 — Per-invocation telemetry and runtime
 * soft/hard limits.
 *
 * vitest: agent.invoke event written on dev spawn
 * vitest: reviewer 8-min hard limit substitutes verdict
 * vitest: per-invocation-telemetry
 * vitest: SessionQuotaExhaustedError classified from transcript
 * vitest: PreHandoffSuiteRedError raised when suite is red
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { processDevTranscript } from "../process-dev-transcript.js";
import { postReviewerComments } from "../post-reviewer-comments.js";
import { runDevTerminalAction } from "../run-dev-terminal-action.js";
import { PreHandoffSuiteRedError } from "../../errors.js";

const STORY_REF = "native:01J9P0K2N3MZX0YV4S5RTQ4XYZ";
const SESSION_ULID = "01HZSESSION00000000000099";

const DEV_PERSONA_MD = `---
role: generalist-dev
domain: "feature implementation in a story scope"
model_tier: sonnet
tools_allow:
  - Read
locked_phrases:
  handoff: "Handoff to reviewer — story <story-id> ready for review."
  yield: "This sits in <role>'s domain — handing off"
  verdict: "**Verdict: <SENTINEL>**"
hired_at: "2026-01-01T00:00:00.000Z"
catalogue_version: "0.1.0"
---

# Generalist Dev

## Domain

Implements stories.

## Mandate

- Implement.

## Out of mandate

- Reviewing.

## Prompt

You are the dev.

## Knowledge

n/a
`;

const REVIEWER_PERSONA_MD = DEV_PERSONA_MD.replace(/generalist-dev/g, "generalist-reviewer").replace(/Generalist Dev/g, "Generalist Reviewer");

let tmpRoot: string;
let manifestPath: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "crew-4-12-telemetry-" + crypto.randomUUID() + "-"),
  );

  await fs.mkdir(path.join(tmpRoot, ".crew", "state", "in-progress"), {
    recursive: true,
  });
  manifestPath = path.join(
    tmpRoot,
    ".crew",
    "state",
    "in-progress",
    `${STORY_REF}.yaml`,
  );
  await atomicWriteFile(
    manifestPath,
    yamlStringify(
      {
        ref: STORY_REF,
        status: "in-progress",
        adapter: "native",
        source_path: `.crew/native-stories/${STORY_REF}.yaml`,
        source_hash: "a".repeat(64),
        depends_on: [],
        acceptance_criteria: [
          { text: "Given x, when y, then z.", kind: "integration" },
        ],
        title: "Test",
        narrative: "N",
        withdrawn: false,
        claimed_by: SESSION_ULID,
      },
      { lineWidth: 0 },
    ),
  );

  await fs.mkdir(path.join(tmpRoot, "team", "generalist-dev"), {
    recursive: true,
  });
  await fs.mkdir(path.join(tmpRoot, "team", "generalist-reviewer"), {
    recursive: true,
  });
  await atomicWriteFile(
    path.join(tmpRoot, "team", "generalist-dev", "PERSONA.md"),
    DEV_PERSONA_MD,
  );
  await atomicWriteFile(
    path.join(tmpRoot, "team", "generalist-reviewer", "PERSONA.md"),
    REVIEWER_PERSONA_MD,
  );
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function readTelemetry(): Promise<Array<Record<string, unknown>>> {
  const dir = path.join(tmpRoot, ".crew", "telemetry");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const file of entries.sort()) {
    const raw = await fs.readFile(path.join(dir, file), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      out.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return out;
}

describe("AC1: agent.invoke event written on dev spawn (per-invocation-telemetry)", () => {
  it("processDevTranscript writes agent.invoke on the blocked-handoff-grammar return path", async () => {
    const result = await processDevTranscript({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      devTranscript: "paraphrased — no locked handoff",
      spawnStartedAt: 1000,
      now: () => 5500,
    });

    expect(result.next).toBe("done-blocked-handoff-grammar");

    const events = await readTelemetry();
    const invokeEvents = events.filter((e) => e.type === "agent.invoke");
    expect(invokeEvents).toHaveLength(1);
    expect(invokeEvents[0]).toMatchObject({
      type: "agent.invoke",
      agent: "generalist-dev",
      story_id: STORY_REF,
      session_id: SESSION_ULID,
      data: { runtime_ms: 4500 },
    });
  });
});

describe("AC6: SessionQuotaExhaustedError classified from transcript", () => {
  it("processDevTranscript routes a quota-exhausted transcript to the session-quota-exhausted branch", async () => {
    const result = await processDevTranscript({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      ref: STORY_REF,
      devTranscript:
        "Some output\nYou've hit your session limit — please retry later.",
    });

    expect(result.next).toBe("done-blocked-session-quota-exhausted");
    expect(
      result.chatLog.some((l) =>
        l.includes("session quota exhausted"),
      ),
    ).toBe(true);
    expect(
      result.chatLog.some((l) =>
        l.includes("paused"),
      ),
    ).toBe(true);

    // Manifest stamped blocked_by: session-quota-exhausted
    const raw = await fs.readFile(manifestPath, "utf8");
    expect(raw).toContain("blocked_by: session-quota-exhausted");
  });
});

describe("AC3: reviewer 8-min hard limit substitutes verdict", () => {
  it("when spawnStartedAt is more than 8 minutes ago, postReviewerComments returns reviewer-timeout and writes agent.invoke", async () => {
    // Seed reviewer-result.json so postReviewerComments runs the timeout pre-check.
    const sessionDir = path.join(
      tmpRoot,
      ".crew",
      "state",
      "sessions",
      SESSION_ULID,
    );
    await fs.mkdir(sessionDir, { recursive: true });
    await atomicWriteFile(
      path.join(sessionDir, "reviewer-result.json"),
      JSON.stringify({
        sessionUlid: SESSION_ULID,
        ref: STORY_REF,
        recommendedVerdict: "NEEDS CHANGES",
        acResults: {},
        standardsByCriterionId: {},
        sourceStoryRef: STORY_REF,
        prNumber: 99,
        standardsVersion: "1.0.0",
      }),
    );

    // Stub execaImpl so we can intercept the gh calls in the timeout branch.
    const stubExeca = ((cmd: string, args: readonly string[] | undefined) => {
      const a = args ?? [];
      if (a[0] === "pr" && a[1] === "view") {
        return Promise.resolve({
          stdout: JSON.stringify({
            headRepository: { name: "test-repo" },
            headRepositoryOwner: { login: "test-org" },
          }),
          stderr: "",
          exitCode: 0,
        });
      }
      // GET reviews returns empty array; POST returns id.
      if (a.includes("GET")) {
        return Promise.resolve({
          stdout: JSON.stringify([]),
          stderr: "",
          exitCode: 0,
        });
      }
      if (a.includes("POST") || a.includes("PATCH")) {
        return Promise.resolve({
          stdout: JSON.stringify({ id: 9876 }),
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 });
    }) as unknown as Parameters<typeof postReviewerComments>[0]["execaImpl"];

    const spawnStartedAt = 0;
    const fakeNow = 8 * 60 * 1000 + 1; // 1ms past the 8-min hard limit

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stubExeca,
      pluginVersionOverride: "0.4.12",
      spawnStartedAt,
      now: () => fakeNow,
    });

    expect(result.next).toBe("reviewer-timeout");
    if (result.next !== "reviewer-timeout") return;
    expect(result.elapsedMs).toBe(fakeNow);
    expect(result.postedReviewId).toBe(9876);
    expect(result.verdictLine).toContain("Reviewer timeout");
    expect(result.verdictLine).toContain("8-minute hard limit exceeded");

    // agent.invoke was written for the reviewer even though the verdict was substituted.
    const events = await readTelemetry();
    const invokeEvents = events.filter(
      (e) =>
        e.type === "agent.invoke" && e.agent === "generalist-reviewer",
    );
    expect(invokeEvents).toHaveLength(1);
    // No reviewer.verdict event on the timeout branch.
    expect(events.filter((e) => e.type === "reviewer.verdict")).toHaveLength(0);
  });

  it("when spawnStartedAt is exactly at the 8-min boundary, the timeout branch does NOT fire (strict greater-than)", async () => {
    const sessionDir = path.join(
      tmpRoot,
      ".crew",
      "state",
      "sessions",
      SESSION_ULID,
    );
    await fs.mkdir(sessionDir, { recursive: true });
    // Absent reviewer-result.json — postReviewerComments returns skipped-no-session-result
    // BEFORE the timeout check (the timeout check is after readReviewerResultFile in our impl).
    // So we test the boundary by checking that elapsedMs === REVIEWER_HARD_LIMIT_MS produces normal path.
    await atomicWriteFile(
      path.join(sessionDir, "reviewer-result.json"),
      JSON.stringify({
        sessionUlid: SESSION_ULID,
        ref: STORY_REF,
        recommendedVerdict: "READY FOR MERGE",
        acResults: {},
        standardsByCriterionId: {},
        sourceStoryRef: STORY_REF,
        prNumber: 99,
        standardsVersion: "1.0.0",
      }),
    );

    const stubExeca = ((cmd: string, args: readonly string[] | undefined) => {
      const a = args ?? [];
      if (a[0] === "pr" && a[1] === "view") {
        return Promise.resolve({
          stdout: JSON.stringify({
            headRepository: { name: "r" },
            headRepositoryOwner: { login: "o" },
          }),
          stderr: "",
          exitCode: 0,
        });
      }
      if (a[0] === "pr" && a[1] === "diff") {
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }
      if (a.includes("GET")) {
        return Promise.resolve({
          stdout: JSON.stringify([]),
          stderr: "",
          exitCode: 0,
        });
      }
      if (a.includes("POST") || a.includes("PATCH")) {
        return Promise.resolve({
          stdout: JSON.stringify({ id: 1111 }),
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 });
    }) as unknown as Parameters<typeof postReviewerComments>[0]["execaImpl"];

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stubExeca,
      pluginVersionOverride: "0.4.12",
      spawnStartedAt: 0,
      now: () => 8 * 60 * 1000, // exactly the limit, not over
    });

    expect(result.next).toBe("posted");
  });
});

describe("AC7: PreHandoffSuiteRedError raised when suite is red", () => {
  it("runDevTerminalAction raises PreHandoffSuiteRedError when typecheck exits non-zero", async () => {
    // Stub execa: pnpm typecheck returns non-zero, no further commands run.
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const stubExeca = ((cmd: string, args: readonly string[] | undefined) => {
      calls.push({ cmd, args: args ?? [] });
      if (cmd === "pnpm") {
        return Promise.resolve({
          stdout: "",
          stderr: "typecheck failed: 3 errors",
          exitCode: 1,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }) as unknown as Parameters<typeof runDevTerminalAction>[0]["execaImpl"];

    let caught: unknown = null;
    try {
      await runDevTerminalAction({
        targetRepoRoot: tmpRoot,
        ref: STORY_REF,
        title: "Test story",
        type: "feat",
        body: "body",
        summary: "summary",
        manifestPath,
        sessionUlid: SESSION_ULID,
        execaImpl: stubExeca,
        skipPreHandoffSuite: false,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PreHandoffSuiteRedError);
    if (caught instanceof PreHandoffSuiteRedError) {
      expect(caught.exitCode).toBe(1);
      expect(caught.recoverable).toBe(true);
      expect(caught.failureClass).toBe("pre-handoff-suite-red");
    }
    // Only the typecheck spawn ran; the rest of the pipeline never started.
    expect(calls[0]!.cmd).toBe("pnpm");
  });
});
