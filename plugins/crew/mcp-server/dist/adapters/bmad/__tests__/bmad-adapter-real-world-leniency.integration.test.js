/**
 * Integration test for BMad adapter leniency against a real-world-shaped
 * fixture (Story 3.8 AC6).
 *
 * The fixture at `fixtures/sample-real-world-repo/` mirrors the organic
 * deviations present in this repo's own BMad backlog:
 *   - `3-1-canonical-story.md`        — happy path (Status: backlog)
 *   - `4-8-no-suffix-followup.md`     — no-suffix companion for sort-order coverage
 *   - `4-8b-follow-up-story.md`       — letter-suffixed story ID (Status: backlog)
 *   - `5-1-no-status.md`              — no Status line (defaults to backlog)
 *   - `5-2-free-text-status.md`       — Status: revised — re-implement per 4.6 retro
 *   - `epic-1-retro-2026-05-20.md`    — non-story file, must be silently skipped
 *   - `sprint-status.yaml`            — non-.md file, must be silently skipped
 *
 * AC6 sub-assertions:
 *   1. listSourceStories() returns exactly 5 stories (bmad:3.1, bmad:4.8,
 *      bmad:4.8b, bmad:5.1, bmad:5.2) — retro and YAML not included.
 *   2. Manifests for bmad:3.1, bmad:4.8, bmad:4.8b, bmad:5.1 land under to-do/.
 *   3. Manifest for bmad:5.2 lands under blocked/.
 *   4. Exactly one warning names 5-2-free-text-status.md and the raw value.
 *   5. No error thrown; scan completes end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { atomicWriteFile } from "../../../lib/managed-fs.js";
import { BmadAdapter, configureBmadAdapter, resetBmadAdapter, } from "../index.js";
import { scanSources } from "../../../tools/scan-sources.js";
import { getStatus, renderStatus } from "../../../tools/get-status.js";
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const FIXTURE_STORIES_ROOT = path.resolve(__dirname, "../fixtures/sample-real-world-repo");
// ---------------------------------------------------------------------------
// Workspace builder
// ---------------------------------------------------------------------------
/**
 * Build a minimal BMad-adapter workspace in a fresh tmpdir, pointing
 * stories_root at the committed fixture (read-only). State writes go to
 * <tmpdir>/repo/.crew/state/ — the fixture directory is never mutated.
 */
async function buildWorkspace(scratch) {
    const root = path.join(scratch, "repo");
    await atomicWriteFile(path.join(root, ".crew", "config.yaml"), [
        "adapter: bmad",
        "adapter_config:",
        // Use the fixture directory as stories_root (absolute path).
        `  stories_root: ${FIXTURE_STORIES_ROOT}`,
    ].join("\n") + "\n");
    return root;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
describe("BMad adapter real-world leniency (Story 3.8 AC6)", () => {
    let scratch = "";
    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-test-3-8-"));
    });
    afterEach(async () => {
        resetBmadAdapter();
        await fs.rm(scratch, { recursive: true, force: true });
    });
    it("AC6 sub-assertion 1: listSourceStories returns exactly 5 stories", async () => {
        configureBmadAdapter({
            targetRepo: path.join(scratch, "repo"),
            storiesRoot: FIXTURE_STORIES_ROOT,
        });
        const stories = await BmadAdapter.listSourceStories();
        const refs = stories.map((s) => s.ref);
        expect(refs).toHaveLength(5);
        expect(refs).toContain("bmad:3.1");
        expect(refs).toContain("bmad:4.8");
        expect(refs).toContain("bmad:4.8b");
        expect(refs).toContain("bmad:5.1");
        expect(refs).toContain("bmad:5.2");
        // Non-story files must NOT appear.
        expect(refs).not.toContain("bmad:epic-1-retro");
        // YAML file excluded (not .md).
        expect(refs.some((r) => r.includes("sprint"))).toBe(false);
    });
    it("AC6 sub-assertions 2-5: scan-sources routes stories correctly", async () => {
        const root = await buildWorkspace(scratch);
        // AC6.5: no error thrown.
        const result = await scanSources({ targetRepoRoot: root });
        // AC6.1: exactly 5 stories (4 in to-do, 1 blocked = 4 created + 1 blocked).
        const totalHandled = result.createdRefs.length + result.blockedRefs.length;
        expect(totalHandled).toBe(5);
        // AC6.2: manifests for 3.1, 4.8, 4.8b, 5.1 land in to-do/.
        expect(await existsInState(root, "to-do", "bmad:3.1")).toBe(true);
        expect(await existsInState(root, "to-do", "bmad:4.8")).toBe(true);
        expect(await existsInState(root, "to-do", "bmad:4.8b")).toBe(true);
        expect(await existsInState(root, "to-do", "bmad:5.1")).toBe(true);
        // AC6.3: manifest for 5.2 lands in blocked/ with blocked_by.
        expect(await existsInState(root, "blocked", "bmad:5.2")).toBe(true);
        const blockedManifest = await readManifest(root, "blocked", "bmad:5.2");
        expect(blockedManifest["blocked_by"]).toBe("status-vocabulary-unknown");
        // Confirm 5.2 is NOT in to-do.
        expect(await existsInState(root, "to-do", "bmad:5.2")).toBe(false);
        // AC6.4: exactly one warning naming 5-2-free-text-status.md and the raw value.
        expect(result.warnings).toHaveLength(1);
        const warning = result.warnings[0];
        expect(warning.path).toContain("5-2-free-text-status.md");
        expect(warning.message).toContain("revised");
        expect(warning.message).toContain("status-vocabulary-unknown");
        // Non-story files produce no manifests.
        expect(await existsInState(root, "to-do", "bmad:epic-1-retro")).toBe(false);
    });
    it("AC6: non-story files (retro, sprint-status.yaml) produce no manifests", async () => {
        const root = await buildWorkspace(scratch);
        await scanSources({ targetRepoRoot: root });
        // Check that no unexpected refs were written.
        const toDoDir = path.join(root, ".crew", "state", "to-do");
        let toDoFiles = [];
        try {
            toDoFiles = await fs.readdir(toDoDir);
        }
        catch {
            // May not exist if zero stories were created (not expected here).
        }
        const toDoRefs = toDoFiles.filter((f) => f.endsWith(".yaml")).map((f) => f.replace(".yaml", ""));
        // Only the 4 expected to-do refs should appear.
        expect(toDoRefs.sort()).toEqual(["bmad:3.1", "bmad:4.8", "bmad:4.8b", "bmad:5.1"].sort());
    });
    it("AC5: detect() returns true when currentContext points at the fixture stories root", async () => {
        const root = path.join(scratch, "repo");
        configureBmadAdapter({
            targetRepo: root,
            storiesRoot: FIXTURE_STORIES_ROOT,
        });
        const detected = await BmadAdapter.detect(root);
        expect(detected).toBe(true);
    });
    it("AC5 negative: detect() returns false when configured storiesRoot is empty", async () => {
        const root = path.join(scratch, "repo");
        const emptyRoot = path.join(scratch, "empty-stories");
        await fs.mkdir(emptyRoot, { recursive: true });
        configureBmadAdapter({ targetRepo: root, storiesRoot: emptyRoot });
        const detected = await BmadAdapter.detect(root);
        expect(detected).toBe(false);
    });
    it("Sort order: bmad:4.8 sorts before bmad:4.8b in listSourceStories", async () => {
        // The fixture now includes both 4-8-no-suffix-followup.md (bmad:4.8) and
        // 4-8b-follow-up-story.md (bmad:4.8b), directly exercising the
        // no-suffix-before-letter-suffix branch in index.ts.
        configureBmadAdapter({
            targetRepo: path.join(scratch, "repo"),
            storiesRoot: FIXTURE_STORIES_ROOT,
        });
        const stories = await BmadAdapter.listSourceStories();
        const refs = stories.map((s) => s.ref);
        // 3.1 < 4.8 < 4.8b < 5.1 — no-suffix sorts before letter-suffix within same numeric.
        const idx31 = refs.indexOf("bmad:3.1");
        const idx48 = refs.indexOf("bmad:4.8");
        const idx48b = refs.indexOf("bmad:4.8b");
        const idx51 = refs.indexOf("bmad:5.1");
        expect(idx31).toBeLessThan(idx48);
        expect(idx48).toBeLessThan(idx48b);
        expect(idx48b).toBeLessThan(idx51);
    });
    // ---------------------------------------------------------------------------
    // AC5 (user-surface): getStatus / renderStatus path — custom storiesRoot
    // must NOT produce "mismatched" label.
    //
    // These tests exercise the full getStatus → resolveWorkspace →
    // validateActiveAdapter → BmadAdapter.detect() chain so that the
    // "adapter: bmad (ok)" / "adapter: bmad (mismatched)" output of
    // /crew:status is directly covered.
    // ---------------------------------------------------------------------------
    it("AC5 positive: getStatus renders 'adapter: bmad (ok)' when custom stories_root contains BMad stories", async () => {
        const root = path.join(scratch, "repo-ac5-pos");
        // Write .crew/config.yaml with an explicit stories_root pointing at the fixture.
        // stories_root must be an absolute path that BmadAdapter.detect() can stat directly.
        await atomicWriteFile(path.join(root, ".crew", "config.yaml"), [
            "adapter: bmad",
            "adapter_config:",
            `  stories_root: ${FIXTURE_STORIES_ROOT}`,
        ].join("\n") + "\n");
        // Pass the real BmadAdapter (no stub) so detect() exercises the AC5 fix.
        const report = await getStatus({ targetRepoRoot: root, adapters: [BmadAdapter] });
        // adapter.state must be "ok" — not "mismatched".
        expect(report.adapter.state).toBe("ok");
        if (report.adapter.state === "ok") {
            expect(report.adapter.name).toBe("bmad");
        }
        // renderStatus must produce the "ok" label, not the "mismatched" label.
        const rendered = renderStatus(report);
        expect(rendered).toContain("adapter: bmad (ok)");
        expect(rendered).not.toContain("adapter: bmad (mismatched)");
    });
    it("AC5 negative: getStatus renders 'adapter: bmad (mismatched)' when custom stories_root is an empty directory", async () => {
        const root = path.join(scratch, "repo-ac5-neg");
        const emptyStoriesRoot = path.join(scratch, "empty-stories-root");
        await fs.mkdir(emptyStoriesRoot, { recursive: true });
        // Write .crew/config.yaml pointing at an empty directory.
        await atomicWriteFile(path.join(root, ".crew", "config.yaml"), [
            "adapter: bmad",
            "adapter_config:",
            `  stories_root: ${emptyStoriesRoot}`,
        ].join("\n") + "\n");
        const report = await getStatus({ targetRepoRoot: root, adapters: [BmadAdapter] });
        // adapter.state must be "mismatched" — the empty dir has no BMad stories.
        expect(report.adapter.state).toBe("mismatched");
        if (report.adapter.state === "mismatched") {
            expect(report.adapter.name).toBe("bmad");
        }
        const rendered = renderStatus(report);
        expect(rendered).toContain("adapter: bmad (mismatched)");
        expect(rendered).not.toContain("adapter: bmad (ok)");
    });
});
