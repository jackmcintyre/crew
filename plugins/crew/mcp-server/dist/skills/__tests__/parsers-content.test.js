/**
 * Content-structure tests for AC5 anchors — Story 4.3 Task 11.2.
 *
 * Reads the source files for the three new parser/cycle modules and asserts
 * that the verbatim anchor strings required by AC5(i)–(iv) are present.
 *
 * AC5(i):   `handoff-parser.ts` exports `HANDOFF_PHRASE_TEMPLATE` with verbatim value.
 * AC5(ii):  `verdict-parser.ts` exports `VERDICT_SENTINELS` containing all three sentinels.
 * AC5(iii): `dev-reviewer-cycle.ts` contains the AC2 chat-line prefix verbatim.
 * AC5(iv):  `dev-reviewer-cycle.ts` contains the AC3 chat-line prefix verbatim.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, ".."); // src/skills/
const HANDOFF_PARSER_FILE = path.join(SKILLS_DIR, "handoff-parser.ts");
const VERDICT_PARSER_FILE = path.join(SKILLS_DIR, "verdict-parser.ts");
const DEV_REVIEWER_CYCLE_FILE = path.join(SKILLS_DIR, "dev-reviewer-cycle.ts");
describe("AC5(i) — handoff-parser.ts content structure", () => {
    let source;
    beforeAll(async () => {
        source = await fs.readFile(HANDOFF_PARSER_FILE, "utf8");
    });
    it("exports HANDOFF_PHRASE_TEMPLATE with the verbatim locked-phrase value", () => {
        // The exact substring the AC requires.
        expect(source).toContain(`HANDOFF_PHRASE_TEMPLATE = "Handoff to reviewer — story <story-id> ready for review."`);
    });
});
describe("AC5(ii) — verdict-parser.ts content structure", () => {
    let source;
    beforeAll(async () => {
        source = await fs.readFile(VERDICT_PARSER_FILE, "utf8");
    });
    it("contains the string 'READY FOR MERGE' as a literal value", () => {
        expect(source).toContain('"READY FOR MERGE"');
    });
    it("contains the string 'NEEDS CHANGES' as a literal value", () => {
        expect(source).toContain('"NEEDS CHANGES"');
    });
    it("contains the string 'BLOCKED' as a literal value", () => {
        expect(source).toContain('"BLOCKED"');
    });
});
describe("AC5(iii) — dev-reviewer-cycle.ts contains AC2 chat-line prefix", () => {
    let source;
    beforeAll(async () => {
        source = await fs.readFile(DEV_REVIEWER_CYCLE_FILE, "utf8");
    });
    it("contains the verbatim AC2 chat-line prefix (minus the closing parenthesis)", () => {
        // AC5(iii) requires: `re-spawning generalist-dev subagent (rework iteration`
        expect(source).toContain("re-spawning generalist-dev subagent (rework iteration");
    });
});
describe("AC5(iv) — dev-reviewer-cycle.ts contains AC3 chat-line prefix", () => {
    let source;
    beforeAll(async () => {
        source = await fs.readFile(DEV_REVIEWER_CYCLE_FILE, "utf8");
    });
    it("contains the verbatim AC3 chat-line prefix", () => {
        // AC5(iv) requires: `handoff grammar drift — story`
        expect(source).toContain("handoff grammar drift — story");
    });
});
