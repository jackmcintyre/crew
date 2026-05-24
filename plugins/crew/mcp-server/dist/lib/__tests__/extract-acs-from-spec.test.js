/**
 * Unit tests for extract-acs-from-spec.ts.
 * (Story 4.4 Task 3.3 / AC3i)
 */
import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { extractAcsFromSpec } from "../extract-acs-from-spec.js";
// Fixture spec: three ACs — one (user-surface), one untagged, one (integration).
const FIXTURE_SPEC = `
# Story 4.4: Dev terminal action

Status: ready-for-dev

## Acceptance Criteria

**AC1 (user-surface):**
Given a user-facing feature,
When the action completes,
Then the result is visible.

**AC2:**
Given an untagged acceptance criterion,
When implemented,
Then the system behaves correctly.

**AC3 (integration):**
vitest runs the terminal action against a fixture repo.
`;
// Fixture spec with gaps (AC1, AC3, AC4 — no AC2).
const FIXTURE_GAP_SPEC = `
## Acceptance Criteria

**AC1:**
First criterion.

**AC3 (integration):**
Third criterion — note the gap.

**AC4:**
Fourth criterion.
`;
// Fixture with blank lines between heading and body.
const FIXTURE_BLANK_LINE_SPEC = `
## Acceptance Criteria

**AC1:**

Body after blank line.

**AC2 (user-surface):**

Second body.
`;
async function writeTmp(content) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-acs-"));
    const filePath = path.join(dir, "spec.md");
    await atomicWriteFile(filePath, content);
    return filePath;
}
describe("extractAcsFromSpec", () => {
    it("AC3i: extracts three ACs in numeric order from a mixed-tag spec", async () => {
        const specPath = await writeTmp(FIXTURE_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs).toHaveLength(3);
        expect(acs[0].index).toBe(1);
        expect(acs[1].index).toBe(2);
        expect(acs[2].index).toBe(3);
    });
    it("AC3i: extracts first non-blank line of each AC body", async () => {
        const specPath = await writeTmp(FIXTURE_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        // AC1 body first line (after the heading line "Given a user-facing feature,")
        expect(acs[0].firstLine).toBe("Given a user-facing feature,");
        // AC2
        expect(acs[1].firstLine).toBe("Given an untagged acceptance criterion,");
        // AC3
        expect(acs[2].firstLine).toBe("vitest runs the terminal action against a fixture repo.");
    });
    // ---------------------------------------------------------------------------
    // Story 4.6 Task 1.5: tag and body fields
    // ---------------------------------------------------------------------------
    it("Story 4.6: extracts parenthetical tag from AC heading (user-surface, integration, null for untagged)", async () => {
        const specPath = await writeTmp(FIXTURE_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs[0].tag).toBe("user-surface"); // **AC1 (user-surface):**
        expect(acs[1].tag).toBeNull(); // **AC2:**
        expect(acs[2].tag).toBe("integration"); // **AC3 (integration):**
    });
    it("Story 4.6: body array contains verbatim lines after heading until next AC heading", async () => {
        const specPath = await writeTmp(FIXTURE_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        // AC1 body lines (verbatim)
        expect(acs[0].body.some(l => l.includes("Given a user-facing feature,"))).toBe(true);
        expect(acs[0].body.some(l => l.includes("When the action completes,"))).toBe(true);
        expect(acs[0].body.some(l => l.includes("Then the result is visible."))).toBe(true);
        // AC3 body
        expect(acs[2].body.some(l => l.includes("vitest runs the terminal action"))).toBe(true);
    });
    it("Story 4.6: body field on AC with no body lines returns empty-ish array", async () => {
        const spec = `## ACs\n\n**AC1:**\n\n**AC2:**\nSome body.\n`;
        const specPath = await writeTmp(spec);
        const acs = await extractAcsFromSpec(specPath);
        // AC1 has no body before AC2 heading
        expect(acs[0].body.every(l => l.trim() === "")).toBe(true);
        // AC2 has a body
        expect(acs[1].body.some(l => l.includes("Some body."))).toBe(true);
    });
    it("Story 4.6: body contains artifact: marker line verbatim (needed by classifier)", async () => {
        const spec = `## ACs\n\n**AC1:**\nGiven something.\nartifact: hello-a.txt\n\n**AC2:**\nSecond.\n`;
        const specPath = await writeTmp(spec);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs[0].body.some(l => l.trim() === "artifact: hello-a.txt")).toBe(true);
    });
    it("handles gaps in AC numbering — emits in order they appear", async () => {
        const specPath = await writeTmp(FIXTURE_GAP_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs).toHaveLength(3);
        expect(acs.map((a) => a.index)).toEqual([1, 3, 4]);
        expect(acs[0].firstLine).toBe("First criterion.");
        expect(acs[1].firstLine).toBe("Third criterion — note the gap.");
        expect(acs[2].firstLine).toBe("Fourth criterion.");
    });
    it("skips blank lines between heading and body", async () => {
        const specPath = await writeTmp(FIXTURE_BLANK_LINE_SPEC);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs).toHaveLength(2);
        expect(acs[0].firstLine).toBe("Body after blank line.");
        expect(acs[1].firstLine).toBe("Second body.");
    });
    it("truncates firstLine to 120 chars", async () => {
        const longLine = "A".repeat(200);
        const spec = `## ACs\n\n**AC1:**\n${longLine}\n`;
        const specPath = await writeTmp(spec);
        const acs = await extractAcsFromSpec(specPath);
        expect(acs[0].firstLine.length).toBe(120);
    });
    it("returns empty array for a spec with no ACs", async () => {
        const specPath = await writeTmp("# No ACs here\n\nJust some prose.\n");
        const acs = await extractAcsFromSpec(specPath);
        expect(acs).toHaveLength(0);
    });
});
