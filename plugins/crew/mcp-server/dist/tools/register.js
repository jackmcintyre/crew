import { z } from "zod";
import { DomainError } from "../errors.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { getStatus, renderStatus } from "./get-status.js";
import { getTeamSnapshot, renderTeamSnapshot } from "./get-team-snapshot.js";
import { instantiatePersona } from "./instantiate-persona.js";
import { lookupRoleByDomain } from "./lookup-role-by-domain.js";
import { markWithdrawn } from "./mark-withdrawn.js";
import { readCatalogue } from "./read-catalogue.js";
import { readCustomRole } from "./read-custom-role.js";
import { readPersona } from "./read-persona.js";
import { readRepoSignals } from "./read-repo-signals.js";
import { scanSources, renderScanResult } from "./scan-sources.js";
import { validatePlannerBacklog } from "./validate-planner-backlog.js";
import { writeNativeStory } from "./write-native-story.js";
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
    // Story 2.4 — repo signal read for the hiring manager (FR85).
    server.registerTool({
        name: "readRepoSignals",
        description: "Return a typed RepoSignals payload (languages, layout, README excerpt, recent commit titles, dependency manifests) for the resolved target repo. Used by /hire (FR85).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z
                .object({ targetRepoRoot: z.string().min(1) })
                .parse(args);
            const result = await readRepoSignals({
                targetRepoRoot: parsed.targetRepoRoot,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    // Story 2.5 — manual escape hatch for operator-authored custom roles
    // (FR92). Parses <target-repo>/team/custom/<role>.md against the same
    // CatalogueRoleSchema as a shipped catalogue file.
    server.registerTool({
        name: "readCustomRole",
        description: "Read an operator-authored custom role file from <target-repo>/team/custom/<role>.md and return its parsed CatalogueRole. Used by /hire to support the FR92 manual escape hatch.",
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
            const result = await readCustomRole({
                targetRepoRoot: parsed.targetRepoRoot,
                role: parsed.role,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    // Story 2.6 — team snapshot (FR108, NFR28). Pure file reads; no LLM
    // in the loop. Used by /crew:team.
    server.registerTool({
        name: "getTeamSnapshot",
        description: "Return a typed snapshot of the hired team — roles, domains, fire counts from telemetry, recent persona-knowledge entries. Used by /crew:team (FR108, NFR28). Pure file reads; no LLM in the loop.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                knowledgeLimit: { type: "number" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                knowledgeLimit: z.number().int().positive().optional(),
            })
                .parse(args);
            const snapshot = await getTeamSnapshot(parsed);
            return {
                content: [{ type: "text", text: renderTeamSnapshot(snapshot) }],
            };
        },
    });
    // Story 3.4 — writeNativeStory: write a new native-story file under
    // `<targetRepoRoot>/.crew/native-stories/<ULID>.md`. Invoked by the
    // planner subagent (spawned by /crew:plan) in native-adapter workspaces.
    // The tool refuses with WrongAdapterError if the active adapter is not
    // 'native', providing a runtime guard for the BMad-branch Behavioural
    // contract clause.
    server.registerTool({
        name: "writeNativeStory",
        description: "Write a new native-adapter story file under <targetRepoRoot>/.crew/native-stories/<ULID>.md. " +
            "Refuses with WrongAdapterError if the active adapter is not 'native'. " +
            "Used by the planner subagent spawned by /crew:plan (Story 3.4).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                title: { type: "string" },
                narrative: { type: "string" },
                acceptance_criteria: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            text: { type: "string" },
                            kind: { type: "string", enum: ["integration", "unit"] },
                        },
                        required: ["text", "kind"],
                    },
                },
                implementation_notes: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
            },
            required: ["targetRepoRoot", "title", "narrative", "acceptance_criteria", "depends_on"],
        },
        handler: async (args) => {
            try {
                const result = await writeNativeStory(args);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return {
                        content: [{ type: "text", text: err.message }],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    });
    // Story 3.5 — validatePlannerBacklog: planning-discipline pre-write gate for
    // the planner subagent. The planner MUST call this before every
    // `writeNativeStory` invocation and before emitting the locked handoff phrase.
    // Native-adapter workspaces only (throws WrongAdapterError for BMad).
    server.registerTool({
        name: "validatePlannerBacklog",
        description: "Validate a batch of pending native stories against planning-discipline rules before writing. " +
            "Returns { ok: true } on pass or { ok: false; violations } on any failure. " +
            "The planner MUST call this before every writeNativeStory and before emitting the handoff phrase. " +
            "Throws WrongAdapterError if the active adapter is not 'native' (Story 3.5).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                pendingStories: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            narrative: { type: "string" },
                            acceptance_criteria: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        text: { type: "string" },
                                        kind: { type: "string", enum: ["integration", "unit"] },
                                    },
                                    required: ["text", "kind"],
                                },
                            },
                            implementation_notes: { type: "string" },
                            depends_on: { type: "array", items: { type: "string" } },
                            ship_gate: { type: "boolean" },
                            state_mutating: { type: ["boolean", "string"] },
                        },
                        required: [
                            "title",
                            "narrative",
                            "acceptance_criteria",
                            "depends_on",
                            "ship_gate",
                            "state_mutating",
                        ],
                    },
                },
            },
            required: ["targetRepoRoot", "pendingStories"],
        },
        handler: async (args) => {
            try {
                const result = await validatePlannerBacklog(args);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return {
                        content: [{ type: "text", text: err.message }],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    });
    // Story 3.6 — markWithdrawn: mark an execution manifest withdrawn (FR78).
    // External-adapter discard path. Native discard uses writeNativeStory with
    // a revert/deprecate story instead.
    server.registerTool({
        name: "markWithdrawn",
        description: "Mark an execution manifest withdrawn (FR78). External-adapter discard path. Native discard uses writeNativeStory with a revert/deprecate story instead.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                ref: { type: "string" },
            },
            required: ["targetRepoRoot", "ref"],
        },
        handler: async (args) => {
            try {
                const result = await markWithdrawn(args);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return {
                        content: [{ type: "text", text: err.message }],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    });
    // Story 3.2 — scan-sources: project source stories into to-do/ manifests.
    //
    // Convention note: the MCP tool name follows the camelCase convention
    // (`scanSources`, matching `getStatus`, `readCatalogue`, etc.). The epic
    // AC text uses the kebab-case identifier `scan-sources` informally — it is
    // readable English in prose, not the wire-level tool name. The skill
    // (`/crew:scan`) hides both forms from the operator.
    //
    // Permission note: `/crew:scan` invokes this tool without `_meta.role`
    // (matching `/crew:status`'s pattern), so the role-gate at server.ts is
    // bypassed and the tool runs at operator authority. When Story 3.4 lands
    // the planner subagent, its permission spec at
    // `plugins/crew/catalogue/permissions/planner.yaml` must list `scanSources`
    // in `tools_allow`. That edit belongs to Story 3.4.
    server.registerTool({
        name: "scanSources",
        description: "Project the active adapter's source stories into execution manifests under <target-repo>/.crew/state/to-do/<ref>.yaml. Idempotent on re-scan; refreshes source_hash for manifests still in to-do/. Used by /<plugin>:scan (Story 3.2).",
        inputSchema: {
            type: "object",
            properties: { targetRepoRoot: { type: "string" } },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z.object({ targetRepoRoot: z.string().min(1) }).parse(args);
            try {
                const result = await scanSources({ targetRepoRoot: parsed.targetRepoRoot });
                return { content: [{ type: "text", text: renderScanResult(result) }] };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return { content: [{ type: "text", text: err.message }], isError: true };
                }
                throw err;
            }
        },
    });
}
