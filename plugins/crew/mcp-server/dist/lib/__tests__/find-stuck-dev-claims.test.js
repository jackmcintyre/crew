/**
 * Tests for `findStuckDevClaims` — Story 4.12 AC4 (NFR3).
 *
 * vitest: 30-min dev budget surfaces in next poll
 * vitest: per-invocation-telemetry
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { findStuckDevClaims, DEV_BUDGET_MS_DEFAULT, } from "../find-stuck-dev-claims.js";
import { atomicWriteFile } from "../managed-fs.js";
let tmpRoot;
beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-find-stuck-" + crypto.randomUUID() + "-"));
});
afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});
async function seedManifest(opts) {
    const dir = path.join(tmpRoot, ".crew", "state", "in-progress");
    await fs.mkdir(dir, { recursive: true });
    const manifest = {
        ref: opts.ref,
        status: "in-progress",
        adapter: "native",
        source_path: ".crew/native-stories/" + opts.ref + ".yaml",
        source_hash: "a".repeat(64),
        depends_on: [],
        acceptance_criteria: [
            { text: "Given x, when y, then z.", kind: "integration" },
        ],
        title: "T",
        narrative: "N",
        withdrawn: false,
    };
    if (opts.withClaimedBy !== false) {
        manifest["claimed_by"] = "01HZSESSION00000000000001";
    }
    if (opts.claimedAt !== undefined) {
        manifest["claimed_at"] = opts.claimedAt;
    }
    await atomicWriteFile(path.join(dir, opts.ref + ".yaml"), yamlStringify(manifest, { lineWidth: 0 }));
}
describe("findStuckDevClaims — 30-min dev budget surfaces in next poll", () => {
    it("returns [] when in-progress directory is absent (per-invocation-telemetry)", async () => {
        const result = await findStuckDevClaims({ targetRepoRoot: tmpRoot });
        expect(result).toEqual([]);
    });
    it("surfaces a claim aged 31 min past the default 30-min dev budget surfaces in next poll", async () => {
        const now = new Date("2026-05-25T12:00:00.000Z");
        const claimedAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString();
        await seedManifest({ ref: "native-A", claimedAt });
        const result = await findStuckDevClaims({
            targetRepoRoot: tmpRoot,
            now: () => now,
        });
        expect(result).toHaveLength(1);
        expect(result[0].ref).toBe("native-A");
        expect(result[0].elapsedMs).toBe(31 * 60 * 1000);
        expect(result[0].budgetMs).toBe(DEV_BUDGET_MS_DEFAULT);
        expect(result[0].sessionUlid).toBe("01HZSESSION00000000000001");
    });
    it("does not surface a fresh claim (5 min) on the 30-min dev budget", async () => {
        const now = new Date("2026-05-25T12:00:00.000Z");
        const claimedAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
        await seedManifest({ ref: "native-A", claimedAt });
        const result = await findStuckDevClaims({
            targetRepoRoot: tmpRoot,
            now: () => now,
        });
        expect(result).toEqual([]);
    });
    it("excludes pre-this-story manifests with no claimed_at", async () => {
        await seedManifest({ ref: "native-A", claimedAt: undefined });
        const result = await findStuckDevClaims({ targetRepoRoot: tmpRoot });
        expect(result).toEqual([]);
    });
    it("strict greater-than: a claim exactly at budget is NOT stuck", async () => {
        const now = new Date("2026-05-25T12:00:00.000Z");
        const claimedAt = new Date(now.getTime() - DEV_BUDGET_MS_DEFAULT).toISOString();
        await seedManifest({ ref: "native-A", claimedAt });
        const result = await findStuckDevClaims({
            targetRepoRoot: tmpRoot,
            now: () => now,
        });
        expect(result).toEqual([]);
    });
    it("sorts results lexicographically by ref", async () => {
        const now = new Date("2026-05-25T12:00:00.000Z");
        const old = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
        await seedManifest({ ref: "native-C", claimedAt: old });
        await seedManifest({ ref: "native-A", claimedAt: old });
        await seedManifest({ ref: "native-B", claimedAt: old });
        const result = await findStuckDevClaims({
            targetRepoRoot: tmpRoot,
            now: () => now,
        });
        expect(result.map((r) => r.ref)).toEqual([
            "native-A",
            "native-B",
            "native-C",
        ]);
    });
    it("respects a custom budgetMs (1 hour, 31 min claim → not stuck)", async () => {
        const now = new Date("2026-05-25T12:00:00.000Z");
        const claimedAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString();
        await seedManifest({ ref: "native-A", claimedAt });
        const result = await findStuckDevClaims({
            targetRepoRoot: tmpRoot,
            budgetMs: 60 * 60 * 1000,
            now: () => now,
        });
        expect(result).toEqual([]);
    });
});
