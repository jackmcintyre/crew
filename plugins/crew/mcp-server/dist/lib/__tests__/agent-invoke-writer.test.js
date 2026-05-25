/**
 * Tests for `writeAgentInvokeEvent` and the `processDevTranscript`
 * integration of agent.invoke + reviewer.verdict events.
 *
 * vitest: agent.invoke event written on dev spawn
 * vitest: reviewer.verdict event written on post
 * vitest: per-invocation-telemetry
 * vitest: SessionQuotaExhaustedError classified from transcript
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAgentInvokeEvent } from "../agent-invoke-writer.js";
import { writeReviewerVerdictEvent } from "../reviewer-verdict-writer.js";
import { detectSessionQuotaExhausted } from "../session-quota-detector.js";
let tmpRoot;
beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crew-agent-invoke-" + crypto.randomUUID() + "-"));
});
afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});
async function readTelemetry() {
    const dir = path.join(tmpRoot, ".crew", "telemetry");
    let entries;
    try {
        entries = await fs.readdir(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const file of entries.sort()) {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        for (const line of raw.split("\n")) {
            if (!line.trim())
                continue;
            out.push(JSON.parse(line));
        }
    }
    return out;
}
describe("agent.invoke event written on dev spawn (per-invocation-telemetry)", () => {
    it("writes one agent.invoke event with runtime_ms and required fields", async () => {
        await writeAgentInvokeEvent({
            targetRepoRoot: tmpRoot,
            sessionUlid: "01HZSESSION00000000000001",
            agent: "generalist-dev",
            ref: "native:01J9P0K2N3MZX0YV4S5RTQ4ABC",
            runtimeMs: 4500,
            now: () => new Date("2026-05-25T12:00:00.000Z"),
        });
        const events = await readTelemetry();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: "agent.invoke",
            agent: "generalist-dev",
            session_id: "01HZSESSION00000000000001",
            story_id: "native:01J9P0K2N3MZX0YV4S5RTQ4ABC",
            data: { runtime_ms: 4500 },
        });
    });
});
describe("reviewer.verdict event written on post (per-invocation-telemetry)", () => {
    it("writes one reviewer.verdict event with all required data fields", async () => {
        await writeReviewerVerdictEvent({
            targetRepoRoot: tmpRoot,
            sessionUlid: "01HZSESSION00000000000001",
            ref: "native:01J9P0K2N3MZX0YV4S5RTQ4ABC",
            prNumber: 42,
            verdict: "READY FOR MERGE",
            standardsVersion: "1.0.0",
            pluginVersion: "0.4.12",
            now: () => new Date("2026-05-25T12:00:00.000Z"),
        });
        const events = await readTelemetry();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: "reviewer.verdict",
            agent: "generalist-reviewer",
            story_id: "native:01J9P0K2N3MZX0YV4S5RTQ4ABC",
            data: {
                pr_number: 42,
                verdict: "READY FOR MERGE",
                standards_version: "1.0.0",
                plugin_version: "0.4.12",
                eventual_merge_action: null,
            },
        });
    });
    it("preserves the spaced verdict literal NEEDS CHANGES", async () => {
        await writeReviewerVerdictEvent({
            targetRepoRoot: tmpRoot,
            sessionUlid: "01HZSESSION00000000000002",
            ref: "native:abc",
            prNumber: 1,
            verdict: "NEEDS CHANGES",
            standardsVersion: "1.0.0",
            pluginVersion: "0.4.12",
        });
        const events = await readTelemetry();
        const data = events[0]["data"];
        expect(data.verdict).toBe("NEEDS CHANGES");
    });
});
describe("SessionQuotaExhaustedError classified from transcript", () => {
    it("detectSessionQuotaExhausted matches the canonical 'You've hit your session limit' string", () => {
        expect(detectSessionQuotaExhausted("Some output\nYou've hit your session limit\nmore")).toBe(true);
    });
    it("matches account-limit variant", () => {
        expect(detectSessionQuotaExhausted("You've hit your account limit")).toBe(true);
    });
    it("matches without curly apostrophe", () => {
        expect(detectSessionQuotaExhausted("You have hit your session limit")).toBe(true);
    });
    it("does not match unrelated text", () => {
        expect(detectSessionQuotaExhausted("normal output, no quota")).toBe(false);
        expect(detectSessionQuotaExhausted("")).toBe(false);
    });
});
