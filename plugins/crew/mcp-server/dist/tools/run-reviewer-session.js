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
 * This tool is the structural anchor that closes the "reviewer rubber-stamp"
 * failure mode documented in Story 4.3c: the reviewer persona's verdict
 * composition is structurally required to consume the returned
 * `ReviewerSessionResult`, so it cannot skip a read or an AC check.
 *
 * The tool MUST NOT:
 *   - Spawn subagents (that is the SKILL.md prose layer's responsibility).
 *   - Mutate any manifest, state file, or canonical-state path.
 *   - Swallow typed errors — all read/execution errors propagate uncaught.
 *
 * TODO(4.12): wire `agent.invoke` and `reviewer.verdict` telemetry events here.
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
export async function runReviewerSession(opts) {
    const { targetRepoRoot, ref, prNumber, role = "generalist-reviewer", pluginRootOverride, } = opts;
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
    return {
        sourceStory,
        prDiff,
        standards,
        standardsByCriterionId,
        acResults,
    };
}
