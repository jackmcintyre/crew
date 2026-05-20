import { z } from "zod";
import { getPluginRoot } from "../lib/plugin-root.js";
import { getStatus, renderStatus } from "./get-status.js";
import { instantiatePersona } from "./instantiate-persona.js";
import { lookupRoleByDomain } from "./lookup-role-by-domain.js";
import { readCatalogue } from "./read-catalogue.js";
import { readPersona } from "./read-persona.js";
/**
 * Tool-registration seam. Every future story that ships an MCP tool
 * appends a `server.registerTool({...})` call here, keeping `server.ts`
 * free of tool-specific imports.
 *
 * Wired into `index.ts` (the stdio entrypoint) after `createServer()`
 * but BEFORE `server.connect(transport)`. NOT called from `createServer`
 * itself — the smoke test (`acceptance.test.ts` AC3) asserts that a
 * bare `createServer()` registers zero tools.
 */
export function registerAllTools(server) {
    server.registerTool({
        name: "getStatus",
        description: "Return a typed status report for the resolved target repo (plugin version, adapter, standards-doc state, cycle).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const root = z.string().min(1).parse(args.targetRepoRoot);
            const report = await getStatus({ targetRepoRoot: root });
            return {
                content: [{ type: "text", text: renderStatus(report) }],
            };
        },
    });
    // Story 2.3 — persona machinery (FR82, FR83, FR89, FR93, FR99).
    server.registerTool({
        name: "readCatalogue",
        description: "Read a catalogue role file from plugins/crew/catalogue/ and return its parsed frontmatter and body sections (FR82, FR83).",
        inputSchema: {
            type: "object",
            properties: {
                role: { type: "string" },
            },
            required: ["role"],
        },
        handler: async (args) => {
            const parsed = z.object({ role: z.string().min(1) }).parse(args);
            const result = await readCatalogue({
                pluginRoot: getPluginRoot(),
                role: parsed.role,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    server.registerTool({
        name: "instantiatePersona",
        description: "Materialise a persona file at <target-repo>/team/<role>/PERSONA.md by copying the catalogue verbatim and stamping hired_at + catalogue_version; refuses on existing persona (FR89).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "role"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                role: z.string().min(1),
            })
                .parse(args);
            const result = await instantiatePersona({
                pluginRoot: getPluginRoot(),
                targetRepoRoot: parsed.targetRepoRoot,
                role: parsed.role,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    server.registerTool({
        name: "readPersona",
        description: "Read a persona file at <target-repo>/team/<role>/PERSONA.md and return parsed frontmatter + body sections (FR93).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "role"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                role: z.string().min(1),
            })
                .parse(args);
            const result = await readPersona(parsed);
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    server.registerTool({
        name: "lookupRoleByDomain",
        description: "Exact-match a domain string against hired personas' domain frontmatter; returns { role } or { role: null } (FR99).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                domain: { type: "string" },
            },
            required: ["targetRepoRoot", "domain"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                domain: z.string().min(1),
            })
                .parse(args);
            const result = await lookupRoleByDomain(parsed);
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
}
