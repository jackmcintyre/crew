/**
 * Integration test for the BMad adapter's LLM-fallback extraction path
 * (Story 3.9). Three fixture stories under
 * `fixtures/sample-llm-fallback-repo/`:
 *
 *   - `3-1-clean-story.md`        — parses via regex; LLM mock NOT called.
 *   - `3-2-drifted-em-dash-acs.md` — regex fails, LLM fallback returns a
 *                                    valid `SourceStory`; manifest written
 *                                    to `to-do/`.
 *   - `3-3-genuinely-broken.md`   — regex fails, LLM mock returns garbage;
 *                                    routed to `blocked/` with
 *                                    `blocked_by: "unparseable"`.
 *
 * The Anthropic SDK is mocked via the `getAnthropicClient` seam in
 * `src/lib/anthropic-client.ts` — no live API calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { atomicWriteFile } from "../../../lib/managed-fs.js";
// The static fs-write guard (`tests/canonical-fs-guard.test.ts`) forbids
// any `src/**` file from importing a write-shaped `node:fs` API. We use
// `atomicWriteFile` for the one place we need to write a fresh fixture
// inside a tmpdir.
import { BmadAdapter, configureBmadAdapter, resetBmadAdapter, listSourceStoriesResilient, } from "../index.js";
import { scanSources } from "../../../tools/scan-sources.js";
// --- Mock the Anthropic client seam. -----------------------------------------
//
// We mock the wrapper rather than the SDK so the test contract is "the
// extractor gets the structured client we hand it". The mock decides
// what each call returns based on the file contents passed in.
const callLog = [];
vi.mock("../../../lib/anthropic-client.js", () => {
    return {
        hasAnthropicKey: () => true,
        getAnthropicClient: () => ({
            async createMessage(opts) {
                callLog.push({ model: opts.model, userText: opts.userText });
                // The drifted story's content includes "drifted" — return a valid
                // SourceStory JSON for it. For the genuinely-broken file (no
                // BMad shape), return non-JSON to force the fallback to fail.
                if (opts.userText.includes("3-2-drifted-em-dash-acs.md")) {
                    return {
                        text: JSON.stringify({
                            ref: "bmad:3.2",
                            title: "Drifted story with em-dash AC headings",
                            narrative: "As a plugin operator, I want a story whose AC headings drift, so that the LLM fallback can recover it.",
                            acceptance_criteria: [
                                { text: "Recovered AC1 body", kind: "integration" },
                                { text: "Recovered AC2 body", kind: "unit" },
                            ],
                            depends_on: [],
                            implementation_notes: "Drifted file recovered by LLM fallback.",
                        }),
                        stopReason: "end_turn",
                    };
                }
                // Default (genuinely-broken): return garbage so the extractor fails.
                return { text: "not-json-at-all", stopReason: "end_turn" };
            },
        }),
    };
});
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const FIXTURE_STORIES_ROOT = path.resolve(__dirname, "../fixtures/sample-llm-fallback-repo");
// ---------------------------------------------------------------------------
// Workspace builder
// ---------------------------------------------------------------------------
async function buildWorkspace(scratch) {
    const root = path.join(scratch, "repo");
    await atomicWriteFile(path.join(root, ".crew", "config.yaml"), [
        "adapter: bmad",
        "adapter_config:",
        `  stories_root: ${FIXTURE_STORIES_ROOT}`,
    ].join("\n") + "\n");
    return root;
}
async function existsInState(root, stateName, ref) {
    try {
        await fs.stat(path.join(root, ".crew", "state", stateName, `${ref}.yaml`));
        return true;
    }
    catch {
        return false;
    }
}
async function readManifest(root, stateName, ref) {
    const raw = await fs.readFile(path.join(root, ".crew", "state", stateName, `${ref}.yaml`), "utf8");
    return yamlParse(raw);
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BMad adapter LLM fallback (Story 3.9)", () => {
    let scratch = "";
    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-test-3-9-"));
        callLog.length = 0;
    });
    afterEach(async () => {
        resetBmadAdapter();
        await fs.rm(scratch, { recursive: true, force: true });
    });
    it("clean story parses via regex; LLM mock is NOT invoked", async () => {
        configureBmadAdapter({
            targetRepo: path.join(scratch, "repo"),
            storiesRoot: FIXTURE_STORIES_ROOT,
        });
        const result = await listSourceStoriesResilient();
        const cleanStory = result.stories.find((s) => s.ref === "bmad:3.1");
        expect(cleanStory).toBeDefined();
        // The drifted file in the same fixture WILL trigger the mock, so we
        // can't assert zero total calls here. Instead, assert that no call
        // mentioned the clean file's filename.
        const cleanCalls = callLog.filter((c) => c.userText.includes("3-1-clean-story.md"));
        expect(cleanCalls).toHaveLength(0);
    });
    it("drifted story is recovered by the LLM fallback; manifest in to-do/", async () => {
        const root = await buildWorkspace(scratch);
        const result = await scanSources({ targetRepoRoot: root });
        // The drifted story should be in extractedByLlmRefs.
        expect(result.extractedByLlmRefs).toContain("bmad:3.2");
        expect(result.createdRefs).toContain("bmad:3.2");
        expect(await existsInState(root, "to-do", "bmad:3.2")).toBe(true);
        // The LLM mock was called exactly once for the drifted file.
        const driftedCalls = callLog.filter((c) => c.userText.includes("3-2-drifted-em-dash-acs.md"));
        expect(driftedCalls).toHaveLength(1);
    });
    it("genuinely-broken file fails both paths; routed to blocked/ with blocked_by: unparseable", async () => {
        const root = await buildWorkspace(scratch);
        const result = await scanSources({ targetRepoRoot: root });
        // The broken file should appear in unparseableRefs AND blockedRefs.
        const expectedRef = "bmad:3.3";
        expect(result.unparseableRefs).toContain(expectedRef);
        expect(result.blockedRefs).toContain(expectedRef);
        expect(await existsInState(root, "blocked", expectedRef)).toBe(true);
        const blocked = await readManifest(root, "blocked", expectedRef);
        expect(blocked["blocked_by"]).toBe("unparseable");
        // A warning was emitted naming the file.
        const warning = result.warnings.find((w) => w.path.includes("3-3-genuinely-broken.md"));
        expect(warning).toBeDefined();
        expect(warning.message).toContain("unparseable");
        // Scan completes — clean story is still in to-do/.
        expect(await existsInState(root, "to-do", "bmad:3.1")).toBe(true);
    });
    it("renderScanResult surfaces extracted-by-llm and unparseable lines", async () => {
        const root = await buildWorkspace(scratch);
        const result = await scanSources({ targetRepoRoot: root });
        const { renderScanResult } = await import("../../../tools/scan-sources.js");
        const rendered = renderScanResult(result);
        expect(rendered).toContain("extracted-by-llm:");
        expect(rendered).toContain("bmad:3.2");
        expect(rendered).toContain("unparseable:");
        expect(rendered).toContain("bmad:3.3");
    });
    it("cache: a successfully-extracted drifted story is cached and triggers zero new calls on re-scan", async () => {
        const root = await buildWorkspace(scratch);
        await scanSources({ targetRepoRoot: root });
        const driftedCallsFirst = callLog.filter((c) => c.userText.includes("3-2-drifted-em-dash-acs.md")).length;
        expect(driftedCallsFirst).toBe(1);
        // Second scan — drifted file is still drifted, regex still fails, BUT
        // the LLM extraction-cache (keyed by source_hash) should short-circuit
        // the model call. The genuinely-broken file is NOT cached (extraction
        // failed) so it still calls the model — that's the intended design.
        await scanSources({ targetRepoRoot: root });
        const driftedCallsTotal = callLog.filter((c) => c.userText.includes("3-2-drifted-em-dash-acs.md")).length;
        expect(driftedCallsTotal).toBe(1);
    });
    it("skip-done filter: a Status: done file is not parsed and not extracted", async () => {
        // Author a tmp fixture with a single Status: done file alongside one
        // drifted file. The done file must be entirely skipped at the walk.
        const tmpStories = await fs.mkdtemp(path.join(os.tmpdir(), "crew-test-3-9-done-"));
        try {
            await atomicWriteFile(path.join(tmpStories, "9-1-done-story.md"), [
                "# Story 9.1: Done story",
                "",
                "Status: done",
                "",
                "## Story",
                "",
                "Should be skipped at the directory walk.",
                "",
                "## Acceptance Criteria",
                "",
                "**AC1 (integration):**",
                "",
                "Done — does not matter.",
                "",
                "## Dev Notes",
                "",
                "n/a",
            ].join("\n"));
            configureBmadAdapter({
                targetRepo: path.join(scratch, "repo"),
                storiesRoot: tmpStories,
            });
            const before = callLog.length;
            const result = await listSourceStoriesResilient();
            expect(result.stories.find((s) => s.ref === "bmad:9.1")).toBeUndefined();
            expect(result.skippedDone).toBeGreaterThanOrEqual(1);
            // No new LLM calls for the done file.
            const newCalls = callLog.slice(before);
            expect(newCalls.filter((c) => c.userText.includes("9-1-done-story.md"))).toHaveLength(0);
        }
        finally {
            await fs.rm(tmpStories, { recursive: true, force: true });
        }
    });
});
it("BmadAdapter exports listSourceStoriesResilient", () => {
    // Sanity: the new helper is reachable via the adapter index.
    expect(typeof BmadAdapter).toBe("object");
    expect(typeof listSourceStoriesResilient).toBe("function");
});
