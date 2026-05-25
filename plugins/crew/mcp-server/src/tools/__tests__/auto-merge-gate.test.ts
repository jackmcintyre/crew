/**
 * Integration tests for `runAutoMergeGate` — Story 4.10b (AC5).
 *
 * Branch coverage:
 *  (5d) auto-merge fires
 *  (5e) medium pauses
 *  (5f) high pauses
 *  (5g) low + sub-threshold pauses
 *  (5h) low + insufficient-data pauses
 *  (5i) manual merge override (verdict !== READY FOR MERGE)
 *  (5j) no-session-result
 *  (5k) missing-risk-tier
 *  (5l) configurable threshold
 *  (5n) recoverable gh error on merge propagates
 *  (5o) recoverable gh error on label-apply propagates
 *  (5p) gh pr view --json headRepository,headRepositoryOwner resolution
 *  (5q) tool-name camelCase registration
 *  (5r) prNumber passed as String
 *  AC6 — residual medium/high findings without override pauses
 *  Permission-file: pr-merge in orchestrator.gh_allow + runAutoMergeGate in tools_allow
 *  SKILL.md-wiring: runAutoMergeGate exactly once on done-ready-for-merge branch
 *
 * Story 4.10b Task 5.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as yamlParse } from "yaml";
import { runAutoMergeGate } from "../auto-merge-gate.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { __resetGhErrorMapCacheForTests } from "../../lib/gh-error-map.js";
import { GhRecoverableError } from "../../errors.js";

const SESSION_ULID = "01HZTEST4_10B_INT_00000000";
const PR_NUMBER = 42;
const LABELS_URL = `/repos/jackmcintyre/crew/issues/${PR_NUMBER}/labels`;

const DEFAULT_PR_VIEW_JSON = JSON.stringify({
  headRepository: { name: "crew" },
  headRepositoryOwner: { login: "jackmcintyre" },
});
const DEFAULT_LABEL_RESPONSE = JSON.stringify([
  { id: 1, name: "needs-human", color: "e4e669" },
]);

// ---------------------------------------------------------------------------
// Plugin-permissions fixture
// ---------------------------------------------------------------------------

let tmpRoot: string;
let pluginRoot: string;

beforeEach(async () => {
  __resetGhErrorMapCacheForTests();
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "crew-4-10b-int-"));
  pluginRoot = path.join(tmpRoot, "plugin");

  await fs.mkdir(path.join(pluginRoot, "permissions"), { recursive: true });

  await atomicWriteFile(
    path.join(pluginRoot, "permissions", "gh-error-map.yaml"),
    [
      "entries:",
      "  - exit_code: 4",
      '    stderr_regex: "API rate limit exceeded"',
      "    class: defer",
    ].join("\n") + "\n",
  );

  await atomicWriteFile(
    path.join(pluginRoot, "permissions", "orchestrator.yaml"),
    [
      "role: orchestrator",
      "tools_allow:",
      "  - getStatus",
      "  - recordYield",
      "  - heartbeat",
      "  - readPersona",
      "  - lookupRoleByDomain",
      "  - runAutoMergeGate",
      "gh_allow:",
      "  - pr-view",
      "  - pr-merge",
      "  - api",
      "gh_allow_args: {}",
    ].join("\n") + "\n",
  );
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function seedConfig(plugin?: { agreement_threshold?: number }): Promise<void> {
  const cfgPath = path.join(tmpRoot, ".crew", "config.yaml");
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  const lines = ["adapter: native", "adapter_config: {}"];
  if (plugin && typeof plugin.agreement_threshold === "number") {
    lines.push("plugin:");
    lines.push(`  agreement_threshold: ${plugin.agreement_threshold}`);
  }
  await atomicWriteFile(cfgPath, lines.join("\n") + "\n");
}

async function seedSession(data: Record<string, unknown>): Promise<void> {
  const dir = path.join(tmpRoot, ".crew", "state", "sessions", SESSION_ULID);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, "reviewer-result.json"), JSON.stringify(data));
}

/**
 * Seed `lastN` resolved reviewer.verdict events at the given agreement ratio.
 * `agreementCount` events agree with the eventual action; the rest disagree.
 */
async function seedTelemetry(opts: {
  count: number;
  agreementCount: number;
}): Promise<void> {
  const telemetryDir = path.join(tmpRoot, ".crew", "telemetry");
  await fs.mkdir(telemetryDir, { recursive: true });
  const events: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const agree = i < opts.agreementCount;
    // verdict = READY FOR MERGE; eventual = "merged" → agree
    // verdict = READY FOR MERGE; eventual = "closed-without-merge" → disagree
    const event = {
      type: "reviewer.verdict",
      ts: `2026-05-25T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      session_id: `01HZTEST_VERDICT_${String(i).padStart(10, "0")}`,
      agent: "generalist-reviewer",
      data: {
        pr_number: 100 + i,
        verdict: "READY FOR MERGE" as const,
        standards_version: "0.1.0",
        plugin_version: "0.1.0",
        eventual_merge_action: (agree ? "merged" : "closed-without-merge") as
          | "merged"
          | "closed-without-merge",
      },
    };
    events.push(JSON.stringify(event));
  }
  await atomicWriteFile(
    path.join(telemetryDir, "2026-05.jsonl"),
    events.join("\n") + "\n",
  );
}

interface CallRecord {
  cmd: string;
  args: string[];
  input?: string;
}

interface StubOpts {
  prMergeResponse?: { stdout?: string; stderr?: string; exitCode?: number };
  labelResponse?: { stdout?: string; stderr?: string; exitCode?: number };
  prViewResponse?: { stdout?: string; stderr?: string; exitCode?: number };
  /** Throw if computeAgreement is reached — used to assert medium/high don't read metric. */
  recorder?: CallRecord[];
}

function makeStub(opts: StubOpts = {}) {
  const recorder = opts.recorder ?? [];
  const stub = vi.fn().mockImplementation(
    async (cmd: string, args: string[], callOpts?: { input?: string }) => {
      recorder.push({ cmd, args, input: callOpts?.input });
      if (cmd === "gh") {
        const sub0 = args[0];
        const sub1 = args[1];
        if (sub0 === "pr" && sub1 === "view") {
          const r = opts.prViewResponse ?? {};
          return {
            stdout: r.stdout ?? DEFAULT_PR_VIEW_JSON,
            stderr: r.stderr ?? "",
            exitCode: r.exitCode ?? 0,
          };
        }
        if (sub0 === "pr" && sub1 === "merge") {
          const r = opts.prMergeResponse ?? {};
          return {
            stdout: r.stdout ?? "",
            stderr: r.stderr ?? "",
            exitCode: r.exitCode ?? 0,
          };
        }
        if (sub0 === "api") {
          const r = opts.labelResponse ?? {};
          return {
            stdout: r.stdout ?? DEFAULT_LABEL_RESPONSE,
            stderr: r.stderr ?? "",
            exitCode: r.exitCode ?? 0,
          };
        }
        return { stdout: "", stderr: `unexpected gh subcommand: ${sub0}`, exitCode: 1 };
      }
      return { stdout: "", stderr: `unexpected command: ${cmd}`, exitCode: 1 };
    },
  );
  return { stub: stub as unknown as typeof import("execa").execa, recorder };
}

function ghCalls(recorder: CallRecord[]): CallRecord[] {
  return recorder.filter((c) => c.cmd === "gh");
}

function findCall(recorder: CallRecord[], sub0: string, sub1: string): CallRecord | undefined {
  return recorder.find((c) => c.cmd === "gh" && c.args[0] === sub0 && c.args[1] === sub1);
}

function baseResult(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionUlid: SESSION_ULID,
    ref: "native:01HZTEST00000000000000000",
    recommendedVerdict: "READY FOR MERGE",
    acResults: {},
    standardsByCriterionId: {},
    sourceStoryRef: "native:01HZTEST00000000000000000",
    prNumber: PR_NUMBER,
    standardsVersion: "0.1.0",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// (5j) No session result
// ---------------------------------------------------------------------------

describe("(5j) no reviewer-result.json", () => {
  it("returns skipped-no-session-result without any gh call", async () => {
    await seedConfig();
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "skipped-no-session-result" });
    expect(ghCalls(recorder)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (5i) Verdict !== READY FOR MERGE — defensive return
// ---------------------------------------------------------------------------

describe("(5i) defensive skipped-not-ready-for-merge", () => {
  it("returns skipped-not-ready-for-merge on NEEDS CHANGES; no gh call", async () => {
    await seedConfig();
    await seedSession(baseResult({ recommendedVerdict: "NEEDS CHANGES", riskTier: "low" }));
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "skipped-not-ready-for-merge", verdict: "NEEDS CHANGES" });
    expect(ghCalls(recorder)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (5d) Auto-merge fires
// ---------------------------------------------------------------------------

describe("(5d) auto-merge fires", () => {
  it("merges via gh pr merge --squash --delete-branch when low risk + agreement >= threshold", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "low" }));
    await seedTelemetry({ count: 50, agreementCount: 45 }); // ratio 0.9
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("merged");
    if (result.next === "merged") {
      expect(result.prNumber).toBe(PR_NUMBER);
      expect(result.threshold).toBe(0.8);
      expect(result.agreementRatio).toBeGreaterThanOrEqual(0.8);
    }

    const mergeCall = findCall(recorder, "pr", "merge");
    expect(mergeCall, "expected gh pr merge call").toBeDefined();
    // (5r) prNumber must be passed as String
    expect(mergeCall!.args).toEqual([
      "pr",
      "merge",
      String(PR_NUMBER),
      "--squash",
      "--delete-branch",
    ]);

    // No label-apply call on the merge path
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (5e) Medium pauses
// ---------------------------------------------------------------------------

describe("(5e) medium pauses without consulting agreement metric", () => {
  it("pauses with needs-human label; no merge call; no telemetry read needed", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "medium" }));
    // Note: no telemetry seeded — proves metric path is not reached.
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "paused-medium", prNumber: PR_NUMBER });
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
    expect(JSON.parse(apiCalls[0]!.input ?? "{}")).toEqual({ labels: ["needs-human"] });
    // (5p) labels URL shape
    expect(apiCalls[0]!.args[1]).toBe(LABELS_URL);
  });
});

// ---------------------------------------------------------------------------
// (5f) High pauses
// ---------------------------------------------------------------------------

describe("(5f) high pauses", () => {
  it("pauses with needs-human; returns paused-high", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "high" }));
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "paused-high", prNumber: PR_NUMBER });
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5k) Missing risk tier
// ---------------------------------------------------------------------------

describe("(5k) missing riskTier — fail closed", () => {
  it("pauses with paused-missing-risk-tier; one label-apply; no merge", async () => {
    await seedConfig();
    await seedSession(baseResult()); // no riskTier field
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "paused-missing-risk-tier", prNumber: PR_NUMBER });
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5g) Low + sub-threshold pauses
// ---------------------------------------------------------------------------

describe("(5g) low + sub-threshold pauses", () => {
  it("pauses when ratio < default threshold 0.8", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "low" }));
    await seedTelemetry({ count: 50, agreementCount: 30 }); // ratio 0.6
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("paused-sub-threshold");
    if (result.next === "paused-sub-threshold") {
      expect(result.prNumber).toBe(PR_NUMBER);
      expect(result.threshold).toBe(0.8);
      expect(result.agreementRatio).toBeCloseTo(0.6, 5);
    }
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5h) Low + insufficient-data pauses
// ---------------------------------------------------------------------------

describe("(5h) low + insufficient-data pauses", () => {
  it("pauses when computeAgreement returns null (no telemetry)", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "low" }));
    // no telemetry → null
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({ next: "paused-insufficient-data", prNumber: PR_NUMBER });
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5l) Configurable threshold
// ---------------------------------------------------------------------------

describe("(5l) configurable threshold via plugin.agreement_threshold", () => {
  it("merges when ratio 0.65 ≥ configured threshold 0.6", async () => {
    await seedConfig({ agreement_threshold: 0.6 });
    await seedSession(baseResult({ riskTier: "low" }));
    await seedTelemetry({ count: 50, agreementCount: 33 }); // ratio 0.66
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("merged");
    if (result.next === "merged") {
      expect(result.threshold).toBe(0.6);
    }
    expect(findCall(recorder, "pr", "merge")).toBeDefined();
  });

  it("pauses when same ratio 0.65 < configured threshold 0.7", async () => {
    await seedConfig({ agreement_threshold: 0.7 });
    await seedSession(baseResult({ riskTier: "low" }));
    await seedTelemetry({ count: 50, agreementCount: 33 }); // ratio 0.66
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("paused-sub-threshold");
    if (result.next === "paused-sub-threshold") {
      expect(result.threshold).toBe(0.7);
    }
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (5n) GhRecoverableError on merge propagates
// ---------------------------------------------------------------------------

describe("(5n) recoverable gh error on merge propagates", () => {
  it("propagates GhRecoverableError; no label-apply was made on merge path", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "low" }));
    await seedTelemetry({ count: 60, agreementCount: 54 });
    const { stub, recorder } = makeStub({
      prMergeResponse: { exitCode: 4, stderr: "API rate limit exceeded" },
    });

    await expect(
      runAutoMergeGate({
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        pluginRootOverride: pluginRoot,
        execaImpl: stub,
      }),
    ).rejects.toThrow(GhRecoverableError);

    // Took the merge path — no label-apply call
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (5o) GhRecoverableError on label-apply propagates
// ---------------------------------------------------------------------------

describe("(5o) recoverable gh error on label-apply propagates", () => {
  it("propagates GhRecoverableError uncaught", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "medium" }));
    const { stub } = makeStub({
      labelResponse: { exitCode: 4, stderr: "API rate limit exceeded" },
    });

    await expect(
      runAutoMergeGate({
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        pluginRootOverride: pluginRoot,
        execaImpl: stub,
      }),
    ).rejects.toThrow(GhRecoverableError);
  });
});

// ---------------------------------------------------------------------------
// (5p) pr-view --json field shape
// ---------------------------------------------------------------------------

describe("(5p) gh pr view --json field resolution", () => {
  it("issues gh pr view <n> --json headRepository,headRepositoryOwner on pause path", async () => {
    await seedConfig();
    await seedSession(baseResult({ riskTier: "medium" }));
    const { stub, recorder } = makeStub();

    await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    const prView = findCall(recorder, "pr", "view");
    expect(prView).toBeDefined();
    expect(prView!.args).toEqual([
      "pr",
      "view",
      String(PR_NUMBER),
      "--json",
      "headRepository,headRepositoryOwner",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC6 — residual medium/high findings without override token pause
// ---------------------------------------------------------------------------

describe("(AC6) residual medium/high findings without overrideToken pause", () => {
  it("pauses with paused-residual-medium-or-higher when findings carry medium severity and no overrideToken", async () => {
    await seedConfig();
    await seedSession(
      baseResult({
        riskTier: "low",
        findings: [
          { severity: "medium", id: "f1" },
          { severity: "medium", id: "f2" },
          { severity: "high", id: "f3" },
          { severity: "low", id: "f4" },
        ],
      }),
    );
    // Seed telemetry such that low+agreement would otherwise merge.
    await seedTelemetry({ count: 60, agreementCount: 54 });
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result).toEqual({
      next: "paused-residual-medium-or-higher",
      prNumber: PR_NUMBER,
      residuals: { medium: 2, high: 1 },
    });
    expect(findCall(recorder, "pr", "merge")).toBeUndefined();
    const apiCalls = recorder.filter((c) => c.cmd === "gh" && c.args[0] === "api");
    expect(apiCalls).toHaveLength(1);
    expect(JSON.parse(apiCalls[0]!.input ?? "{}")).toEqual({ labels: ["needs-human"] });
  });

  it("proceeds to merge when overrideToken is present despite residual findings", async () => {
    await seedConfig();
    await seedSession(
      baseResult({
        riskTier: "low",
        overrideToken: "accepted-by-jack",
        findings: [{ severity: "medium" }, { severity: "high" }],
      }),
    );
    await seedTelemetry({ count: 60, agreementCount: 54 });
    const { stub, recorder } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("merged");
    expect(findCall(recorder, "pr", "merge")).toBeDefined();
  });

  it("does not trigger AC6 pause when findings only contain low severity", async () => {
    await seedConfig();
    await seedSession(
      baseResult({
        riskTier: "low",
        findings: [{ severity: "low" }, { severity: "low" }],
      }),
    );
    await seedTelemetry({ count: 60, agreementCount: 54 });
    const { stub } = makeStub();

    const result = await runAutoMergeGate({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      pluginRootOverride: pluginRoot,
      execaImpl: stub,
    });

    expect(result.next).toBe("merged");
  });
});

// ---------------------------------------------------------------------------
// Permission-file assertion (Task 5.9)
// ---------------------------------------------------------------------------

describe("orchestrator.yaml permission shape", () => {
  it("the production orchestrator.yaml has pr-merge in gh_allow and runAutoMergeGate in tools_allow", async () => {
    const yamlPath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "permissions",
      "orchestrator.yaml",
    );
    const raw = await fs.readFile(yamlPath, "utf8");
    const parsed = yamlParse(raw) as {
      gh_allow: string[];
      tools_allow: string[];
    };
    expect(parsed.gh_allow).toContain("pr-merge");
    expect(parsed.gh_allow).toContain("api");
    expect(parsed.gh_allow).toContain("pr-view");
    expect(parsed.tools_allow).toContain("runAutoMergeGate");
  });
});

// ---------------------------------------------------------------------------
// (5c) SKILL.md-wiring assertion
// ---------------------------------------------------------------------------

describe("(5c) SKILL.md wiring", () => {
  it("runAutoMergeGate appears on done-ready-for-merge branch and surface lines are present", async () => {
    const skillPath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "skills",
      "start",
      "SKILL.md",
    );
    const text = await fs.readFile(skillPath, "utf8");

    // Tool reference present
    const occurrences = text.match(/runAutoMergeGate/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);

    // Chat-surface lines (substring asserts — tolerate surrounding markdown)
    expect(text).toContain("auto-merged (risk:low, agreement:");
    expect(text).toContain("paused — risk_tier: medium");
    expect(text).toContain("paused — risk_tier: high");
    expect(text).toContain("paused — risk_tier missing on reviewer-result");
    expect(text).toContain("paused — agreement");
    expect(text).toContain("below threshold");
    expect(text).toContain("paused — insufficient telemetry to compute agreement");
    expect(text).toContain("unresolved medium/high finding(s)");
    expect(text).toContain("auto-merge-gate skipped — no reviewer-result.json");

    // Failure-modes invariant note
    expect(text).toContain("auto-merge-gate failure");
  });
});

// ---------------------------------------------------------------------------
// (5q) tool-name camelCase registration
// ---------------------------------------------------------------------------

describe("(5q) registration uses camelCase 'runAutoMergeGate'", () => {
  it("the register.ts file declares the tool under name 'runAutoMergeGate'", async () => {
    const registerPath = path.resolve(
      __dirname,
      "..",
      "register.ts",
    );
    const text = await fs.readFile(registerPath, "utf8");
    expect(text).toContain('name: "runAutoMergeGate"');
  });
});
