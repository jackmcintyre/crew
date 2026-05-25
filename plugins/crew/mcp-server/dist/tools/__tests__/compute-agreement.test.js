/**
 * MCP-tool-boundary tests for `computeAgreement` (Story 4.10 AC4k).
 *
 * Drives the tool through the registered MCP server with an in-memory
 * transport. Asserts:
 *   - Input validation rejects non-positive / wrong-type `lastNVerdicts`.
 *   - Valid input returns the helper's output as JSON.stringify text.
 *   - The `null` branch is rendered as the literal text "null".
 *   - The registered tool name is exactly `computeAgreement`.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, ListToolsResultSchema, } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../server.js";
import { atomicWriteFile } from "../../lib/managed-fs.js";
import { registerAllTools } from "../register.js";
async function makeHarness() {
    const server = createServer();
    registerAllTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "compute-agreement-test", version: "0.0.0" }, { capabilities: {} });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}
let tmpRoot;
let harness;
beforeEach(async () => {
    tmpRoot = path.join(os.tmpdir(), `crew-compute-agreement-tool-${crypto.randomUUID()}`);
    await fs.mkdir(tmpRoot, { recursive: true });
    harness = await makeHarness();
});
afterEach(async () => {
    await harness.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
});
async function call(args) {
    return harness.client.request({
        method: "tools/call",
        params: { name: "computeAgreement", arguments: args },
    }, CallToolResultSchema);
}
function verdictEvent(opts) {
    return {
        ts: "2026-05-25T12:00:00.000Z",
        session_id: "01KSEDYC9938DJ8VCA91C0YX43",
        agent: "generalist-reviewer",
        type: "reviewer.verdict",
        data: {
            pr_number: opts.prNumber,
            verdict: opts.verdict,
            standards_version: "1.0.0",
            plugin_version: "0.4.10",
            eventual_merge_action: opts.eventualAction,
        },
    };
}
async function seedJsonl(events) {
    const dir = path.join(tmpRoot, ".crew", "telemetry");
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteFile(path.join(dir, "2026-05.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
describe("computeAgreement MCP tool boundary", () => {
    it("registers under the exact name `computeAgreement`", async () => {
        const result = await harness.client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        const tool = result.tools.find((t) => t.name === "computeAgreement");
        expect(tool).toBeDefined();
    });
    it("rejects `lastNVerdicts: 0`", async () => {
        await expect(call({ targetRepoRoot: tmpRoot, lastNVerdicts: 0 })).rejects.toThrow();
    });
    it("rejects `lastNVerdicts: -5`", async () => {
        await expect(call({ targetRepoRoot: tmpRoot, lastNVerdicts: -5 })).rejects.toThrow();
    });
    it('rejects `lastNVerdicts: "fifty"` (wrong type)', async () => {
        await expect(call({ targetRepoRoot: tmpRoot, lastNVerdicts: "fifty" })).rejects.toThrow();
    });
    it("rejects missing `targetRepoRoot`", async () => {
        await expect(call({})).rejects.toThrow();
    });
    it("returns the helper output as JSON-stringified text for a valid window", async () => {
        const events = [];
        for (let i = 0; i < 50; i++) {
            events.push(verdictEvent({
                verdict: "READY FOR MERGE",
                eventualAction: "merged",
                prNumber: i + 1,
            }));
        }
        await seedJsonl(events);
        const res = await call({ targetRepoRoot: tmpRoot });
        expect(res.content).toHaveLength(1);
        const text = res.content[0].text;
        const parsed = JSON.parse(text);
        expect(parsed.ratio).toBe(1);
        expect(parsed.agreementCount).toBe(50);
        expect(parsed.windowSize).toBe(50);
        expect(parsed.distribution.READY_FOR_MERGE).toBe(50);
    });
    it("returns the literal text `null` when the window cannot be filled", async () => {
        // No telemetry directory.
        const res = await call({ targetRepoRoot: tmpRoot });
        const text = res.content[0].text;
        expect(text).toBe("null");
    });
    it("honours an explicit `lastNVerdicts` parameter", async () => {
        const events = [];
        for (let i = 0; i < 10; i++) {
            events.push(verdictEvent({
                verdict: "READY FOR MERGE",
                eventualAction: "merged",
                prNumber: i + 1,
            }));
        }
        await seedJsonl(events);
        const res = await call({ targetRepoRoot: tmpRoot, lastNVerdicts: 10 });
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed.windowSize).toBe(10);
    });
});
