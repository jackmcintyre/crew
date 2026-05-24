/**
 * Integration tests for `postReviewerComments` — Story 4.6b Task 8 (AC4);
 * extended Story 4.7 Task 5 (AC3 two-run, PATCH path, idempotent rerun).
 *
 * Fixture: tmpdir with `.crew/config.yaml` and optional
 * `.crew/state/sessions/<sessionUlid>/reviewer-result.json`.
 *
 * The `gh` stub routes by cmd / args[0..1] per the pattern established in
 * `run-reviewer-session.test.ts` (Story 4.6 Issue 2). The shared helper
 * `gh-execa-stub.ts` provides the routing logic.
 *
 * Story 4.6b Task 8.1–8.5; Story 4.7 Task 5.0–5.2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { postReviewerComments } from "../post-reviewer-comments.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { __resetGhErrorMapCacheForTests } from "../../lib/gh-error-map.js";
import { __resetPluginVersionCacheForTests } from "../../lib/plugin-version.js";
import { GhRecoverableError, GhApiResponseShapeError, ReviewerResultFileMalformedError } from "../../errors.js";
import { makeGhExecaStub } from "../../__tests__/test-helpers/gh-execa-stub.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SESSION_ULID = "01HZTEST4_6B_INTEGRATION000";
const STORY_REF = "native:01HZTEST00000000000000000";
const PR_NUMBER = 42;
const PLUGIN_VERSION = "1.0.0-test";
// Expected footer marker for the fixture story ref and plugin version
const EXPECTED_FOOTER_MARKER = `<!-- crew:verdict:${PLUGIN_VERSION}:${STORY_REF} -->`;
// A diff where src/added-but-missing.ts is a new file starting at line 1.
const FAKE_DIFF_WITH_ARTIFACT = `diff --git a/src/added-but-missing.ts b/src/added-but-missing.ts
new file mode 100644
--- /dev/null
+++ b/src/added-but-missing.ts
@@ -0,0 +1,3 @@
+export const foo = "bar";
+export const baz = 42;
+export const qux = true;
`;
// A diff that does NOT contain the artifact path.
const FAKE_DIFF_WITHOUT_ARTIFACT = `diff --git a/README.md b/README.md
--- /dev/null
+++ b/README.md
@@ -0,0 +1,1 @@
+# Hello
`;
// A standards doc with one criterion
const STANDARDS = {
    "story-aligned": {
        name: "story-aligned",
        what: "The PR diff implements only what the story requires.",
        check: "Map each diff hunk to an AC.",
        anti_criterion: "Scope creep.",
    },
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeArtifactPassResult(index) {
    return {
        index,
        tag: null,
        applicability: "runnable-artifact-check",
        artifactPath: `artifact-${index}.txt`,
        status: "pass",
        reason: `artifact-${index}.txt exists`,
    };
}
function makeArtifactFailResult(index, path) {
    return {
        index,
        tag: null,
        applicability: "runnable-artifact-check",
        artifactPath: path,
        status: "fail",
        reason: `artifact: ${path} — ENOENT at ${path}`,
    };
}
function makeManualCheckResult(index) {
    return {
        index,
        tag: null,
        applicability: "manual-check-required",
        reason: `Operator must verify AC${index} manually.`,
    };
}
function makeReviewerResult(verdict, acResults = {}) {
    return {
        sessionUlid: SESSION_ULID,
        ref: STORY_REF,
        recommendedVerdict: verdict,
        acResults,
        standardsByCriterionId: STANDARDS,
        sourceStoryRef: STORY_REF,
        prNumber: PR_NUMBER,
        standardsVersion: "1.2.3",
    };
}
// Reviews API URL pattern for the fixture PR
const REVIEWS_URL_PATTERN = `/repos/jackmcintyre/crew/pulls/${PR_NUMBER}/reviews`;
/**
 * Build a stub with GET reviews returning empty (no prior verdict) and
 * POST returning { id: 12345 }.
 */
function makeStubWithEmptyReviews(opts = {}) {
    return makeGhExecaStub({
        prDiff: opts.prDiff,
        apiRoutes: [
            {
                url: REVIEWS_URL_PATTERN,
                method: "GET",
                response: { stdout: JSON.stringify([]), exitCode: 0 },
            },
            {
                url: REVIEWS_URL_PATTERN,
                method: "POST",
                response: { stdout: JSON.stringify({ id: 12345 }), exitCode: 0 },
                onCall: opts.onPostCall,
            },
        ],
    });
}
// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let tmpRoot;
let pluginRoot;
beforeEach(async () => {
    __resetGhErrorMapCacheForTests();
    __resetPluginVersionCacheForTests();
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "crew-4-6b-int-"));
    pluginRoot = path.join(tmpRoot, "plugin");
    // .crew/config.yaml
    await fs.mkdir(path.join(tmpRoot, ".crew"), { recursive: true });
    await atomicWriteFile(path.join(tmpRoot, ".crew", "config.yaml"), "adapter: native\nadapter_config: {}\n");
    // Plugin permissions directory with gh-error-map.yaml and reviewer permissions
    await fs.mkdir(path.join(pluginRoot, "permissions"), { recursive: true });
    // gh-error-map.yaml (minimal valid map)
    await atomicWriteFile(path.join(pluginRoot, "permissions", "gh-error-map.yaml"), `entries:\n  - exit_code: 4\n    stderr_regex: "API rate limit exceeded"\n    class: defer\n`);
    // generalist-reviewer.yaml permissions
    await atomicWriteFile(path.join(pluginRoot, "permissions", "generalist-reviewer.yaml"), [
        "role: generalist-reviewer",
        "tools_allow:",
        "  - runReviewerSession",
        "gh_allow:",
        "  - pr-view",
        "  - pr-comment",
        "  - pr-review",
        "  - pr-diff",
        "  - api",
        "gh_allow_args: {}",
    ].join("\n"));
});
afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
});
async function writeResultFile(data) {
    const sessDir = path.join(tmpRoot, ".crew", "state", "sessions", SESSION_ULID);
    await fs.mkdir(sessDir, { recursive: true });
    await atomicWriteFile(path.join(sessDir, "reviewer-result.json"), JSON.stringify(data));
}
// ---------------------------------------------------------------------------
// (4c-i) READY FOR MERGE, all-pass
// ---------------------------------------------------------------------------
describe("(4c-i) READY FOR MERGE, all-pass", () => {
    it("gh api body has empty comments array; contains version tokens; footer marker is last line", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", {
            1: makeArtifactPassResult(1),
            2: makeArtifactPassResult(2),
        });
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeStubWithEmptyReviews({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            onPostCall: (input) => { capturedInput = input; },
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        expect(result.postedReviewId).toBe(12345);
        expect(result.inlineCommentCount).toBe(0);
        expect(result.wasEdit).toBe(false);
        expect(result.priorReviewId).toBeNull();
        // gh api body assertions
        const body = JSON.parse(capturedInput);
        expect(body.event).toBe("COMMENT");
        expect(body.comments).toHaveLength(0);
        // Version tokens present
        expect(body.body).toContain("standards_version:");
        expect(body.body).toContain("plugin_version:");
        // Footer marker is absolute last line
        expect(body.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        // Verdict is present (not necessarily last line anymore)
        expect(body.body).toContain("**Verdict: READY FOR MERGE**");
    });
});
// ---------------------------------------------------------------------------
// (4c-ii) NEEDS CHANGES, failing artifact IN diff
// ---------------------------------------------------------------------------
describe("(4c-ii) NEEDS CHANGES, failing artifact in diff", () => {
    it("comments array has 1 entry with correct path, line, and ENOENT in body; footer marker is last line", async () => {
        const resultData = makeReviewerResult("NEEDS CHANGES", {
            1: makeArtifactFailResult(1, "src/added-but-missing.ts"),
        });
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeStubWithEmptyReviews({
            prDiff: { stdout: FAKE_DIFF_WITH_ARTIFACT },
            onPostCall: (input) => { capturedInput = input; },
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        expect(result.inlineCommentCount).toBe(1);
        const body = JSON.parse(capturedInput);
        expect(body.comments).toHaveLength(1);
        const comment = body.comments[0];
        expect(comment.path).toBe("src/added-but-missing.ts");
        expect(comment.line).toBe(1); // @@ -0,0 +1,3 @@ → newStart 1
        expect(comment.body).toContain("ENOENT");
        expect(comment.body).toContain("src/added-but-missing.ts");
        // Footer marker is last line; verdict is in body
        expect(body.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        expect(body.body).toContain("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
    });
});
// ---------------------------------------------------------------------------
// (4c-iii) NEEDS CHANGES, failing artifact NOT in diff
// ---------------------------------------------------------------------------
describe("(4c-iii) NEEDS CHANGES, failing artifact NOT in diff", () => {
    it("comments array is empty; AC still shows ❌ in summary body; footer marker is last line", async () => {
        const resultData = makeReviewerResult("NEEDS CHANGES", {
            1: makeArtifactFailResult(1, "nonexistent/path.txt"),
        });
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeStubWithEmptyReviews({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            onPostCall: (input) => { capturedInput = input; },
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        expect(result.inlineCommentCount).toBe(0);
        const body = JSON.parse(capturedInput);
        expect(body.comments).toHaveLength(0);
        // Failing AC should still appear in summary
        expect(body.body).toContain("❌");
        expect(body.body).toContain("nonexistent/path.txt");
        // Footer marker is last line; verdict is in body
        expect(body.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        expect(body.body).toContain("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
    });
});
// ---------------------------------------------------------------------------
// (4c-iv) BLOCKED, manual checks required
// ---------------------------------------------------------------------------
describe("(4c-iv) BLOCKED, manual checks required", () => {
    it("comments empty; manual-checks section present; verdict is BLOCKED; footer marker is last line", async () => {
        const resultData = makeReviewerResult("BLOCKED", {
            1: makeManualCheckResult(1),
            2: makeManualCheckResult(2),
            3: makeArtifactPassResult(3),
        });
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeStubWithEmptyReviews({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            onPostCall: (input) => { capturedInput = input; },
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        expect(result.inlineCommentCount).toBe(0);
        const body = JSON.parse(capturedInput);
        expect(body.comments).toHaveLength(0);
        expect(body.body).toContain("## Manual checks required before merge");
        // Footer marker is last line; verdict is in body
        const bodyMarker = `<!-- crew:verdict:${PLUGIN_VERSION}:${STORY_REF} -->`;
        expect(body.body.split("\n").at(-1)).toBe(bodyMarker);
        expect(body.body).toContain("**Verdict: BLOCKED** [manual checks required]");
    });
});
// ---------------------------------------------------------------------------
// (4c-v) BLOCKED, no ACs declared
// ---------------------------------------------------------------------------
describe("(4c-v) BLOCKED, no ACs declared", () => {
    it("AC section shows '_No ACs declared'; footer marker is last line", async () => {
        const resultData = makeReviewerResult("BLOCKED", {});
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeStubWithEmptyReviews({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            onPostCall: (input) => { capturedInput = input; },
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        const body = JSON.parse(capturedInput);
        expect(body.body).toContain("_No ACs declared in the source story._");
        // Footer marker is last line; verdict is in body
        expect(body.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        expect(body.body).toContain("**Verdict: BLOCKED** [no ACs declared]");
    });
});
// ---------------------------------------------------------------------------
// (4c-vi) Missing-file path
// ---------------------------------------------------------------------------
describe("(4c-vi) Missing reviewer-result.json", () => {
    it("returns skipped-no-session-result; gh stub is NOT called", async () => {
        // Do NOT write the result file
        const stub = makeGhExecaStub();
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("skipped-no-session-result");
        expect(result.postedReviewId).toBeNull();
        // The stub should NOT have been called
        expect(vi.mocked(stub)).not.toHaveBeenCalled();
    });
});
// ---------------------------------------------------------------------------
// (4e) Negative: recoverable gh pr diff error
// ---------------------------------------------------------------------------
describe("(4e) Negative: recoverable gh pr diff error", () => {
    it("GhRecoverableError propagates uncaught when gh pr diff rate-limits", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", { 1: makeArtifactPassResult(1) });
        await writeResultFile(resultData);
        const stub = makeGhExecaStub({
            prDiff: { exitCode: 4, stderr: "API rate limit exceeded", stdout: "" },
        });
        await expect(postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        })).rejects.toBeInstanceOf(GhRecoverableError);
    });
});
// ---------------------------------------------------------------------------
// (4f) Negative: malformed reviewer-result.json
// ---------------------------------------------------------------------------
describe("(4f) Negative: malformed reviewer-result.json", () => {
    it("ReviewerResultFileMalformedError propagates uncaught", async () => {
        const sessDir = path.join(tmpRoot, ".crew", "state", "sessions", SESSION_ULID);
        await fs.mkdir(sessDir, { recursive: true });
        await atomicWriteFile(path.join(sessDir, "reviewer-result.json"), "NOT VALID JSON {{{ broken");
        const stub = makeGhExecaStub();
        await expect(postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        })).rejects.toBeInstanceOf(ReviewerResultFileMalformedError);
    });
});
// ---------------------------------------------------------------------------
// (4g) Negative: malformed gh api response
// ---------------------------------------------------------------------------
describe("(4g) Negative: malformed gh api GET reviews response", () => {
    it("GhApiResponseShapeError raised when gh api GET reviews returns non-JSON", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", { 1: makeArtifactPassResult(1) });
        await writeResultFile(resultData);
        const stub = makeGhExecaStub({
            api: { stdout: "THIS IS NOT JSON", exitCode: 0 },
        });
        await expect(postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        })).rejects.toBeInstanceOf(GhApiResponseShapeError);
    });
});
// ---------------------------------------------------------------------------
// Story 4.7 (AC3): Two-run scenario — first run POSTs, second run PATCHes
// ---------------------------------------------------------------------------
describe("(4.7 AC3) Two-run idempotent rerun — POST then PATCH", () => {
    it("first run: GET returns empty → POST; second run: GET returns prior verdict → PATCH; footer marker correct on both", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", {
            1: makeArtifactPassResult(1),
        });
        await writeResultFile(resultData);
        // -----------------------------------------------------------------------
        // First run: GET returns empty, POST creates review id=1
        // -----------------------------------------------------------------------
        let firstPostInput;
        const firstRunStub = makeGhExecaStub({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            apiRoutes: [
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "GET",
                    response: { stdout: JSON.stringify([]), exitCode: 0 },
                },
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "POST",
                    response: { stdout: JSON.stringify({ id: 1 }), exitCode: 0 },
                    onCall: (input) => { firstPostInput = input; },
                },
            ],
        });
        const firstResult = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: firstRunStub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(firstResult.next).toBe("posted");
        if (firstResult.next !== "posted")
            return;
        // First run: POST path
        expect(firstResult.wasEdit).toBe(false);
        expect(firstResult.priorReviewId).toBeNull();
        expect(firstResult.postedReviewId).toBe(1);
        expect(firstResult.inlineCommentCount).toBe(0); // not null on POST path
        // First run body has footer marker as last line
        const firstBody = JSON.parse(firstPostInput);
        expect(firstBody.event).toBe("COMMENT");
        expect(firstBody.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        expect(firstBody.body).toContain("standards_version:");
        expect(firstBody.body).toContain("plugin_version:");
        // -----------------------------------------------------------------------
        // Second run: GET returns prior verdict with footer marker → PATCH
        // -----------------------------------------------------------------------
        const priorReviewBody = `# Reviewer summary — ${STORY_REF}\n\n` +
            `**Verdict: READY FOR MERGE**\n\n` +
            `\`standards_version: 1.2.3\` · \`plugin_version: ${PLUGIN_VERSION}\`\n` +
            EXPECTED_FOOTER_MARKER;
        let secondPatchInput;
        const secondRunStub = makeGhExecaStub({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            apiRoutes: [
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "GET",
                    // Include a null-bodied review (Copilot/approval-only shape) — should be skipped
                    response: {
                        stdout: JSON.stringify([
                            { id: 99, body: null },
                            { id: 1, body: priorReviewBody },
                        ]),
                        exitCode: 0,
                    },
                },
                {
                    url: new RegExp(`${REVIEWS_URL_PATTERN}/1$`),
                    method: "PATCH",
                    response: { stdout: JSON.stringify({ id: 1 }), exitCode: 0 },
                    onCall: (input) => { secondPatchInput = input; },
                },
            ],
        });
        const secondResult = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: secondRunStub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(secondResult.next).toBe("posted");
        if (secondResult.next !== "posted")
            return;
        // Second run: PATCH path
        expect(secondResult.wasEdit).toBe(true);
        expect(secondResult.priorReviewId).toBe(1);
        expect(secondResult.postedReviewId).toBe(1);
        expect(secondResult.inlineCommentCount).toBeNull(); // null on PATCH path
        // PATCH body has footer marker as last line
        const patchPayload = JSON.parse(secondPatchInput);
        expect(patchPayload.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
        expect(patchPayload.body).toContain("standards_version:");
        expect(patchPayload.body).toContain("plugin_version:");
        const firstCalls = vi.mocked(firstRunStub).mock.calls;
        const secondCalls = vi.mocked(secondRunStub).mock.calls;
        const firstPostCalls = firstCalls.filter(([cmd, args]) => cmd === "gh" && args?.[0] === "api" && args?.includes("POST"));
        expect(firstPostCalls).toHaveLength(1);
        const secondPatchCalls = secondCalls.filter(([cmd, args]) => cmd === "gh" && args?.[0] === "api" && args?.includes("PATCH"));
        expect(secondPatchCalls).toHaveLength(1);
        const secondPostCalls = secondCalls.filter(([cmd, args]) => cmd === "gh" && args?.[0] === "api" && args?.includes("POST"));
        expect(secondPostCalls).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// Story 4.7: Wrong-ref non-match — different story ref → POST path taken
// ---------------------------------------------------------------------------
describe("(4.7 AC3 3e) Wrong-ref non-match — POST path when prior verdict is for different ref", () => {
    it("GET returns prior verdict for different ref → POST path taken, wasEdit === false", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", {
            1: makeArtifactPassResult(1),
        });
        await writeResultFile(resultData);
        let capturedInput;
        const stub = makeGhExecaStub({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            apiRoutes: [
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "GET",
                    // Prior verdict exists but for a DIFFERENT ref
                    response: {
                        stdout: JSON.stringify([
                            { id: 2, body: `<!-- crew:verdict:1.0.0:native:different-ref -->` },
                        ]),
                        exitCode: 0,
                    },
                },
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "POST",
                    response: { stdout: JSON.stringify({ id: 99 }), exitCode: 0 },
                    onCall: (input) => { capturedInput = input; },
                },
            ],
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        // POST path taken (wrong ref, no match)
        expect(result.wasEdit).toBe(false);
        expect(result.priorReviewId).toBeNull();
        expect(result.postedReviewId).toBe(99);
        // Body was POSTed (not patched)
        expect(capturedInput).toBeDefined();
        const body = JSON.parse(capturedInput);
        expect(body.event).toBe("COMMENT");
        expect(body.body.split("\n").at(-1)).toBe(EXPECTED_FOOTER_MARKER);
    });
});
// ---------------------------------------------------------------------------
// Story 4.7: Null-bodied prior reviews are skipped without error
// ---------------------------------------------------------------------------
describe("(4.7 AC3) Null-bodied prior reviews skipped (Copilot/plain approval shape)", () => {
    it("GET returns [{ id: 99, body: null }, { id: 1, body: '<footer marker>' }] → PATCH targets id 1, not id 99", async () => {
        const resultData = makeReviewerResult("READY FOR MERGE", {
            1: makeArtifactPassResult(1),
        });
        await writeResultFile(resultData);
        const priorBody = `**Verdict: READY FOR MERGE**\n\n` +
            `\`standards_version: 1.2.3\` · \`plugin_version: ${PLUGIN_VERSION}\`\n` +
            EXPECTED_FOOTER_MARKER;
        let patchInput;
        let patchUrl;
        const stub = makeGhExecaStub({
            prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
            apiRoutes: [
                {
                    url: REVIEWS_URL_PATTERN,
                    method: "GET",
                    response: {
                        stdout: JSON.stringify([
                            { id: 99, body: null },
                            { id: 1, body: priorBody },
                        ]),
                        exitCode: 0,
                    },
                },
                {
                    url: new RegExp(`${REVIEWS_URL_PATTERN}/1$`),
                    method: "PATCH",
                    response: { stdout: JSON.stringify({ id: 1 }), exitCode: 0 },
                    onCall: (input, args) => {
                        patchInput = input;
                        patchUrl = args[1];
                    },
                },
            ],
        });
        const result = await postReviewerComments({
            targetRepoRoot: tmpRoot,
            sessionUlid: SESSION_ULID,
            execaImpl: stub,
            pluginRootOverride: pluginRoot,
            pluginVersionOverride: PLUGIN_VERSION,
        });
        expect(result.next).toBe("posted");
        if (result.next !== "posted")
            return;
        // PATCH path — matched id 1, skipped id 99 (null body)
        expect(result.wasEdit).toBe(true);
        expect(result.priorReviewId).toBe(1);
        expect(result.inlineCommentCount).toBeNull();
        // PATCH URL targets review 1
        expect(patchUrl).toContain("/reviews/1");
        expect(patchInput).toBeDefined();
    });
});
