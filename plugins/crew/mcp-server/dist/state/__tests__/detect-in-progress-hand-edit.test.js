/**
 * Unit tests for `detectInProgressHandEdit` — Story 3.7 Task 3.1.
 *
 * Covers AC4 cases (c) and (d):
 *   (c1) hand-edit `title` only → InProgressHandEditError with changedFields:["title"]
 *   (c2) hand-edit `acceptance_criteria` (reorder) → detection via order-sensitive deep-equal
 *   (c3) hand-edit `withdrawn: false → true` → detection (guard treats this like any field)
 *   (c4) source hash drift (no manifest edit, opts.sourceHash differs) → detection with changedFields:["source_hash"]
 *   (d)  no edit, no drift → { ok: true }
 *
 * Each test seeds a tmpdir with an `in-progress/<ref>.yaml` manifest, then
 * either mutates it (to simulate an operator hand-edit) or leaves it intact,
 * then calls `detectInProgressHandEdit` directly.
 *
 * Pure deterministic — no LLM invocation, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { InProgressHandEditError, ManifestNotFoundError, MalformedExecutionManifestError } from "../../errors.js";
import { detectInProgressHandEdit } from "../manifest-state-machine.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REF = "native:01HZTEST0000000000000001";
/**
 * Canonical manifest content that matches a given sourceHash and sourceFields.
 * This is what scan-sources would write — the "canonical baseline".
 */
function makeManifest(sourceHash, sourceFields) {
    return {
        ref: REF,
        status: "to-do",
        adapter: "native",
        source_path: ".crew/native-stories/01HZTEST0000000000000000001.md",
        source_hash: sourceHash,
        depends_on: sourceFields.depends_on,
        acceptance_criteria: sourceFields.acceptance_criteria,
        title: sourceFields.title,
        narrative: sourceFields.narrative,
        implementation_notes: sourceFields.implementation_notes,
        withdrawn: sourceFields.withdrawn,
    };
}
const CANONICAL_SOURCE_HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const CANONICAL_SOURCE_FIELDS = {
    title: "My feature story",
    narrative: "As a user, I want the feature so that I can use it.",
    acceptance_criteria: [
        {
            text: "Given the feature is live, when I access it, then it works correctly.",
            kind: "integration",
        },
        {
            text: "Given I am logged in, when I click the button, then the result appears.",
            kind: "unit",
        },
    ],
    implementation_notes: "Wire up the handler in the main module.",
    depends_on: ["native:01HZPREV0000000000000001"],
    withdrawn: false,
};
async function seedInProgressManifest(root, manifest) {
    const dir = path.join(root, ".crew", "state", "in-progress");
    await fs.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${REF}.yaml`);
    const text = yamlStringify(manifest, { lineWidth: 0 });
    await atomicWriteFile(absPath, text);
    return absPath;
}
async function mutateManifest(absPath, mutate) {
    const raw = await fs.readFile(absPath, "utf8");
    const obj = yamlParse(raw);
    mutate(obj);
    const newText = yamlStringify(obj, { lineWidth: 0 });
    // Simulate operator writing (editor-style) via atomicWriteFile — the canonical
    // write primitive available to test code inside src test directories.
    // (Note: the static guard in canonical-fs-guard.test.ts bans direct write-shaped
    // node:fs imports; this code uses atomicWriteFile from managed-fs instead.)
    await atomicWriteFile(absPath, newText);
}
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let scratch;
beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-detect-inprogress-"));
});
afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
});
// ---------------------------------------------------------------------------
// (c1) hand-edit title only
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit (c1) — hand-edit title only", () => {
    it("throws InProgressHandEditError with changedFields:[title]", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        const absPath = await seedInProgressManifest(scratch, manifest);
        // Operator edits the title in their text editor.
        await mutateManifest(absPath, (obj) => {
            obj["title"] = "My feature story — EDITED";
        });
        const err = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(InProgressHandEditError);
        const typed = err;
        expect(typed.changedFields).toContain("title");
        expect(typed.changedFields).toHaveLength(1);
        expect(typed.ref).toBe(REF);
        expect(typed.absPath).toBe(absPath);
        // Verify verbatim AC3 diagnostic shape.
        expect(typed.message).toMatch(/^Refusing: .+ in in-progress\/ has been hand-edited \(fields: .+\)\./);
        expect(typed.message).toContain("v1 does not support editing stories mid-flight");
        expect(typed.message).toContain("/crew:plan");
    });
});
// ---------------------------------------------------------------------------
// (c2) hand-edit acceptance_criteria (reorder) — order-sensitive deep-equal
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit (c2) — acceptance_criteria reorder detected", () => {
    it("throws InProgressHandEditError with changedFields:[acceptance_criteria]", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        // Operator swaps the two ACs — changing their order.
        const absPath = path.join(scratch, ".crew", "state", "in-progress", `${REF}.yaml`);
        await mutateManifest(absPath, (obj) => {
            const acs = obj["acceptance_criteria"];
            // Reverse the AC order.
            obj["acceptance_criteria"] = [acs[1], acs[0]];
        });
        const err = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(InProgressHandEditError);
        const typed = err;
        expect(typed.changedFields).toContain("acceptance_criteria");
    });
});
// ---------------------------------------------------------------------------
// (c3) hand-edit withdrawn: false → true
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit (c3) — withdrawn flip detected", () => {
    it("throws InProgressHandEditError with changedFields:[withdrawn]", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        const absPath = path.join(scratch, ".crew", "state", "in-progress", `${REF}.yaml`);
        await mutateManifest(absPath, (obj) => {
            obj["withdrawn"] = true;
        });
        const err = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(InProgressHandEditError);
        const typed = err;
        expect(typed.changedFields).toContain("withdrawn");
    });
});
// ---------------------------------------------------------------------------
// (c4) source hash drift (no manifest edit, opts.sourceHash differs)
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit (c4) — source hash drift detected", () => {
    it("throws InProgressHandEditError with changedFields:[source_hash]", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        // Supply a DIFFERENT sourceHash to simulate source story content change.
        const driftedHash = "ffff1111ffff1111ffff1111ffff1111ffff1111ffff1111ffff1111ffff1111";
        const err = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: driftedHash,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(InProgressHandEditError);
        const typed = err;
        expect(typed.changedFields).toContain("source_hash");
    });
});
// ---------------------------------------------------------------------------
// (d) no edit, no drift → { ok: true }
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit (d) — no edit, no drift → { ok: true }", () => {
    it("returns { ok: true } when manifest matches source fields exactly", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        const result = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        });
        expect(result).toEqual({ ok: true });
    });
});
// ---------------------------------------------------------------------------
// ManifestNotFoundError when ref not in in-progress/
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit — non-existent ref", () => {
    it("throws ManifestNotFoundError when the manifest file does not exist", async () => {
        await expect(detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: "native:does-not-exist",
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        })).rejects.toBeInstanceOf(ManifestNotFoundError);
    });
});
// ---------------------------------------------------------------------------
// field list in error is alphabetically sorted (determinism)
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit — alphabetically sorted field list in error", () => {
    it("changedFields list in error message is sorted alphabetically", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        const absPath = path.join(scratch, ".crew", "state", "in-progress", `${REF}.yaml`);
        // Edit title and narrative simultaneously.
        await mutateManifest(absPath, (obj) => {
            obj["title"] = "Edited title";
            obj["narrative"] = "Edited narrative";
        });
        const err = await detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(InProgressHandEditError);
        const typed = err;
        expect(typed.changedFields).toContain("title");
        expect(typed.changedFields).toContain("narrative");
        // The message should list fields in alphabetical order.
        const fieldListMatch = typed.message.match(/\(fields: ([^)]+)\)/);
        expect(fieldListMatch).not.toBeNull();
        const fields = fieldListMatch[1].split(", ");
        const sorted = [...fields].sort();
        expect(fields).toEqual(sorted);
    });
});
// ---------------------------------------------------------------------------
// MalformedExecutionManifestError propagates unchanged
// ---------------------------------------------------------------------------
describe("detectInProgressHandEdit — malformed manifest propagates MalformedExecutionManifestError", () => {
    it("throws MalformedExecutionManifestError when the in-progress manifest is invalid", async () => {
        const manifest = makeManifest(CANONICAL_SOURCE_HASH, CANONICAL_SOURCE_FIELDS);
        await seedInProgressManifest(scratch, manifest);
        const absPath = path.join(scratch, ".crew", "state", "in-progress", `${REF}.yaml`);
        // Remove the required `title` field to make the manifest malformed.
        await mutateManifest(absPath, (obj) => {
            delete obj["title"];
        });
        await expect(detectInProgressHandEdit({
            targetRepoRoot: scratch,
            ref: REF,
            sourceHash: CANONICAL_SOURCE_HASH,
            sourceFields: CANONICAL_SOURCE_FIELDS,
        })).rejects.toBeInstanceOf(MalformedExecutionManifestError);
    });
});
