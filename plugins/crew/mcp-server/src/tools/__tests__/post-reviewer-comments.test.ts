/**
 * Integration tests for `postReviewerComments` — Story 4.6b Task 8 (AC4).
 *
 * Fixture: tmpdir with `.crew/config.yaml` and optional
 * `.crew/state/sessions/<sessionUlid>/reviewer-result.json`.
 *
 * The `gh` stub routes by cmd / args[0..1] per the pattern established in
 * `run-reviewer-session.test.ts` (Story 4.6 Issue 2). The shared helper
 * `gh-execa-stub.ts` provides the routing logic.
 *
 * Story 4.6b Task 8.1–8.5.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { postReviewerComments } from "../post-reviewer-comments.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { __resetGhErrorMapCacheForTests } from "../../lib/gh-error-map.js";
import { GhRecoverableError, GhApiResponseShapeError, ReviewerResultFileMalformedError } from "../../errors.js";
import { makeGhExecaStub } from "../../__tests__/test-helpers/gh-execa-stub.js";
import type { ReviewerResultFileShape, AcResult } from "../run-reviewer-session.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ULID = "01HZTEST4_6B_INTEGRATION000";
const STORY_REF = "native:01HZTEST00000000000000000";
const PR_NUMBER = 42;

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
const STANDARDS: Record<string, { name: string; what: string; check: string; anti_criterion: string }> = {
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

function makeArtifactPassResult(index: number): AcResult {
  return {
    index,
    tag: null,
    applicability: "runnable-artifact-check",
    artifactPath: `artifact-${index}.txt`,
    status: "pass",
    reason: `artifact-${index}.txt exists`,
  };
}

function makeArtifactFailResult(index: number, path: string): AcResult {
  return {
    index,
    tag: null,
    applicability: "runnable-artifact-check",
    artifactPath: path,
    status: "fail",
    reason: `artifact: ${path} — ENOENT at ${path}`,
  };
}

function makeManualCheckResult(index: number): AcResult {
  return {
    index,
    tag: null,
    applicability: "manual-check-required",
    reason: `Operator must verify AC${index} manually.`,
  };
}

function makeReviewerResult(
  verdict: "READY FOR MERGE" | "NEEDS CHANGES" | "BLOCKED",
  acResults: Record<number, AcResult> = {},
): ReviewerResultFileShape {
  return {
    sessionUlid: SESSION_ULID,
    ref: STORY_REF,
    recommendedVerdict: verdict,
    acResults,
    standardsByCriterionId: STANDARDS as ReviewerResultFileShape["standardsByCriterionId"],
    sourceStoryRef: STORY_REF,
    prNumber: PR_NUMBER,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot: string;
let pluginRoot: string;

beforeEach(async () => {
  __resetGhErrorMapCacheForTests();

  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "crew-4-6b-int-"));
  pluginRoot = path.join(tmpRoot, "plugin");

  // .crew/config.yaml
  await fs.mkdir(path.join(tmpRoot, ".crew"), { recursive: true });
  await atomicWriteFile(
    path.join(tmpRoot, ".crew", "config.yaml"),
    "adapter: native\nadapter_config: {}\n",
  );

  // Plugin permissions directory with gh-error-map.yaml and reviewer permissions
  await fs.mkdir(path.join(pluginRoot, "permissions"), { recursive: true });

  // gh-error-map.yaml (minimal valid map)
  await atomicWriteFile(
    path.join(pluginRoot, "permissions", "gh-error-map.yaml"),
    `entries:\n  - exit_code: 4\n    stderr_regex: "API rate limit exceeded"\n    class: defer\n`,
  );

  // generalist-reviewer.yaml permissions
  await atomicWriteFile(
    path.join(pluginRoot, "permissions", "generalist-reviewer.yaml"),
    [
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
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeResultFile(data: ReviewerResultFileShape): Promise<void> {
  const sessDir = path.join(tmpRoot, ".crew", "state", "sessions", SESSION_ULID);
  await fs.mkdir(sessDir, { recursive: true });
  await atomicWriteFile(
    path.join(sessDir, "reviewer-result.json"),
    JSON.stringify(data),
  );
}

// ---------------------------------------------------------------------------
// (4c-i) READY FOR MERGE, all-pass
// ---------------------------------------------------------------------------

describe("(4c-i) READY FOR MERGE, all-pass", () => {
  it("gh api body has empty comments array; verdict line is READY FOR MERGE", async () => {
    const resultData = makeReviewerResult("READY FOR MERGE", {
      1: makeArtifactPassResult(1),
      2: makeArtifactPassResult(2),
    });
    await writeResultFile(resultData);

    let capturedInput: string | undefined;
    const stub = makeGhExecaStub({
      prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
      onApiCall: (input) => { capturedInput = input; },
    });

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stub,
      pluginRootOverride: pluginRoot,
    });

    expect(result.next).toBe("posted");
    if (result.next !== "posted") return;

    expect(result.postedReviewId).toBe(12345);
    expect(result.inlineCommentCount).toBe(0);

    // gh api body assertions
    const body = JSON.parse(capturedInput!) as { event: string; body: string; comments: unknown[] };
    expect(body.event).toBe("COMMENT");
    expect(body.comments).toHaveLength(0);

    // Verdict line
    const bodyLines = body.body.split("\n");
    const lastNonEmpty = [...bodyLines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toBe("**Verdict: READY FOR MERGE**");
  });
});

// ---------------------------------------------------------------------------
// (4c-ii) NEEDS CHANGES, failing artifact IN diff
// ---------------------------------------------------------------------------

describe("(4c-ii) NEEDS CHANGES, failing artifact in diff", () => {
  it("comments array has 1 entry with correct path, line, and ENOENT in body", async () => {
    const resultData = makeReviewerResult("NEEDS CHANGES", {
      1: makeArtifactFailResult(1, "src/added-but-missing.ts"),
    });
    await writeResultFile(resultData);

    let capturedInput: string | undefined;
    const stub = makeGhExecaStub({
      prDiff: { stdout: FAKE_DIFF_WITH_ARTIFACT },
      onApiCall: (input) => { capturedInput = input; },
    });

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stub,
      pluginRootOverride: pluginRoot,
    });

    expect(result.next).toBe("posted");
    if (result.next !== "posted") return;

    expect(result.inlineCommentCount).toBe(1);

    const body = JSON.parse(capturedInput!) as {
      event: string;
      body: string;
      comments: Array<{ path: string; line: number; body: string }>;
    };

    expect(body.comments).toHaveLength(1);
    const comment = body.comments[0]!;
    expect(comment.path).toBe("src/added-but-missing.ts");
    expect(comment.line).toBe(1); // @@ -0,0 +1,3 @@ → newStart 1
    expect(comment.body).toContain("ENOENT");
    expect(comment.body).toContain("src/added-but-missing.ts");

    // Verdict line
    const bodyLines = body.body.split("\n");
    const lastNonEmpty = [...bodyLines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toBe("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
  });
});

// ---------------------------------------------------------------------------
// (4c-iii) NEEDS CHANGES, failing artifact NOT in diff
// ---------------------------------------------------------------------------

describe("(4c-iii) NEEDS CHANGES, failing artifact NOT in diff", () => {
  it("comments array is empty; AC still shows ❌ in summary body", async () => {
    const resultData = makeReviewerResult("NEEDS CHANGES", {
      1: makeArtifactFailResult(1, "nonexistent/path.txt"),
    });
    await writeResultFile(resultData);

    let capturedInput: string | undefined;
    const stub = makeGhExecaStub({
      prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
      onApiCall: (input) => { capturedInput = input; },
    });

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stub,
      pluginRootOverride: pluginRoot,
    });

    expect(result.next).toBe("posted");
    if (result.next !== "posted") return;

    expect(result.inlineCommentCount).toBe(0);

    const body = JSON.parse(capturedInput!) as { body: string; comments: unknown[] };
    expect(body.comments).toHaveLength(0);

    // Failing AC should still appear in summary
    expect(body.body).toContain("❌");
    expect(body.body).toContain("nonexistent/path.txt");

    // Verdict line
    const bodyLines = body.body.split("\n");
    const lastNonEmpty = [...bodyLines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toBe("**Verdict: NEEDS CHANGES** [1 issues, 0 questions]");
  });
});

// ---------------------------------------------------------------------------
// (4c-iv) BLOCKED, manual checks required
// ---------------------------------------------------------------------------

describe("(4c-iv) BLOCKED, manual checks required", () => {
  it("comments empty; manual-checks section present; verdict is BLOCKED", async () => {
    const resultData = makeReviewerResult("BLOCKED", {
      1: makeManualCheckResult(1),
      2: makeManualCheckResult(2),
      3: makeArtifactPassResult(3),
    });
    await writeResultFile(resultData);

    let capturedInput: string | undefined;
    const stub = makeGhExecaStub({
      prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
      onApiCall: (input) => { capturedInput = input; },
    });

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stub,
      pluginRootOverride: pluginRoot,
    });

    expect(result.next).toBe("posted");
    if (result.next !== "posted") return;

    expect(result.inlineCommentCount).toBe(0);

    const body = JSON.parse(capturedInput!) as { body: string; comments: unknown[] };
    expect(body.comments).toHaveLength(0);
    expect(body.body).toContain("## Manual checks required before merge");

    const bodyLines = body.body.split("\n");
    const lastNonEmpty = [...bodyLines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toBe("**Verdict: BLOCKED** [manual checks required]");
  });
});

// ---------------------------------------------------------------------------
// (4c-v) BLOCKED, no ACs declared
// ---------------------------------------------------------------------------

describe("(4c-v) BLOCKED, no ACs declared", () => {
  it("AC section shows '_No ACs declared'; verdict is BLOCKED [no ACs declared]", async () => {
    const resultData = makeReviewerResult("BLOCKED", {});
    await writeResultFile(resultData);

    let capturedInput: string | undefined;
    const stub = makeGhExecaStub({
      prDiff: { stdout: FAKE_DIFF_WITHOUT_ARTIFACT },
      onApiCall: (input) => { capturedInput = input; },
    });

    const result = await postReviewerComments({
      targetRepoRoot: tmpRoot,
      sessionUlid: SESSION_ULID,
      execaImpl: stub,
      pluginRootOverride: pluginRoot,
    });

    expect(result.next).toBe("posted");
    if (result.next !== "posted") return;

    const body = JSON.parse(capturedInput!) as { body: string };
    expect(body.body).toContain("_No ACs declared in the source story._");

    const bodyLines = body.body.split("\n");
    const lastNonEmpty = [...bodyLines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toBe("**Verdict: BLOCKED** [no ACs declared]");
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

    await expect(
      postReviewerComments({
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        execaImpl: stub,
        pluginRootOverride: pluginRoot,
      }),
    ).rejects.toBeInstanceOf(GhRecoverableError);
  });
});

// ---------------------------------------------------------------------------
// (4f) Negative: malformed reviewer-result.json
// ---------------------------------------------------------------------------

describe("(4f) Negative: malformed reviewer-result.json", () => {
  it("ReviewerResultFileMalformedError propagates uncaught", async () => {
    const sessDir = path.join(tmpRoot, ".crew", "state", "sessions", SESSION_ULID);
    await fs.mkdir(sessDir, { recursive: true });
    await atomicWriteFile(
      path.join(sessDir, "reviewer-result.json"),
      "NOT VALID JSON {{{ broken",
    );

    const stub = makeGhExecaStub();

    await expect(
      postReviewerComments({
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        execaImpl: stub,
        pluginRootOverride: pluginRoot,
      }),
    ).rejects.toBeInstanceOf(ReviewerResultFileMalformedError);
  });
});

// ---------------------------------------------------------------------------
// (4g) Negative: malformed gh api response
// ---------------------------------------------------------------------------

describe("(4g) Negative: malformed gh api response", () => {
  it("GhApiResponseShapeError raised when gh api returns non-JSON", async () => {
    const resultData = makeReviewerResult("READY FOR MERGE", { 1: makeArtifactPassResult(1) });
    await writeResultFile(resultData);

    const stub = makeGhExecaStub({
      api: { stdout: "THIS IS NOT JSON", exitCode: 0 },
    });

    await expect(
      postReviewerComments({
        targetRepoRoot: tmpRoot,
        sessionUlid: SESSION_ULID,
        execaImpl: stub,
        pluginRootOverride: pluginRoot,
      }),
    ).rejects.toBeInstanceOf(GhApiResponseShapeError);
  });
});
