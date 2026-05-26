/**
 * `runReviewerSession` composite MCP tool — Story 4.6.
 *
 * Behavioural contract source:
 *   _bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md
 *
 * Performs the three mandatory reads (source story via active adapter, PR diff
 * via `gh pr diff`, standards doc via `lookupStandards`) in fixed sequential
 * order BEFORE returning any data to the persona prose. Then executes every AC
 * extracted from the source spec against the applicability classifier and returns
 * structured `acResults` keyed by AC index.
 *
 * **Revision 2 (deterministic-verdict-transport):** Before returning, this tool
 * derives `recommendedVerdict` deterministically from `acResults` per the
 * closed algorithm in spec §3f, then persists the result to
 * `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json`
 * via `atomicWriteFile`. The verdict transport is the file, not the reviewer's
 * chat output. `processReviewerTranscript` reads the file and switches on
 * `recommendedVerdict` — the reviewer's chat is informational only.
 *
 * Same pattern as Story 4.3c's `completeStory` call inside
 * `processReviewerTranscript`: load-bearing decisions live in the tool layer.
 *
 * The tool MUST NOT:
 *   - Spawn subagents (that is the SKILL.md prose layer's responsibility).
 *   - Mutate any manifest (only the sessions/reviewer-result.json file is written).
 *   - Swallow typed errors — all read/execution errors propagate uncaught.
 *
 * Telemetry wiring: `agent.invoke` is recorded by the dev session's SKILL.md caller
 * via `recordAgentInvoke` (Story 4.12); `reviewer.verdict` is emitted by
 * `postReviewerComments` on POST success (Story 4.12 Task 3).
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execa as defaultExeca } from "execa";
import { resolveWorkspace } from "../state/workspace-resolver.js";
import { lookupStandards } from "../state/lookup-standards.js";
import { loadRolePermissions } from "../state/load-role-permissions.js";
import { gh } from "../lib/gh.js";
import { extractAcsFromSpec } from "../lib/extract-acs-from-spec.js";
import { slugifyStandardsCriterion } from "../lib/slugify-standards-criterion.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import { DuplicateStandardsCriterionIdError } from "../errors.js";
import { getPluginRoot } from "../lib/plugin-root.js";
// ---------------------------------------------------------------------------
// Applicability classifiers
// ---------------------------------------------------------------------------
const ARTIFACT_RE = /^artifact:\s*(\S+)$/m;
const VITEST_RE = /^vitest:\s*(.+)$/m;
function classifyAc(bodyLines) {
    const bodyText = bodyLines.join("\n");
    // artifact: wins over vitest: when both present (spec §2b)
    const artifactMatch = ARTIFACT_RE.exec(bodyText);
    if (artifactMatch) {
        return { applicability: "runnable-artifact-check", artifactPath: artifactMatch[1] };
    }
    const vitestMatch = VITEST_RE.exec(bodyText);
    if (vitestMatch) {
        return { applicability: "runnable-vitest", testNameFilter: vitestMatch[1].trim() };
    }
    return { applicability: "manual-check-required" };
}
// ---------------------------------------------------------------------------
// AC runners
// ---------------------------------------------------------------------------
async function runArtifactCheck(index, tag, artifactPath, targetRepoRoot) {
    const resolved = path.resolve(targetRepoRoot, artifactPath);
    try {
        await fs.access(resolved);
        return {
            index,
            tag,
            applicability: "runnable-artifact-check",
            artifactPath,
            status: "pass",
            reason: `artifact present at ${resolved}`,
        };
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT") {
            return {
                index,
                tag,
                applicability: "runnable-artifact-check",
                artifactPath,
                status: "fail",
                reason: `artifact missing at ${resolved} (ENOENT)`,
            };
        }
        // Any other error (e.g. EACCES) propagates uncaught per spec §2c.
        throw err;
    }
}
const VITEST_TIMEOUT_MS = 90_000;
const STDOUT_STDERR_CAP = 4000;
const TRUNCATION_MARKER = "\n...[truncated]";
function capString(s) {
    if (s.length <= STDOUT_STDERR_CAP)
        return s;
    return s.slice(0, STDOUT_STDERR_CAP) + TRUNCATION_MARKER;
}
async function runVitestCheck(index, tag, testNameFilter, targetRepoRoot, execaImpl) {
    const result = await execaImpl("pnpm", ["vitest", "--run", "-t", testNameFilter], {
        cwd: targetRepoRoot,
        reject: false,
        timeout: VITEST_TIMEOUT_MS,
    });
    const rawStdout = typeof result.stdout === "string" ? result.stdout : "";
    const rawStderr = typeof result.stderr === "string" ? result.stderr : "";
    const exitCode = typeof result.exitCode === "number"
        ? result.exitCode
        : result.timedOut
            ? -1
            : 1;
    if (result.timedOut) {
        return {
            index,
            tag,
            applicability: "runnable-vitest",
            testNameFilter,
            status: "fail",
            reason: `vitest filter '${testNameFilter}' timed out after 90s`,
            stdout: capString(rawStdout),
            stderr: capString(rawStderr),
            exitCode,
        };
    }
    const status = exitCode === 0 ? "pass" : "fail";
    const reason = exitCode === 0
        ? `vitest filter '${testNameFilter}' passed`
        : `vitest filter '${testNameFilter}' failed (exit ${exitCode})`;
    return {
        index,
        tag,
        applicability: "runnable-vitest",
        testNameFilter,
        status,
        reason,
        stdout: capString(rawStdout),
        stderr: capString(rawStderr),
        exitCode,
    };
}
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * Composite reviewer-session tool.
 *
 * Performs the three reads in fixed sequential order (source story →
 * PR diff → standards doc), builds `standardsByCriterionId`, runs every
 * AC via the applicability classifier, and returns `ReviewerSessionResult`.
 *
 * All errors from reads propagate uncaught — the tool does not retry or
 * swallow. The SKILL.md prose surfaces the error and exits the inner cycle.
 */
/**
 * Derive `recommendedVerdict` deterministically from `acResults` per spec §3f.
 *
 * Algorithm (closed set — the tool decides, the LLM does not):
 *  1. If any acResult has `status === "fail"` → "NEEDS CHANGES"
 *  2. Else if `acResults` is empty OR any acResult has `applicability === "manual-check-required"` → "BLOCKED"
 *  3. Else → "READY FOR MERGE"
 */
function deriveRecommendedVerdict(acResults) {
    const values = Object.values(acResults);
    // Rule 1: any fail → NEEDS CHANGES
    if (values.some((r) => r.status === "fail")) {
        return "NEEDS CHANGES";
    }
    // Rule 2: empty OR any manual-check-required → BLOCKED
    if (values.length === 0 || values.some((r) => r.applicability === "manual-check-required")) {
        return "BLOCKED";
    }
    // Rule 3: all runnable and all pass → READY FOR MERGE
    return "READY FOR MERGE";
}
export async function runReviewerSession(opts) {
    const { targetRepoRoot, sessionUlid, ref, prNumber, role = "generalist-reviewer", pluginRootOverride, } = opts;
    const execaImpl = opts.execaImpl ?? defaultExeca;
    // -------------------------------------------------------------------------
    // Read 1: source story via active adapter (sequentially — per spec §1e)
    // -------------------------------------------------------------------------
    const workspace = await resolveWorkspace({ targetRepoRoot });
    const sourceStory = await workspace.activeAdapter.readSourceStory(ref);
    // -------------------------------------------------------------------------
    // Read 2: PR diff via gh wrapper
    // -------------------------------------------------------------------------
    const pluginRoot = pluginRootOverride ?? getPluginRoot();
    const permissions = await loadRolePermissions({ role, pluginRoot });
    const diffResult = await gh({
        role,
        permissions,
        subcommand: "pr-diff",
        args: [String(prNumber)],
        execaImpl,
        pluginRootOverride,
    });
    const prDiff = diffResult.stdout;
    // -------------------------------------------------------------------------
    // Read 3: standards doc
    // -------------------------------------------------------------------------
    const standards = await lookupStandards(targetRepoRoot);
    // -------------------------------------------------------------------------
    // Build standardsByCriterionId (spec §3a–3c)
    // -------------------------------------------------------------------------
    const standardsByCriterionId = {};
    for (const criterion of standards.criteria) {
        const id = slugifyStandardsCriterion(criterion.name);
        if (id in standardsByCriterionId) {
            // Duplicate-id guard: collect both offending names and raise (spec §3c)
            const existingName = standardsByCriterionId[id].name;
            throw new DuplicateStandardsCriterionIdError({
                criterionId: id,
                names: [existingName, criterion.name],
            });
        }
        standardsByCriterionId[id] = criterion;
    }
    // -------------------------------------------------------------------------
    // AC execution (spec §2a–2h)
    // -------------------------------------------------------------------------
    // The spec says to use sourceStory.specPath, but the SourceStory type has
    // raw_path which is the absolute path to the on-disk spec file.
    const specPath = sourceStory.raw_path;
    const acEntries = await extractAcsFromSpec(specPath);
    // Execute serially in numeric-index order (spec §2f)
    const acResults = {};
    for (const ac of acEntries) {
        const classification = classifyAc(ac.body);
        if (classification.applicability === "runnable-artifact-check") {
            acResults[ac.index] = await runArtifactCheck(ac.index, ac.tag, classification.artifactPath, targetRepoRoot);
        }
        else if (classification.applicability === "runnable-vitest") {
            acResults[ac.index] = await runVitestCheck(ac.index, ac.tag, classification.testNameFilter, targetRepoRoot, execaImpl);
        }
        else {
            // manual-check-required (spec §2c)
            acResults[ac.index] = {
                index: ac.index,
                tag: ac.tag,
                applicability: "manual-check-required",
                reason: "AC body has no `artifact:` or `vitest:` marker — manual check required before merge",
            };
        }
    }
    // -------------------------------------------------------------------------
    // Derive recommendedVerdict deterministically (spec §3f — revision 2)
    // -------------------------------------------------------------------------
    const recommendedVerdict = deriveRecommendedVerdict(acResults);
    // -------------------------------------------------------------------------
    // Persist reviewer-result.json (spec §3g — revision 2)
    //
    // Only the verdict-relevant projection is persisted — heavy fields
    // (sourceStory, prDiff) stay in-memory only.
    // The parent directory is created if absent.
    // -------------------------------------------------------------------------
    const sessionDir = path.join(targetRepoRoot, ".crew", "state", "sessions", sessionUlid);
    await fs.mkdir(sessionDir, { recursive: true });
    const resultFilePath = path.join(sessionDir, "reviewer-result.json");
    const fileProjection = {
        sessionUlid,
        ref,
        recommendedVerdict,
        acResults,
        standardsByCriterionId,
        sourceStoryRef: sourceStory.ref,
        prNumber,
        standardsVersion: standards.version,
    };
    await atomicWriteFile(resultFilePath, JSON.stringify(fileProjection, null, 2));
    return {
        sessionUlid,
        ref,
        prNumber,
        sourceStory,
        sourceStoryRef: sourceStory.ref,
        prDiff,
        standards,
        standardsByCriterionId,
        acResults,
        recommendedVerdict,
    };
}
