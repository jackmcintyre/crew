import { z } from "zod";
import { DomainError } from "../errors.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { claimStory } from "./claim-story.js";
import { completeStory } from "./complete-story.js";
import { listClaimableTodos } from "./list-claimable-todos.js";
import { mintSessionUlid } from "./mint-session-ulid.js";
import { getStatus, renderStatus } from "./get-status.js";
import { getTeamSnapshot, renderTeamSnapshot } from "./get-team-snapshot.js";
import { instantiatePersona } from "./instantiate-persona.js";
import { lookupRoleByDomain } from "./lookup-role-by-domain.js";
import { markWithdrawn } from "./mark-withdrawn.js";
import { readBacklogInventory } from "./read-backlog-inventory.js";
import { readCatalogue } from "./read-catalogue.js";
import { readCustomRole } from "./read-custom-role.js";
import { readPersona } from "./read-persona.js";
import { readRepoSignals } from "./read-repo-signals.js";
import { scanSources, renderScanResult } from "./scan-sources.js";
import { validatePlannerBacklog } from "./validate-planner-backlog.js";
import { writeNativeStory } from "./write-native-story.js";
import { claimNextStory } from "./claim-next-story.js";
import { processDevTranscript } from "./process-dev-transcript.js";
import { processReviewerTranscript } from "./process-reviewer-transcript.js";
import { runDevTerminalAction } from "./run-dev-terminal-action.js";
import { runReviewerSession } from "./run-reviewer-session.js";
import { postReviewerComments } from "./post-reviewer-comments.js";
import { applyReviewerLabels } from "./apply-reviewer-labels.js";
import { computeAgreement } from "./compute-agreement.js";
import { runAutoMergeGate } from "./auto-merge-gate.js";
import { getStuckDevClaims } from "./get-stuck-dev-claims.js";
import { markReviewerTimeout } from "./mark-reviewer-timeout.js";
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
    // Story 3.6 (HIGH-1 fix) — readBacklogInventory: build the backlog inventory
    // server-side so the /crew:plan skill does not need to glob filesystem paths
    // via the Read tool. Returns typed { mode, backlog_inventory } JSON consumed
    // by the planner skill's <initial-context> block.
    // MalformedExecutionManifestError (and other parseExecutionManifest errors)
    // surface verbatim to the skill (not caught here).
    server.registerTool({
        name: "readBacklogInventory",
        description: "Build the backlog inventory for the target repo server-side (Story 3.6). " +
            "Returns { mode: 'first-run'|'re-open', backlog_inventory: [{ref, title, state, withdrawn}] }. " +
            "Scans all four state directories and (on native) the native-stories dir. " +
            "MalformedExecutionManifestError surfaces verbatim. " +
            "Used by the /crew:plan skill to derive re-open mode and assemble <initial-context>.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            try {
                const result = await readBacklogInventory(args);
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
    // Story 4.1 — claimStory: atomic claim (FR17), dependency check (FR18), hand-edit guard (FR14a).
    server.registerTool({
        name: "claimStory",
        description: "Atomically claim a story for dev work (FR17) — moves manifest from to-do/ to in-progress/, stamps claimed_by with the caller's session ULID, refuses if any depends_on ref is not in done/ (FR18) or if the in-progress manifest has been hand-edited (FR14a). Story 4.1.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                ref: { type: "string" },
                sessionUlid: { type: "string" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "ref", "sessionUlid"],
        },
        handler: async (args) => {
            try {
                const parsed = z
                    .object({
                    targetRepoRoot: z.string().min(1),
                    ref: z.string().min(1),
                    sessionUlid: z.string().min(1),
                    role: z.string().optional(),
                })
                    .parse(args);
                const result = await claimStory(parsed);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({ error: err.name, message: err.message }),
                            },
                        ],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    });
    // Story 4.1 — completeStory: atomic complete (FR19), claimant check (AC4), hand-edit guard (FR14a).
    server.registerTool({
        name: "completeStory",
        description: "Atomically complete a claimed story (FR19) — moves manifest from in-progress/ to done/, preserves claimed_by, refuses if the caller's session ULID does not match the manifest's claimed_by (WrongClaimantError) or if the in-progress manifest has been hand-edited (FR14a). Story 4.1.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                ref: { type: "string" },
                sessionUlid: { type: "string" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "ref", "sessionUlid"],
        },
        handler: async (args) => {
            try {
                const parsed = z
                    .object({
                    targetRepoRoot: z.string().min(1),
                    ref: z.string().min(1),
                    sessionUlid: z.string().min(1),
                    role: z.string().optional(),
                })
                    .parse(args);
                const result = await completeStory(parsed);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                };
            }
            catch (err) {
                if (err instanceof DomainError) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({ error: err.name, message: err.message }),
                            },
                        ],
                        isError: true,
                    };
                }
                throw err;
            }
        },
    });
    // Story 4.2 — mintSessionUlid: pure ULID minting for the /crew:start skill.
    // The skill MUST NOT ask the LLM to generate a ULID — this tool delegates
    // minting to the `ulid` npm package so the result is deterministic.
    // The dev subagent's permissions/generalist-dev.yaml MUST NOT include this
    // tool — the subagent does not mint ULIDs.
    server.registerTool({
        name: "mintSessionUlid",
        description: "Mint a fresh session ULID for a /crew:start invocation. Pure — no IO. " +
            "Called once per /crew:start invocation; the returned ULID is re-used for " +
            "every claimStory call in that session. Story 4.2.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        handler: async (_args) => {
            const result = mintSessionUlid();
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    // Story 4.2 — listClaimableTodos: enumerate claimable to-do manifests for
    // the /crew:start skill's pre-scan pass. Returns sorted (alphabetical ref)
    // candidates with dep-readiness computed server-side. The dev subagent's
    // permissions/generalist-dev.yaml MUST NOT include this tool — it is
    // /crew:start-only.
    server.registerTool({
        name: "listClaimableTodos",
        description: "Enumerate claimable to-do manifests for the /crew:start claim-spawn loop. " +
            "Returns { todos: ClaimableCandidate[], inProgressCount: number } where todos " +
            "are filtered by isClaimable, sorted alphabetically by ref, and annotated with " +
            "depsReady (true iff all depends_on refs are in done/). Story 4.2.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z.object({ targetRepoRoot: z.string().min(1) }).parse(args);
            try {
                const result = await listClaimableTodos({ targetRepoRoot: parsed.targetRepoRoot });
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
    // Story 4.2 — buildPersonaSpawnPrompt: assemble the system prompt for a
    // dev-subagent spawn. Reads the persona file once per call; the /crew:start
    // skill calls this once per spawn. Centralises assembly so a future
    // persona-format change updates one place. The dev subagent's
    // permissions/generalist-dev.yaml MUST NOT include this tool — the subagent
    // does not assemble its own prompt; the orchestrator does.
    server.registerTool({
        name: "buildPersonaSpawnPrompt",
        description: "Assemble the system-prompt text for a dev-subagent spawn. Reads " +
            "<targetRepoRoot>/team/<role>/PERSONA.md exactly once per call, concatenates " +
            "the five required sections (Domain, Mandate, Out of mandate, Prompt, Knowledge) " +
            "plus a Locked phrases sentinel block. Returns { systemPrompt: string }. " +
            "Propagates PersonaFileNotFoundError if the team persona is absent. Story 4.2.",
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
            try {
                const result = await buildPersonaSpawnPrompt(parsed);
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
    // Story 4.3b — claimNextStory: single-iteration outer claim-loop step.
    // The SKILL.md prose calls this in a loop until queue-drained or
    // waiting-on-in-progress is returned.
    server.registerTool({
        name: "claimNextStory",
        description: "Claim the next ready story from the backlog for the current session. " +
            "Returns { next: 'spawn-dev', ref, title, manifestPath, chatLog } when a story is claimed, " +
            "{ next: 'queue-drained', chatLog } when both to-do/ and in-progress/ are empty, or " +
            "{ next: 'waiting-on-in-progress', chatLog } when todos exist but all are deps-blocked. " +
            "Story 4.3b.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
            })
                .parse(args);
            try {
                const result = await claimNextStory(parsed);
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
    // Story 4.3b — processDevTranscript: parse the dev subagent's final transcript.
    // The SKILL.md prose calls this after capturing the dev Task tool's return value.
    server.registerTool({
        name: "processDevTranscript",
        description: "Parse the dev subagent's final transcript for the verbatim handoff phrase. " +
            "Returns { next: 'spawn-reviewer', reviewerPrompt, chatLog } on a valid handoff, or " +
            "{ next: 'done-blocked-handoff-grammar', chatLog } on grammar drift (stamps blocked_by in the manifest). " +
            "MUST be called with the verbatim full transcript — no summarisation. Story 4.3b.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                ref: { type: "string" },
                devTranscript: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid", "ref", "devTranscript"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                ref: z.string().min(1),
                devTranscript: z.string(),
            })
                .parse(args);
            try {
                const result = await processDevTranscript(parsed);
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
    // Story 4.3b / Story 4.6 revision 2 — processReviewerTranscript:
    // Reads `reviewer-result.json` written by `runReviewerSession` and routes
    // on its `recommendedVerdict` field. The `reviewerTranscript` parameter has
    // been DROPPED — the reviewer's chat is no longer the verdict transport.
    server.registerTool({
        name: "processReviewerTranscript",
        description: "Read the persisted reviewer-result.json (written by runReviewerSession) and route on its recommendedVerdict. " +
            "Returns { next: 'done-ready-for-merge', completed: true, chatLog } on READY FOR MERGE (calls completeStory internally), " +
            "{ next: 'done-blocked-reviewer-needs-changes', chatLog } on NEEDS CHANGES (stamps blocked_by), " +
            "{ next: 'done-blocked-reviewer-blocked', chatLog } on BLOCKED (stamps blocked_by), " +
            "{ next: 'done-blocked-no-session-result', chatLog } when reviewer-result.json is absent. " +
            "Story 4.3b / Story 4.6 revision 2.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                ref: { type: "string" },
                manifestPath: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid", "ref", "manifestPath"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                ref: z.string().min(1),
                manifestPath: z.string().min(1),
            })
                .parse(args);
            try {
                const result = await processReviewerTranscript(parsed);
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
    // Story 4.4 — runDevTerminalAction: dev subagent terminal action (branch, commit, push, PR).
    server.registerTool({
        name: "runDevTerminalAction",
        description: "Dev subagent terminal action: creates a story branch, commits in conventional-commits format, " +
            "pushes to origin, and opens a PR via gh pr create with a machine-readable body (story link, ACs " +
            "checklist mirrored from the spec) followed by a free-form summary. " +
            "Refuses --no-verify, --force, --force-with-lease unconditionally. " +
            "Returns { ok: true, branch, commitSha, prUrl } on success. Story 4.4.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                ref: { type: "string" },
                title: { type: "string" },
                type: { type: "string" },
                body: { type: "string" },
                summary: { type: "string" },
                manifestPath: { type: "string" },
                sessionUlid: { type: "string" },
            },
            required: [
                "targetRepoRoot",
                "ref",
                "title",
                "type",
                "body",
                "summary",
                "manifestPath",
                "sessionUlid",
            ],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                ref: z.string().min(1),
                title: z.string().min(1),
                type: z.string().min(1),
                body: z.string(),
                summary: z.string(),
                manifestPath: z.string().min(1),
                sessionUlid: z.string().min(1),
            })
                .parse(args);
            try {
                const result = await runDevTerminalAction(parsed);
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
    // Story 4.6b — postReviewerComments: posts the reviewer's verdict as a PR review.
    // Reads reviewer-result.json, composes summary body + inline comments deterministically,
    // and POSTs a single gh api review. Invoked from SKILL.md prose AFTER reviewer Task
    // returns and BEFORE processReviewerTranscript runs.
    server.registerTool({
        name: "postReviewerComments",
        description: "Read the persisted reviewer-result.json (written by runReviewerSession) and post a PR review " +
            "with a deterministic summary body and zero-or-more inline comments. " +
            "Returns { next: 'skipped-no-session-result', postedReviewId: null } when the file is absent, " +
            "or { next: 'posted', postedReviewId, inlineCommentCount, verdictLine } on success. " +
            "All composition is deterministic (no LLM step). Story 4.6b.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                role: z.string().optional(),
            })
                .parse(args);
            try {
                const result = await postReviewerComments(parsed);
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
    // Story 4.8 — applyReviewerLabels: applies GitHub labels to a PR after a reviewer pass.
    // Reads reviewer-result.json, resolves owner/repo, and calls gh api POST /labels.
    // Always applies `reviewed-by-agent`; also applies `needs-human` on non-green verdicts.
    // Accepts `verdictOverride: "reviewer-failure"` for use in the SKILL.md error handler.
    server.registerTool({
        name: "applyReviewerLabels",
        description: "Apply GitHub labels to the PR after a completed reviewer cycle. " +
            "Always applies `reviewed-by-agent`; also applies `needs-human` on NEEDS CHANGES, BLOCKED, or reviewer-failure verdicts. " +
            "Returns { next: 'skipped-no-session-result' } when reviewer-result.json is absent, " +
            "or { next: 'applied', labelsApplied: string[] } on success. " +
            "Propagates GhRecoverableError, GhApiResponseShapeError, and ReviewerResultFileMalformedError uncaught. " +
            "Story 4.8 (FR36, FR37, FR38).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                verdictOverride: { type: "string", enum: ["reviewer-failure"] },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                verdictOverride: z.literal("reviewer-failure").optional(),
                role: z.string().optional(),
            })
                .parse(args);
            try {
                const result = await applyReviewerLabels(parsed);
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
    // Story 4.6 — runReviewerSession: composite tool for the reviewer subagent.
    // Performs the three mandatory reads (source story → PR diff → standards)
    // in fixed sequential order, runs every AC via the applicability classifier,
    // and returns ReviewerSessionResult carrying structured acResults.
    server.registerTool({
        name: "runReviewerSession",
        description: "Composite reviewer-session tool. Reads the source story (via active adapter), " +
            "the PR diff (via gh pr diff), and docs/standards.md in fixed sequential order. " +
            "Runs every AC against the applicability classifier (artifact-check, vitest, or manual-check-required). " +
            "Derives a `recommendedVerdict` literal (READY FOR MERGE | NEEDS CHANGES | BLOCKED) from acResults " +
            "and persists the full ReviewerSessionResult to " +
            "`<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json` as a side-effect before returning. " +
            "Returns ReviewerSessionResult with sourceStory, prDiff, standards, standardsByCriterionId, acResults, and recommendedVerdict. " +
            "All read and execution errors propagate uncaught. MUST be the reviewer persona's FIRST action. Story 4.6.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                ref: { type: "string" },
                prNumber: { type: "number" },
                role: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid", "ref", "prNumber"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                ref: z.string().min(1),
                prNumber: z.number().int().positive(),
                role: z.string().optional(),
            })
                .parse(args);
            try {
                const result = await runReviewerSession(parsed);
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
    // Story 4.10 — computeAgreement: pure JSONL aggregator over
    // `.crew/telemetry/<YYYY-MM>.jsonl` `reviewer.verdict` events. Returns
    // the rolling agreement ratio used by the auto-merge gate (Story 4.10b)
    // or `null` when there are insufficient resolved events to fill the
    // window. FR67 / NFR24.
    server.registerTool({
        name: "computeAgreement",
        description: "Compute the rolling reviewer-vs-eventual-action agreement ratio over the " +
            "trailing N resolved `reviewer.verdict` events on disk. Default window is 50. " +
            "Returns `{ ratio, agreementCount, windowSize, distribution, malformedLines, " +
            "malformedFiles }` or `null` when the window cannot be filled (no telemetry, " +
            "no resolved events, or fewer resolved events than the window). Pure read; " +
            "no writes; no network. Story 4.10 / FR67 / NFR24.",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                lastNVerdicts: { type: "number" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                lastNVerdicts: z.number().int().positive().optional(),
            })
                .parse(args);
            const result = await computeAgreement(parsed);
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    });
    // Story 4.10b — runAutoMergeGate: decides auto-merge vs needs-human pause
    // for the just-completed reviewer run on the READY-FOR-MERGE branch.
    // Composes computeAgreement (4.10), riskTier from reviewer-result.json (4.9b),
    // workspace config (plugin.agreement_threshold), and gh (pr-merge / api labels).
    // FR40, FR41, FR42.
    server.registerTool({
        name: "runAutoMergeGate",
        description: "Decide auto-merge vs needs-human pause for the just-completed reviewer run (FR40, FR41, FR42).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
            })
                .parse(args);
            try {
                const result = await runAutoMergeGate(parsed);
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
    // Story 4.12 — getStuckDevClaims: enumerate in-progress claims that have
    // exceeded the per-story budget (default 30 min, NFR3). Substrate for
    // Story 5.4's poll loop.
    server.registerTool({
        name: "getStuckDevClaims",
        description: "Return the list of in-progress dev claims that have exceeded the per-story budget (default 30 min, NFR3).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                budgetMs: { type: "number" },
            },
            required: ["targetRepoRoot"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                budgetMs: z.number().int().positive().optional(),
            })
                .parse(args);
            try {
                const result = await getStuckDevClaims(parsed);
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
    // Story 4.12 — markReviewerTimeout: stamp blocked_by=reviewer-timeout on
    // the in-progress manifest after a reviewer 8-min hard limit fires.
    server.registerTool({
        name: "markReviewerTimeout",
        description: "Stamp `blocked_by: reviewer-timeout` on the in-progress manifest after the reviewer subagent exceeded the 8-minute hard limit (NFR2).",
        inputSchema: {
            type: "object",
            properties: {
                targetRepoRoot: { type: "string" },
                sessionUlid: { type: "string" },
                ref: { type: "string" },
                manifestPath: { type: "string" },
            },
            required: ["targetRepoRoot", "sessionUlid", "ref", "manifestPath"],
        },
        handler: async (args) => {
            const parsed = z
                .object({
                targetRepoRoot: z.string().min(1),
                sessionUlid: z.string().min(1),
                ref: z.string().min(1),
                manifestPath: z.string().min(1),
            })
                .parse(args);
            try {
                const result = await markReviewerTimeout(parsed);
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
}
