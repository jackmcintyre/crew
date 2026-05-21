/**
 * Integration tests for `readBacklogInventory` — Story 3.6 HIGH-1 / HIGH-3 fix.
 *
 * These tests verify that the tool:
 *   1. Scans manifests across all four state directories and returns the correct
 *      `backlog_inventory` shape the planner skill prose consumes.
 *   2. Derives `mode: "first-run"` on an empty repo and `mode: "re-open"` when
 *      at least one manifest exists.
 *   3. Includes `withdrawn` flag correctly.
 *   4. On native repos, supplements with `native-source-only` entries for ULID
 *      `.md` files that have no corresponding manifest.
 *   5. Surfaces `MalformedExecutionManifestError` verbatim on a corrupt manifest.
 *   6. Works on a BMad repo (skips native-stories scan).
 *
 * Each test operates against a copy of the committed fixture trees (or a
 * freshly-constructed tmpdir) so the committed fixtures are never mutated.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MalformedExecutionManifestError } from "../../errors.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { readBacklogInventory } from "../read-backlog-inventory.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_FIXTURE = path.resolve(HERE, "..", "..", "adapters", "native", "fixtures", "sample-target-repo");
const BMAD_FIXTURE = path.resolve(HERE, "..", "..", "adapters", "bmad", "fixtures", "sample-target-repo");
let scratch;
beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-read-backlog-inventory-"));
});
afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
});
async function copyFixture(fixturePath) {
    const dest = path.join(scratch, path.basename(fixturePath));
    await fs.cp(fixturePath, dest, { recursive: true });
    return dest;
}
// ---------------------------------------------------------------------------
// (1) mode: "first-run" on an empty native repo
// ---------------------------------------------------------------------------
describe("readBacklogInventory (1) — first-run on empty native repo", () => {
    it('returns mode:"first-run" and empty backlog_inventory when no manifests exist', async () => {
        // Build a minimal native repo with no state manifests.
        const root = path.join(scratch, "empty-native");
        await fs.mkdir(path.join(root, ".crew"), { recursive: true });
        await atomicWriteFile(path.join(root, ".crew", "config.yaml"), "adapter: native\n");
        const result = await readBacklogInventory({ targetRepoRoot: root });
        expect(result.mode).toBe("first-run");
        expect(result.backlog_inventory).toEqual([]);
    });
});
// ---------------------------------------------------------------------------
// (2) mode: "re-open" — manifests across multiple state directories
// ---------------------------------------------------------------------------
describe("readBacklogInventory (2) — re-open: manifests across to-do, in-progress, done", () => {
    it("returns mode:re-open and inventory entries from all populated state dirs", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        expect(result.mode).toBe("re-open");
        // The fixture has manifests in to-do/, in-progress/, and done/.
        const refs = result.backlog_inventory.map((e) => e.ref);
        expect(refs).toContain("native:01HZABC0000000000000000001");
        expect(refs).toContain("native:01HZABC0000000000000000002");
        expect(refs).toContain("native:01HZABC0000000000000000003");
    });
    it("state field in each entry reflects the state directory, not the manifest status field", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        const entry1 = result.backlog_inventory.find((e) => e.ref === "native:01HZABC0000000000000000001");
        const entry2 = result.backlog_inventory.find((e) => e.ref === "native:01HZABC0000000000000000002");
        const entry3 = result.backlog_inventory.find((e) => e.ref === "native:01HZABC0000000000000000003");
        // Manifest file lives in to-do/ → state: "to-do"
        expect(entry1?.state).toBe("to-do");
        // Manifest file lives in in-progress/ → state: "in-progress"
        expect(entry2?.state).toBe("in-progress");
        // Manifest file lives in done/ → state: "done"
        expect(entry3?.state).toBe("done");
    });
});
// ---------------------------------------------------------------------------
// (3) withdrawn flag is surfaced correctly
// ---------------------------------------------------------------------------
describe("readBacklogInventory (3) — withdrawn flag is surfaced correctly", () => {
    it("returns withdrawn:false for normal manifests", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        for (const entry of result.backlog_inventory) {
            if (entry.state !== "native-source-only") {
                expect(entry.withdrawn).toBe(false);
            }
        }
    });
    it("returns withdrawn:true for a manifest that has been flipped", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        // Manually flip the to-do manifest's withdrawn field.
        const manifestPath = path.join(root, ".crew", "state", "to-do", "native:01HZABC0000000000000000001.yaml");
        const raw = await fs.readFile(manifestPath, "utf8");
        const updated = raw.replace("withdrawn: false", "withdrawn: true");
        await atomicWriteFile(manifestPath, updated);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        const entry = result.backlog_inventory.find((e) => e.ref === "native:01HZABC0000000000000000001");
        expect(entry?.withdrawn).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// (4) native-source-only entries for ULID .md files without manifests
// ---------------------------------------------------------------------------
describe("readBacklogInventory (4) — native-source-only entries", () => {
    it("adds native-source-only entries for ULID .md files with no manifest", async () => {
        // Build a native repo with a source story but no manifest.
        const root = path.join(scratch, "source-only-native");
        await fs.mkdir(path.join(root, ".crew", "native-stories"), { recursive: true });
        await atomicWriteFile(path.join(root, ".crew", "config.yaml"), "adapter: native\n");
        const ulid = "01HZABC0000000000000000099";
        const storyPath = path.join(root, ".crew", "native-stories", `${ulid}.md`);
        await atomicWriteFile(storyPath, "# My orphan story\n\n## Narrative\n\nAs a user, I want it.\n");
        const result = await readBacklogInventory({ targetRepoRoot: root });
        expect(result.mode).toBe("re-open");
        const entry = result.backlog_inventory.find((e) => e.ref === `native:${ulid}`);
        expect(entry).toBeDefined();
        expect(entry?.state).toBe("native-source-only");
        expect(entry?.withdrawn).toBe(false);
        expect(entry?.title).toBe("My orphan story");
    });
    it("does NOT add native-source-only entries for ULIDs that already have a manifest", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        // The fixture has source stories 01HZABC000...001, 002, 003 — all have
        // manifests. None should appear as native-source-only.
        const sourceOnlyEntries = result.backlog_inventory.filter((e) => e.state === "native-source-only");
        const fixtureRefs = [
            "native:01HZABC0000000000000000001",
            "native:01HZABC0000000000000000002",
            "native:01HZABC0000000000000000003",
        ];
        for (const entry of sourceOnlyEntries) {
            expect(fixtureRefs).not.toContain(entry.ref);
        }
    });
});
// ---------------------------------------------------------------------------
// (5) MalformedExecutionManifestError surfaces verbatim
// ---------------------------------------------------------------------------
describe("readBacklogInventory (5) — MalformedExecutionManifestError surfaces verbatim", () => {
    it("throws MalformedExecutionManifestError when a manifest fails schema validation", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        // Corrupt the to-do manifest by removing the required `ref` field.
        const manifestPath = path.join(root, ".crew", "state", "to-do", "native:01HZABC0000000000000000001.yaml");
        await atomicWriteFile(manifestPath, "status: to-do\ntitle: broken\n");
        await expect(readBacklogInventory({ targetRepoRoot: root })).rejects.toBeInstanceOf(MalformedExecutionManifestError);
    });
});
// ---------------------------------------------------------------------------
// (6) BMad repo — manifest scanned, no native-source-only entries
// ---------------------------------------------------------------------------
describe("readBacklogInventory (6) — BMad repo scans manifests, skips native-stories", () => {
    it("returns the BMad manifest and does not add native-source-only entries", async () => {
        const root = await copyFixture(BMAD_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        expect(result.mode).toBe("re-open");
        // The BMad fixture has bmad:1.1 in done/.
        const entry = result.backlog_inventory.find((e) => e.ref === "bmad:1.1");
        expect(entry).toBeDefined();
        expect(entry?.state).toBe("done");
        expect(entry?.withdrawn).toBe(false);
        // No native-source-only entries on a BMad repo.
        const sourceOnlyEntries = result.backlog_inventory.filter((e) => e.state === "native-source-only");
        expect(sourceOnlyEntries).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// (7) Shape contract — every entry has the fields the planner skill prose consumes
// ---------------------------------------------------------------------------
describe("readBacklogInventory (7) — shape contract: every entry has ref, title, state, withdrawn", () => {
    it("every backlog_inventory entry is shaped { ref, title, state, withdrawn }", async () => {
        const root = await copyFixture(NATIVE_FIXTURE);
        const result = await readBacklogInventory({ targetRepoRoot: root });
        for (const entry of result.backlog_inventory) {
            expect(typeof entry.ref).toBe("string");
            expect(entry.ref.length).toBeGreaterThan(0);
            expect(typeof entry.title).toBe("string");
            expect(entry.title.length).toBeGreaterThan(0);
            expect(["to-do", "in-progress", "blocked", "done", "native-source-only"]).toContain(entry.state);
            expect(typeof entry.withdrawn).toBe("boolean");
        }
    });
});
