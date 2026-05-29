/**
 * Integration tests for `runAutoMergeGate` — Story 4.10b (AC5d–q).
 *
 * Test coverage:
 *   (5d)  (a) Auto-merge fires — low risk, met threshold.
 *   (5e)  (b) Medium pauses.
 *   (5f)  (c) High pauses.
 *   (5g)  (d) Low + sub-threshold pauses.
 *   (5h)  (e) Low + insufficient-data pauses.
 *   (5i)  (f) Manual-merge override (structural SKILL.md check).
 *   (5j)  (g) No-tier pause (legacy manifest).
 *   (5k)  (h) Boundary — ratio exactly equals threshold.
 *   (5l)  (i) SKILL.md content-structure (runAutoMergeGate under done-ready-for-merge).
 *   (5m)  (j) MCP tool registration smoke (runAutoMergeGate in register list, count 31).
 *   (5n)  (k) dryRun: true — decision made but no gh call.
 *   (5o)  (l) GhRecoverableError on pr merge failure.
 *   (5p)  (m) pr-merge denied without permission entry.
 *   (5q)  (n) AutoMergeGateResultSchema round-trip.
 *
 * Strategy: inject `execaImpl` (never vi.mock production modules). The real `gh`
 * wrapper is exercised; only the underlying subprocess is replaced.
 *
 * Story 4.10b Task 2.6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { stringify as yamlStringify } from "yaml";
import { fileURLToPath } from "node:url";
import { runAutoMergeGate, AutoMergeGateResultSchema, } from "../run-auto-merge-gate.js";
import { registerAllTools } from "../register.js";
import { GhSubcommandDeniedError, AutoMergeGateThresholdInvalidError } from "../../errors.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { __resetGhErrorMapCacheForTests } from "../../lib/gh-error-map.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SESSION_ULID = "01HZAUTOGATE0000000000000";
const PR_NUMBER = 55;
const REF = "native:01HZAUTOGATE0000000000000";
// Default repo-view response (matches the crew repo — same as other tests)
const DEFAULT_REPO_VIEW_JSON = JSON.stringify({
    name: "crew",
    owner: { login: "jackmcintyre" },
});
const DEFAULT_LABELS_RESPONSE = JSON.stringify([
    { id: 1, name: "needs-human", color: "e4e669" },
]);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.resolve(HERE, "..", // src/tools/
"..", // src/
"..", // mcp-server/
"..", // plugins/crew/
"..", // plugins/
"..", // repo root (worktree)
"plugins", "crew", "skills", "start", "SKILL.md");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** ISO-8601 UTC timestamp at a given millisecond offset */
function makeTs(offsetMs) {
    return new Date(1_700_000_000_000 + offsetMs).toISOString();
}
/** Create a `reviewer.verdict` event payload */
function makeVerdictEvent(opts) {
    return {
        ts: opts.ts,
        session_id: opts.session_id,
        agent: "generalist-reviewer",
        story_id: "bmad:1-1-example",
        type: "reviewer.verdict",
        data: {
            pr_number: opts.pr_number,
            verdict: opts.verdict,
            standards_version: "1.0.0",
            plugin_version: "1.0.0",
            timed_out: false,
        },
    };
}
/** Create a `reviewer.verdict.merge_action` event payload */
function makeMergeActionEvent(opts) {
    return {
        ts: opts.ts,
        session_id: opts.session_id,
        agent: "generalist-reviewer",
        story_id: "bmad:1-1-example",
        type: "reviewer.verdict.merge_action",
        data: {
            pr_number: opts.pr_number,
            merge_action: opts.merge_action,
            resolved_at: opts.resolved_at ?? opts.ts,
        },
    };
}
/** Write JSONL events to a file */
async function writeJSONL(telemetryDir, filename, events) {
    const lines = events.map((e) => JSON.stringify(e));
    await fs.writeFile(path.join(telemetryDir, filename), lines.join("\n") + "\n");
}
/**
 * Seed N fully-resolved verdict pairs with a target agreement ratio.
 *
 * @param telemetryDir - Directory to write the JSONL file into.
 * @param count - Number of resolved pairs (window size).
 * @param agreedCount - How many pairs should agree (agree = READY + merged OR NEEDS + closed).
 */
async function seedVerdictPairs(telemetryDir, count, agreedCount) {
    const events = [];
    for (let i = 0; i < count; i++) {
        const ts = makeTs(i * 1000);
        const session_id = `gate-sess-${String(i).padStart(4, "0")}`;
        const pr_number = 9000 + i;
        // First `agreedCount` pairs agree; rest disagree
        const agree = i < agreedCount;
        const verdict = agree ? "READY FOR MERGE" : "NEEDS CHANGES";
        const mergeAction = agree ? "merged" : "merged"; // disagree for NEEDS CHANGES + merged
        // For agreement: READY FOR MERGE + merged = agree; NEEDS CHANGES + merged = disagree
        const v = makeVerdictEvent({ ts, session_id, pr_number, verdict });
        const ma = makeMergeActionEvent({ ts, session_id, pr_number, merge_action: mergeAction, resolved_at: ts });
        events.push(v, ma);
    }
    await fs.mkdir(telemetryDir, { recursive: true });
    await writeJSONL(telemetryDir, "gate-verdicts.jsonl", events);
}
/**
 * Seed N pairs with a specific READY FOR MERGE + merged ratio.
 * All pairs use READY FOR MERGE verdicts; agreedCount are merged, rest are closed-unmerged.
 */
async function seedRatioVerdicts(telemetryDir, count, mergedCount) {
    const events = [];
    for (let i = 0; i < count; i++) {
        const ts = makeTs(i * 1000);
        const session_id = `ratio-sess-${String(i).padStart(4, "0")}`;
        const pr_number = 8000 + i;
        const v = makeVerdictEvent({ ts, session_id, pr_number, verdict: "READY FOR MERGE" });
        const mergeAction = i < mergedCount ? "merged" : "closed-unmerged";
        const ma = makeMergeActionEvent({ ts, session_id, pr_number, merge_action: mergeAction, resolved_at: ts });
        events.push(v, ma);
    }
    await fs.mkdir(telemetryDir, { recursive: true });
    await writeJSONL(telemetryDir, "ratio-verdicts.jsonl", events);
}
/** Build the done manifest YAML */
function makeDoneManifestYaml(opts) {
    const manifest = {
        ref: opts.ref,
        status: "done",
        adapter: "native",
        source_path: `.crew/native-stories/${opts.ref.replace("native:", "")}.md`,
        source_hash: "a".repeat(64),
        depends_on: [],
        acceptance_criteria: [
            { text: "Given the tool, when called, then it works.", kind: "integration" },
        ],
        title: "Auto-merge gate test story",
        narrative: "As a dev, I want to test the auto-merge gate.",
        withdrawn: false,
        claimed_by: opts.sessionUlid,
    };
    if (opts.risk_tier !== undefined) {
        manifest["risk_tier"] = opts.risk_tier;
    }
    return yamlStringify(manifest, { lineWidth: 0 });
}
/** Seed the done/<ref>.yaml manifest */
async function seedDoneManifest(targetRepoRoot, opts) {
    const doneDir = path.join(targetRepoRoot, ".crew", "state", "done");
    await fs.mkdir(doneDir, { recursive: true });
    await atomicWriteFile(path.join(doneDir, `${opts.ref}.yaml`), makeDoneManifestYaml(opts));
}
/** Seed plugin permissions (generalist-dev.yaml with pr-merge, gh-error-map.yaml) */
async function seedPluginPermissions(pluginRoot) {
    await fs.mkdir(path.join(pluginRoot, "permissions"), { recursive: true });
    await atomicWriteFile(path.join(pluginRoot, "permissions", "generalist-dev.yaml"), [
        "role: generalist-dev",
        "tools_allow:",
        "  - claimStory",
        "gh_allow:",
        "  - pr-view",
        "  - pr-merge",
        "  - api",
        "  - repo-view",
        "gh_allow_args: {}",
    ].join("\n") + "\n");
    await atomicWriteFile(path.join(pluginRoot, "permissions", "gh-error-map.yaml"), [
        "entries:",
        '  - exit_code: 4',
        '    stderr_regex: "API rate limit exceeded"',
        '    class: defer',
        '  - exit_code: 1',
        '    stderr_regex: "already been merged"',
        '    class: defer',
    ].join("\n") + "\n");
}
/** Build a fake execa that records calls and returns canned responses */
function makeFakeExeca(routes) {
    const calls = [];
    const impl = vi.fn().mockImplementation(async (cmd, args, callOpts) => {
        calls.push({ cmd, args, input: callOpts?.input });
        for (const route of routes) {
            if (route.match(cmd, args)) {
                return {
                    stdout: route.response.stdout ?? "",
                    stderr: route.response.stderr ?? "",
                    exitCode: route.response.exitCode ?? 0,
                };
            }
        }
        // Fallback: unexpected call
        return {
            stdout: "",
            stderr: `unexpected gh call: ${cmd} ${args.join(" ")}`,
            exitCode: 1,
        };
    });
    return { impl, calls };
}
/** Fake execa that handles repo-view + api-labels (pause branch) */
function makePauseExeca(labelsOnCall) {
    return makeFakeExeca([
        {
            match: (cmd, args) => cmd === "gh" && args[0] === "repo" && args[1] === "view",
            response: { stdout: DEFAULT_REPO_VIEW_JSON },
        },
        {
            match: (cmd, args) => cmd === "gh" && args[0] === "api",
            response: { stdout: DEFAULT_LABELS_RESPONSE },
        },
    ]);
}
/** Fake execa that handles pr merge (auto-merge branch) */
function makeMergeExeca() {
    return makeFakeExeca([
        {
            match: (cmd, args) => cmd === "gh" && args[0] === "pr" && args[1] === "merge",
            response: { stdout: "Pull request #55 was successfully merged." },
        },
    ]);
}
/** Build a `computeAgreementImpl` that returns a fixed metric */
function makeAgreementImpl(result) {
    return async () => result;
}
function makeMetric(ratio) {
    return {
        ratio,
        distribution: {
            "READY FOR MERGE": Math.round(ratio * 50),
            "NEEDS CHANGES": 0,
            BLOCKED: 0,
        },
        window_size: 50,
        sample_size: 50,
        skipped_unresolved: 0,
        skipped_excluded: 0,
        malformed_lines: 0,
    };
}
// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let tmpRoot;
let targetRepoRoot;
let pluginRoot;
beforeEach(async () => {
    __resetGhErrorMapCacheForTests();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "auto-merge-gate-"));
    targetRepoRoot = path.join(tmpRoot, "repo");
    pluginRoot = path.join(tmpRoot, "plugin");
    await fs.mkdir(targetRepoRoot, { recursive: true });
    await seedPluginPermissions(pluginRoot);
});
afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});
// ---------------------------------------------------------------------------
// Base options helper
// ---------------------------------------------------------------------------
function baseOpts(override = {}) {
    return {
        targetRepoRoot,
        prNumber: PR_NUMBER,
        ref: REF,
        sessionUlid: SESSION_ULID,
        pluginRootOverride: pluginRoot,
        ...override,
    };
}
// ---------------------------------------------------------------------------
// (5d) (a) Auto-merge fires
// ---------------------------------------------------------------------------
describe("AC5(a) — auto-merge fires (low risk, met threshold)", () => {
    it("ratio === default threshold (0.8) → decision auto-merge, merged: true, pr merge called", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca, calls } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
        }));
        expect(result.decision).toBe("auto-merge");
        expect(result.reason).toBe("low-risk-met-threshold");
        expect(result.merged).toBe(true);
        expect(result.labelsApplied).toEqual([]);
        expect(result.dryRun).toBe(false);
        expect(result.prNumber).toBe(PR_NUMBER);
        // fakeExeca called with pr merge --squash --delete-branch
        const mergeCalls = calls.filter(c => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "merge");
        expect(mergeCalls).toHaveLength(1);
        expect(mergeCalls[0].args).toEqual(["pr", "merge", String(PR_NUMBER), "--squash", "--delete-branch"]);
    });
    it("ratio 0.81 (strictly above) → auto-merge", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.81)),
        }));
        expect(result.decision).toBe("auto-merge");
        expect(result.merged).toBe(true);
    });
    it("thresholdOverride: 0.85 with agreement 0.8 → pause (cross-check threshold-override path)", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.85,
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("low-risk-sub-threshold");
        expect(result.threshold_used).toBe(0.85);
    });
});
// ---------------------------------------------------------------------------
// (5e) (b) Medium pauses
// ---------------------------------------------------------------------------
describe("AC5(b) — medium pauses", () => {
    it("medium risk with perfect agreement → pause with medium-risk, no merge call", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "medium" });
        const { impl: fakeExeca, calls } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(1.0)),
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("medium-risk");
        expect(result.merged).toBe(false);
        expect(result.labelsApplied).toEqual(["needs-human"]);
        // pr merge MUST NOT be called
        const mergeCalls = calls.filter(c => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "merge");
        expect(mergeCalls).toHaveLength(0);
        // repo view MUST be called (owner/repo lookup)
        const viewCalls = calls.filter(c => c.cmd === "gh" && c.args[0] === "repo" && c.args[1] === "view");
        expect(viewCalls).toHaveLength(1);
        // api POST /labels MUST be called with needs-human
        const apiCalls = calls.filter(c => c.cmd === "gh" && c.args[0] === "api");
        expect(apiCalls).toHaveLength(1);
        const inputParsed = JSON.parse(apiCalls[0].input ?? "{}");
        expect(inputParsed.labels).toContain("needs-human");
    });
});
// ---------------------------------------------------------------------------
// (5f) (c) High pauses
// ---------------------------------------------------------------------------
describe("AC5(c) — high pauses", () => {
    it("high risk with perfect agreement → pause with high-risk, no merge call", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "high" });
        const { impl: fakeExeca, calls } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(1.0)),
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("high-risk");
        expect(result.merged).toBe(false);
        expect(result.labelsApplied).toEqual(["needs-human"]);
        const mergeCalls = calls.filter(c => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "merge");
        expect(mergeCalls).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// (5g) (d) Low + sub-threshold pauses
// ---------------------------------------------------------------------------
describe("AC5(d) — low + sub-threshold pauses", () => {
    it("low risk, ratio 0.7 (below default 0.8) → low-risk-sub-threshold pause", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.7)),
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("low-risk-sub-threshold");
        expect(result.merged).toBe(false);
        expect(result.labelsApplied).toEqual(["needs-human"]);
    });
    it("thresholdOverride: 0.6 with agreement 0.7 → auto-merge fires (cross-check)", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.7)),
            thresholdOverride: 0.6,
        }));
        expect(result.decision).toBe("auto-merge");
        expect(result.reason).toBe("low-risk-met-threshold");
        expect(result.threshold_used).toBe(0.6);
    });
});
// ---------------------------------------------------------------------------
// (5h) (e) Low + insufficient-data pauses
// ---------------------------------------------------------------------------
describe("AC5(e) — low + insufficient-data pauses", () => {
    it("null agreement_metric → low-risk-insufficient-data pause", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(null),
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("low-risk-insufficient-data");
        expect(result.agreement_metric).toBeNull();
        expect(result.merged).toBe(false);
        expect(result.labelsApplied).toEqual(["needs-human"]);
    });
    it("lastNVerdictsOverride: 30 with 30 seeds → agreement computed, decision based on ratio", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const telemetryDir = path.join(targetRepoRoot, ".crew", "telemetry");
        // Seed 30 READY FOR MERGE + merged pairs (ratio 1.0)
        await seedRatioVerdicts(telemetryDir, 30, 30);
        const { impl: fakeExeca } = makeMergeExeca();
        // With lastNVerdictsOverride: 30, 30 pairs is sufficient → agreement should be 1.0
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            lastNVerdictsOverride: 30,
        }));
        expect(result.agreement_metric).not.toBeNull();
        // ratio 1.0 >= threshold 0.8 → auto-merge
        expect(result.decision).toBe("auto-merge");
    });
});
// ---------------------------------------------------------------------------
// (5i) (f) Manual-merge override (structural SKILL.md check)
// ---------------------------------------------------------------------------
describe("AC5(f) — manual-merge override (structural SKILL.md check)", () => {
    it("SKILL.md contains runAutoMergeGate invocation", async () => {
        const raw = await fs.readFile(SKILL_FILE, "utf8");
        expect(raw).toContain("runAutoMergeGate");
    });
    it("runAutoMergeGate appears under done-ready-for-merge branch only (not under done-blocked-*)", async () => {
        const raw = await fs.readFile(SKILL_FILE, "utf8");
        // Strip the YAML frontmatter (everything between the opening --- and closing ---)
        // so we're only searching the body prose, not the allowed_tools list.
        const bodyMatch = /^---\n[\s\S]*?\n---\n([\s\S]*)$/m.exec(raw);
        expect(bodyMatch, "SKILL.md must have valid YAML front-matter").not.toBeNull();
        const body = bodyMatch[1];
        // Find the done-ready-for-merge section in the body
        const readyForMergeIdx = body.indexOf("done-ready-for-merge");
        expect(readyForMergeIdx).toBeGreaterThan(-1);
        // Find done-blocked sections in the body
        // Story 5.21: done-blocked-no-session-result removed; use done-blocked-reviewer-blocked as the sibling anchor.
        const blockedNeedsChangesIdx = body.indexOf("done-blocked-reviewer-needs-changes");
        const blockedBlockedIdx = body.indexOf("done-blocked-reviewer-blocked");
        // runAutoMergeGate invocation (prose) should appear after done-ready-for-merge
        const gateIdx = body.indexOf("runAutoMergeGate(");
        expect(gateIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeGreaterThan(readyForMergeIdx);
        // runAutoMergeGate invocation should appear BEFORE the blocked sections
        const firstBlockedIdx = Math.min(blockedNeedsChangesIdx, blockedBlockedIdx);
        expect(gateIdx).toBeLessThan(firstBlockedIdx);
    });
});
// ---------------------------------------------------------------------------
// (5j) (g) No-tier pause (legacy manifest)
// ---------------------------------------------------------------------------
describe("AC5(g) — no-tier pause (legacy manifest)", () => {
    it("manifest without risk_tier → no-tier-no-signal pause, agreement still computed", async () => {
        // Seed manifest WITHOUT risk_tier
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID }); // no risk_tier
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(1.0)),
        }));
        expect(result.decision).toBe("pause-needs-human");
        expect(result.reason).toBe("no-tier-no-signal");
        expect(result.risk_tier).toBeNull();
        expect(result.agreement_metric).not.toBeNull(); // still computed
        expect(result.labelsApplied).toEqual(["needs-human"]);
    });
});
// ---------------------------------------------------------------------------
// (5k) (h) Boundary — ratio exactly equals threshold
// ---------------------------------------------------------------------------
describe("AC5(h) — boundary: ratio exactly equals threshold (>= semantics)", () => {
    it("ratio 0.8 with threshold 0.8 → auto-merge fires (pinned against regression to >)", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.8,
        }));
        expect(result.decision).toBe("auto-merge");
        expect(result.reason).toBe("low-risk-met-threshold");
        expect(result.merged).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// (5l) (i) SKILL.md content-structure: literal invocation anchor
// ---------------------------------------------------------------------------
describe("AC5(i) — SKILL.md contains literal runAutoMergeGate invocation anchor", () => {
    it("prose under done-ready-for-merge contains the tool invocation with the required argument keys", async () => {
        const raw = await fs.readFile(SKILL_FILE, "utf8");
        // Strip frontmatter so we're checking the prose body, not the allowed_tools list
        const bodyMatch = /^---\n[\s\S]*?\n---\n([\s\S]*)$/m.exec(raw);
        expect(bodyMatch).not.toBeNull();
        const body = bodyMatch[1];
        // Regex that allows whitespace flex but pins the tool name and argument keys
        expect(body).toMatch(/runAutoMergeGate\s*\(\s*\{[^}]*targetRepoRoot[^}]*prNumber[^}]*ref[^}]*sessionUlid[^}]*\}\s*\)/);
    });
});
// ---------------------------------------------------------------------------
// (5m) (j) MCP tool registration smoke
// ---------------------------------------------------------------------------
describe("AC5(j) — MCP tool registration smoke", () => {
    it("register.ts includes runAutoMergeGate and total count is 31", () => {
        const registeredTools = [];
        const fakeServer = {
            registerTool: (tool) => {
                registeredTools.push(tool.name);
            },
        };
        registerAllTools(fakeServer);
        expect(registeredTools).toContain("runAutoMergeGate");
        // Story 5.11 added scanOrphanedInProgress (33), reattachOrphan (34), blockOrphanNoTranscript (35); Story 6.1 added recordStoryRetro (36); Story 6.3 added writeRetroProposal (37).
        expect(registeredTools.length).toBe(37);
    });
});
// ---------------------------------------------------------------------------
// (5n) (k) dryRun: true — no gh call made
// ---------------------------------------------------------------------------
describe("AC5(k) — dryRun: true skips gh shell-out", () => {
    it("dryRun: true → decision computed, merged: false, dryRun: true, no execa calls for merge", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca, calls } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: true,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.8,
        }));
        expect(result.decision).toBe("auto-merge");
        expect(result.merged).toBe(false);
        expect(result.dryRun).toBe(true);
        expect(result.labelsApplied).toEqual([]);
        // No gh call should have been made
        expect(calls).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// (5o) (l) GhRecoverableError on pr merge failure
// ---------------------------------------------------------------------------
describe("AC5(l) — GhRecoverableError on pr merge failure", () => {
    it("non-zero exit on pr merge with mapped stderr → throws GhRecoverableError", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        // Fake execa that returns non-zero exit with a stderr matching the error map
        const failExeca = makeFakeExeca([
            {
                match: (cmd, args) => cmd === "gh" && args[0] === "pr" && args[1] === "merge",
                response: {
                    stdout: "",
                    stderr: "already been merged",
                    exitCode: 1,
                },
            },
        ]);
        await expect(runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: failExeca.impl,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.8,
        }))).rejects.toMatchObject({
            name: "GhRecoverableError",
            class: "defer",
        });
    });
});
// ---------------------------------------------------------------------------
// (5p) (m) pr-merge denied without permission entry
// ---------------------------------------------------------------------------
describe("AC5(m) — pr-merge denied without permission entry in gh_allow", () => {
    it("throws GhSubcommandDeniedError when pr-merge is absent from generalist-dev gh_allow", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        // Create a plugin root WITHOUT pr-merge in gh_allow
        const restrictedPluginRoot = path.join(tmpRoot, "restricted-plugin");
        await fs.mkdir(path.join(restrictedPluginRoot, "permissions"), { recursive: true });
        await atomicWriteFile(path.join(restrictedPluginRoot, "permissions", "generalist-dev.yaml"), [
            "role: generalist-dev",
            "tools_allow:",
            "  - claimStory",
            "gh_allow:",
            "  - pr-view",
            // pr-merge intentionally omitted
            "gh_allow_args: {}",
        ].join("\n") + "\n");
        await atomicWriteFile(path.join(restrictedPluginRoot, "permissions", "gh-error-map.yaml"), "entries: []\n");
        const { impl: fakeExeca } = makeMergeExeca();
        await expect(runAutoMergeGate({
            targetRepoRoot,
            prNumber: PR_NUMBER,
            ref: REF,
            sessionUlid: SESSION_ULID,
            pluginRootOverride: restrictedPluginRoot,
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.8,
        })).rejects.toThrow(GhSubcommandDeniedError);
    });
});
// ---------------------------------------------------------------------------
// (5q) (n) AutoMergeGateResultSchema round-trip
// ---------------------------------------------------------------------------
describe("AC5(n) — AutoMergeGateResultSchema round-trip", () => {
    it("result parses through schema without error and unknown keys fail", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makeMergeExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.8)),
            thresholdOverride: 0.8,
        }));
        // Round-trip: JSON.stringify → JSON.parse → schema.parse
        const roundTripped = AutoMergeGateResultSchema.parse(JSON.parse(JSON.stringify(result)));
        expect(roundTripped.decision).toBe(result.decision);
        expect(roundTripped.reason).toBe(result.reason);
        expect(roundTripped.merged).toBe(result.merged);
        expect(roundTripped.prNumber).toBe(result.prNumber);
        // Unknown fields should fail strict schema
        const withExtraField = { ...result, unknownField: "surprise" };
        const parseResult = AutoMergeGateResultSchema.safeParse(withExtraField);
        expect(parseResult.success).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Additional: threshold validation errors
// ---------------------------------------------------------------------------
describe("AutoMergeGateThresholdInvalidError — threshold validation", () => {
    it("thresholdOverride: NaN → throws AutoMergeGateThresholdInvalidError", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        await expect(runAutoMergeGate(baseOpts({ thresholdOverride: NaN }))).rejects.toThrow(AutoMergeGateThresholdInvalidError);
    });
    it("thresholdOverride: 1.5 → throws AutoMergeGateThresholdInvalidError", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        await expect(runAutoMergeGate(baseOpts({ thresholdOverride: 1.5 }))).rejects.toThrow(AutoMergeGateThresholdInvalidError);
    });
    it("thresholdOverride: -0.1 → throws AutoMergeGateThresholdInvalidError", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        await expect(runAutoMergeGate(baseOpts({ thresholdOverride: -0.1 }))).rejects.toThrow(AutoMergeGateThresholdInvalidError);
    });
});
// ---------------------------------------------------------------------------
// threshold_used is stamped in result
// ---------------------------------------------------------------------------
describe("threshold_used is stamped in result", () => {
    it("thresholdOverride: 0.75 → result.threshold_used is 0.75", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.7)),
            thresholdOverride: 0.75,
        }));
        expect(result.threshold_used).toBe(0.75);
    });
    it("no thresholdOverride + loadWorkspaceConfigImpl returning 0.9 → threshold_used is 0.9", async () => {
        await seedDoneManifest(targetRepoRoot, { ref: REF, sessionUlid: SESSION_ULID, risk_tier: "low" });
        const { impl: fakeExeca } = makePauseExeca();
        const result = await runAutoMergeGate(baseOpts({
            dryRun: false,
            execaImpl: fakeExeca,
            computeAgreementImpl: makeAgreementImpl(makeMetric(0.85)),
            loadWorkspaceConfigImpl: async () => ({
                agreement_threshold: 0.9,
                orchestration_interval_seconds: 120,
            }),
        }));
        expect(result.threshold_used).toBe(0.9);
        // 0.85 < 0.9 → pause
        expect(result.decision).toBe("pause-needs-human");
    });
});
