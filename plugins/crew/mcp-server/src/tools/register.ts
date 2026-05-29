import { z } from "zod";
import { DomainError } from "../errors.js";
import { getPluginRoot } from "../lib/plugin-root.js";
import type { AiEngineeringTeamServer } from "../server.js";
import { buildPersonaSpawnPrompt } from "./build-persona-spawn-prompt.js";
import { claimStory } from "./claim-story.js";
import { completeStory } from "./complete-story.js";
import { recordStoryRetro } from "./record-story-retro.js";
import { writeRetroProposal } from "./write-retro-proposal.js";
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
import { recordAgentInvoke } from "./record-agent-invoke.js";
import { recordPrCloseAction } from "./record-pr-close-action.js";
import { processReviewerYield } from "./process-reviewer-yield.js";
import { classifyRiskTier } from "./classify-risk-tier.js";
import { computeAgreement, AgreementMetricResultSchema } from "./compute-agreement.js";
import { runAutoMergeGate, AutoMergeGateResultSchema } from "./run-auto-merge-gate.js";
import { createSmokeScratchRepo } from "./create-smoke-scratch-repo.js";
import { scanOrphanedInProgress } from "./scan-orphaned-in-progress.js";
import { reattachOrphan } from "./reattach-orphan.js";
import { blockOrphanNoTranscript } from "./block-orphan-no-transcript.js";

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
export function registerAllTools(server: AiEngineeringTeamServer): void {
  server.registerTool({
    name: "getStatus",
    description:
      "Return a typed status report for the resolved target repo (plugin version, adapter, standards-doc state, cycle).",
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
        content: [{ type: "text" as const, text: renderStatus(report) }],
      };
    },
  });

  // Story 2.3 — persona machinery (FR82, FR83, FR89, FR93, FR99).
  server.registerTool({
    name: "readCatalogue",
    description:
      "Read a catalogue role file from plugins/crew/catalogue/ and return its parsed frontmatter and body sections (FR82, FR83).",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  server.registerTool({
    name: "instantiatePersona",
    description:
      "Materialise a persona file at <target-repo>/team/<role>/PERSONA.md by copying the catalogue verbatim and stamping hired_at + catalogue_version; refuses on existing persona (FR89).",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  server.registerTool({
    name: "readPersona",
    description:
      "Read a persona file at <target-repo>/team/<role>/PERSONA.md and return parsed frontmatter + body sections (FR93).",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  server.registerTool({
    name: "lookupRoleByDomain",
    description:
      "Exact-match a domain string against hired personas' domain frontmatter; returns { role } or { role: null } (FR99).",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  // Story 2.4 — repo signal read for the hiring manager (FR85).
  server.registerTool({
    name: "readRepoSignals",
    description:
      "Return a typed RepoSignals payload (languages, layout, README excerpt, recent commit titles, dependency manifests) for the resolved target repo. Used by /hire (FR85).",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  // Story 2.5 — manual escape hatch for operator-authored custom roles
  // (FR92). Parses <target-repo>/team/custom/<role>.md against the same
  // CatalogueRoleSchema as a shipped catalogue file.
  server.registerTool({
    name: "readCustomRole",
    description:
      "Read an operator-authored custom role file from <target-repo>/team/custom/<role>.md and return its parsed CatalogueRole. Used by /hire to support the FR92 manual escape hatch.",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  // Story 2.6 — team snapshot (FR108, NFR28). Pure file reads; no LLM
  // in the loop. Used by /crew:team.
  server.registerTool({
    name: "getTeamSnapshot",
    description:
      "Return a typed snapshot of the hired team — roles, domains, fire counts from telemetry, recent persona-knowledge entries. Used by /crew:team (FR108, NFR28). Pure file reads; no LLM in the loop.",
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
        content: [{ type: "text" as const, text: renderTeamSnapshot(snapshot) }],
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
    description:
      "Write a new native-adapter story file under <targetRepoRoot>/.crew/native-stories/<ULID>.md. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Validate a batch of pending native stories against planning-discipline rules before writing. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Mark an execution manifest withdrawn (FR78). External-adapter discard path. Native discard uses writeNativeStory with a revert/deprecate story instead.",
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Build the backlog inventory for the target repo server-side (Story 3.6). " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Atomically claim a story for dev work (FR17) — moves manifest from to-do/ to in-progress/, stamps claimed_by with the caller's session ULID, refuses if any depends_on ref is not in done/ (FR18) or if the in-progress manifest has been hand-edited (FR14a). Story 4.1.",
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [
              {
                type: "text" as const,
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
    description:
      "Atomically complete a claimed story (FR19) — moves manifest from in-progress/ to done/, preserves claimed_by, refuses if the caller's session ULID does not match the manifest's claimed_by (WrongClaimantError) or if the in-progress manifest has been hand-edited (FR14a). Story 4.1.",
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [
              {
                type: "text" as const,
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

  // Story 6.1 — recordStoryRetro: attach structured retro entries (lessons[],
  // failure_class, duration_seconds) to a done/ manifest after story completion.
  // Reviewer-side tool. State-guards against to-do/, blocked/, in-progress/
  // (post-completion concern). FR11, FR55.
  server.registerTool({
    name: "recordStoryRetro",
    description:
      "Attach structured retro entries (lessons[], failure_class, duration_seconds) " +
      "to a done/ manifest after story completion. Reviewer-side tool (Story 6.1, FR11, FR55). " +
      "Refuses with StoryNotInDoneStateError when the manifest lives in to-do/, blocked/, " +
      "or in-progress/. Throws ManifestNotFoundError when the ref does not exist anywhere. " +
      "Throws MalformedStoryRetroPayloadError when the payload fails schema validation " +
      "(closed kind enum, pitfall requires failure_class, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        ref: { type: "string" },
        payload: { type: "object" },
        role: { type: "string" },
      },
      required: ["targetRepoRoot", "ref", "payload"],
    },
    handler: async (args) => {
      try {
        const parsed = z
          .object({
            targetRepoRoot: z.string().min(1),
            ref: z.string().min(1),
            payload: z.unknown(),
            role: z.string().optional(),
          })
          .parse(args);
        const result = await recordStoryRetro(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [
              {
                type: "text" as const,
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

  // Story 6.3 — writeRetroProposal: emit a single immutable retro-proposal
  // markdown file at <target-repo>/.crew/retro-proposals/<isoTimestamp>.md.
  // Carries a YAML frontmatter block (source of truth for apply-time
  // re-validation in Epic 6b) plus an operator-readable rendered body.
  // Refuses collisions — proposals are immutable artifacts keyed by ISO
  // timestamp. FR58, FR59.
  server.registerTool({
    name: "writeRetroProposal",
    description:
      "Write a single immutable retro-proposal markdown file under " +
      "<target-repo>/.crew/retro-proposals/<isoTimestamp>.md. The file carries a YAML " +
      "frontmatter block (validated via RetroProposalFileSchema; source of truth for " +
      "Epic 6b apply-time re-validation) plus a rendered Markdown body with one H2 per " +
      "proposal. Refuses collisions with RetroProposalAlreadyExistsError (proposals are " +
      "immutable). Refuses malformed payloads with MalformedRetroProposalError — closed " +
      "discriminated union over seven types (rule, rule-retirement, skill-create, " +
      "skill-revise, skill-supersede, skill-retire, team-change). Story 6.3 (FR58, FR59).",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        isoTimestamp: { type: "string" },
        proposals: { type: "array" },
        cycleWindow: {
          // null or { from, to } — surfaced as plain object so the JSON-schema
          // hint isn't too tight; Zod inside the handler is the real gate.
          type: ["object", "null"],
        },
        role: { type: "string" },
      },
      required: ["targetRepoRoot", "isoTimestamp", "proposals"],
    },
    handler: async (args) => {
      try {
        const parsed = z
          .object({
            targetRepoRoot: z.string().min(1),
            isoTimestamp: z.string().min(1),
            proposals: z.array(z.unknown()),
            cycleWindow: z
              .object({ from: z.string(), to: z.string() })
              .strict()
              .nullable()
              .optional(),
            role: z.string().optional(),
          })
          .parse(args);
        const result = await writeRetroProposal(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [
              {
                type: "text" as const,
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
    description:
      "Mint a fresh session ULID for a /crew:start invocation. Pure — no IO. " +
      "Called once per /crew:start invocation; the returned ULID is re-used for " +
      "every claimStory call in that session. Story 4.2.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_args) => {
      const result = mintSessionUlid();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
    description:
      "Enumerate claimable to-do manifests for the /crew:start claim-spawn loop. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Assemble the system-prompt text for a dev-subagent spawn. Reads " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Project the active adapter's source stories into execution manifests under <target-repo>/.crew/state/to-do/<ref>.yaml. Idempotent on re-scan; refreshes source_hash for manifests still in to-do/. Used by /<plugin>:scan (Story 3.2).",
    inputSchema: {
      type: "object",
      properties: { targetRepoRoot: { type: "string" } },
      required: ["targetRepoRoot"],
    },
    handler: async (args) => {
      const parsed = z.object({ targetRepoRoot: z.string().min(1) }).parse(args);
      try {
        const result = await scanSources({ targetRepoRoot: parsed.targetRepoRoot });
        return { content: [{ type: "text" as const, text: renderScanResult(result) }] };
      } catch (err) {
        if (err instanceof DomainError) {
          return { content: [{ type: "text" as const, text: err.message }], isError: true };
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
    description:
      "Claim the next ready story from the backlog for the current session. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Parse the dev subagent's final transcript for the verbatim handoff phrase. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Read the persisted reviewer-result.json (written by runReviewerSession) and route on its recommendedVerdict. " +
      "Returns { next: 'done-ready-for-merge', completed: true, chatLog } on READY FOR MERGE (calls completeStory internally), " +
      "{ next: 'done-blocked-reviewer-needs-changes', chatLog } on NEEDS CHANGES (stamps blocked_by), " +
      "{ next: 'done-blocked-reviewer-blocked', chatLog } on BLOCKED (stamps blocked_by). " +
      "Throws ReviewerFirstCallSkippedError (stamps blocked_by: reviewer-no-session-result) when reviewer-result.json is absent — " +
      "the reviewer subagent skipped the mandatory runReviewerSession first call (Story 5.21 seam). " +
      "Story 4.3b / Story 4.6 revision 2 / Story 5.21.",
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Dev subagent terminal action: creates a story branch, commits in conventional-commits format, " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Read the persisted reviewer-result.json (written by runReviewerSession) and post a PR review " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Apply GitHub labels to the PR after a completed reviewer cycle. " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 4.12 — recordAgentInvoke: record a completed agent-subagent invocation,
  // enforce the 8-min reviewer hard cap (NFR2), and emit dev.budget_exceeded when
  // cumulative dev runtime crosses 30 min (NFR3). (FR65, NFR2, NFR3)
  server.registerTool({
    name: "recordAgentInvoke",
    description:
      "Record a completed agent-subagent invocation (FR65). Emits an `agent.invoke` telemetry event. " +
      "For `generalist-reviewer` invocations exceeding 8 min (NFR2): substitutes the verdict comment " +
      "with a failure body, applies `needs-human`, and returns `{ kind: 'reviewer-timed-out' }` — " +
      "the story is NOT marked failed. " +
      "For `generalist-dev` invocations when cumulative story runtime crosses 30 min (NFR3): emits " +
      "`dev.budget_exceeded` and returns `{ kind: 'dev-budget-exceeded' }`. " +
      "Returns `{ kind: 'ok' }` on the common path. Story 4.12.",
    inputSchema: {
      type: "object",
      properties: {
        sessionUlid: { type: "string" },
        agent: { type: "string" },
        storyId: { type: "string" },
        startedAt: { type: "string" },
        completedAt: { type: "string" },
        tokensIn: { type: "number" },
        tokensOut: { type: "number" },
        targetRepoRoot: { type: "string" },
      },
      required: ["sessionUlid", "agent", "startedAt", "completedAt", "targetRepoRoot"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          sessionUlid: z.string().min(1),
          agent: z.string().min(1),
          storyId: z.string().optional(),
          startedAt: z.string().min(1),
          completedAt: z.string().min(1),
          tokensIn: z.number().int().nonnegative().optional(),
          tokensOut: z.number().int().nonnegative().optional(),
          targetRepoRoot: z.string().min(1),
        })
        .parse(args);
      try {
        const result = await recordAgentInvoke(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 4.12 — recordPrCloseAction: write a retroactive `reviewer.verdict.merge_action`
  // event when a PR is closed. Join key for compute-agreement (Story 4.10): (pr_number, session_id).
  server.registerTool({
    name: "recordPrCloseAction",
    description:
      "Write a `reviewer.verdict.merge_action` event when a PR is closed (FR66). " +
      "Join key for Story 4.10 compute-agreement: (prNumber, sessionUlid). " +
      "No deduplication — caller (Story 5.3's polling loop) is responsible for dedup. " +
      "Returns `{ kind: 'ok' }`. Story 4.12.",
    inputSchema: {
      type: "object",
      properties: {
        sessionUlid: { type: "string" },
        storyId: { type: "string" },
        prNumber: { type: "number" },
        mergeAction: { type: "string", enum: ["merged", "closed-unmerged", "still-open"] },
        resolvedAt: { type: "string" },
        targetRepoRoot: { type: "string" },
      },
      required: ["sessionUlid", "prNumber", "mergeAction", "targetRepoRoot"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          sessionUlid: z.string().min(1),
          storyId: z.string().optional(),
          prNumber: z.number().int().positive(),
          mergeAction: z.enum(["merged", "closed-unmerged", "still-open"]),
          resolvedAt: z.string().optional(),
          targetRepoRoot: z.string().min(1),
        })
        .parse(args);
      try {
        const result = await recordPrCloseAction(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 4.11 — processReviewerYield: parse the reviewer subagent's transcript
  // for the verbatim locked yield phrase and route the review to the appropriate
  // hired specialist. Called by SKILL.md prose BEFORE postReviewerComments /
  // processReviewerTranscript. Returns a discriminated next: value. Story 4.11.
  server.registerTool({
    name: "processReviewerYield",
    description:
      "Parse the reviewer subagent's transcript for the verbatim locked yield phrase " +
      "`This sits in <domain>'s domain — handing off.` and route the review to the appropriate " +
      "hired specialist. " +
      "Returns { next: 'no-yield', chatLog } (common path — pass through to existing flow), " +
      "{ next: 'spawn-specialist-reviewer', toRole, specialistPrompt, chatLog } on a successful yield, " +
      "{ next: 'done-blocked-routing-failure', chatLog } when no hired role matches the domain " +
      "(stamps blocked_by: routing-failure on the manifest), or " +
      "{ next: 'done-blocked-routing-self-yield', chatLog } when the yielder named its own domain " +
      "(stamps blocked_by: routing-self-yield). " +
      "Emits a yield.handoff telemetry event on the success branch only (FR103, NFR29). " +
      "NOT in subagent allowlists — called by SKILL.md prose only. Story 4.11.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        sessionUlid: { type: "string" },
        ref: { type: "string" },
        fromRole: { type: "string" },
        reviewerTranscript: { type: "string" },
        manifestPath: { type: "string" },
      },
      required: ["targetRepoRoot", "sessionUlid", "ref", "fromRole", "reviewerTranscript", "manifestPath"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          targetRepoRoot: z.string().min(1),
          sessionUlid: z.string().min(1),
          ref: z.string().min(1),
          fromRole: z.string().min(1),
          reviewerTranscript: z.string(),
          manifestPath: z.string().min(1),
        })
        .parse(args);
      try {
        const result = await processReviewerYield(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
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
    description:
      "Composite reviewer-session tool. Reads the source story (via active adapter), " +
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 4.9b — risk-tier classifier (FR40a, Pattern §11).
  server.registerTool({
    name: "classifyRiskTier",
    description:
      "Classify a PR's risk tier from its diff signals (changed paths, commit messages, diff size) using the " +
      "loaded risk-tiering spec (Story 4.9). Returns the Pattern §11 output shape: " +
      "{ story_id, tier: low|medium|high, matched_rule, evidence: { paths, change_types, diff_size } }. " +
      "Walks rules in high→medium→low order (highest-tier-wins). Falls back to 'medium' with matched_rule='fallback' " +
      "when no rule matches. Propagates MalformedRiskTieringSpecError and ShippedRiskTieringDefaultMissingError verbatim. " +
      "In v1, this tool is called internally by runReviewerSession; it is exposed as an MCP tool for future direct callers. " +
      "Story 4.9b.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        pluginRoot: { type: "string" },
        storyId: { type: "string" },
        changedPaths: { type: "array", items: { type: "string" } },
        commitMessages: { type: "array", items: { type: "string" } },
        diffSize: { type: "number" },
      },
      required: ["targetRepoRoot", "pluginRoot", "storyId", "changedPaths", "commitMessages", "diffSize"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          targetRepoRoot: z.string().min(1),
          pluginRoot: z.string().min(1),
          storyId: z.string().min(1),
          changedPaths: z.array(z.string()),
          commitMessages: z.array(z.string()),
          diffSize: z.number().int().nonnegative(),
        })
        .parse(args);
      try {
        const result = await classifyRiskTier(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 4.10 — computeAgreement: rolling reviewer-verdict vs human-merge-action
  // agreement ratio. Reads all *.jsonl files under <targetRepoRoot>/.crew/telemetry/,
  // joins reviewer.verdict and reviewer.verdict.merge_action events by (pr_number,
  // session_id), and returns a deterministic { ratio, distribution, window_size,
  // sample_size, ... } shape or null on insufficient data. (FR67, NFR24)
  // v1 callers: Story 4.10b's auto-merge gate (internal import, same pattern as
  // classifyRiskTier). NOT in subagent allowlists in v1.
  server.registerTool({
    name: "computeAgreement",
    description:
      "Compute the rolling reviewer-verdict vs human-merge-action agreement ratio (FR67, NFR24). " +
      "Reads every *.jsonl file under <targetRepoRoot>/.crew/telemetry/, joins reviewer.verdict and " +
      "reviewer.verdict.merge_action events by (pr_number, session_id), excludes reviewer-failure verdicts " +
      "and still-open merge actions, sorts newest-first by verdict ts, takes the first lastNVerdicts pairs. " +
      "Returns { ratio, distribution, window_size, sample_size, skipped_unresolved, skipped_excluded, malformed_lines } " +
      "or null when resolved-pair count < lastNVerdicts (insufficient data). " +
      "Throws AgreementWindowInvalidError on invalid lastNVerdicts (0, negative, non-integer). " +
      "Story 4.10.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        lastNVerdicts: { type: "number" },
      },
      required: ["targetRepoRoot"],
    },
    handler: async (args) => {
      const parsed = {
        targetRepoRoot: args.targetRepoRoot as string,
        lastNVerdicts: args.lastNVerdicts as number | undefined,
      };
      try {
        const result = await computeAgreement(parsed);
        // Validate return shape before surfacing (round-trip guard)
        if (result !== null) {
          AgreementMetricResultSchema.parse(result);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 1.13 — createSmokeScratchRepo: create a disposable smoke-harness
  // scratch repo seeded with git init + empty commit + minimal
  // .crew/config.yaml + .crew/standards.md. Used by the /crew:smoke skill
  // as the first checkpoint step (AC1).
  server.registerTool({
    name: "createSmokeScratchRepo",
    description:
      "Create a disposable smoke-harness scratch repo seeded with git init + empty commit + minimal .crew/config.yaml + .crew/standards.md. Used by the /crew:smoke skill as the first checkpoint step.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string" },
        parentDir: { type: "string" },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const parsed = z
        .object({ label: z.string().min(1), parentDir: z.string().min(1).optional() })
        .parse(args);
      const result = await createSmokeScratchRepo(parsed);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ scratchRoot: result.scratchRoot }) },
        ],
      };
    },
  });

  // Story 4.10b — runAutoMergeGate: auto-merge gate for done-ready-for-merge PRs.
  // Reads done/<ref>.yaml for risk_tier, computeAgreement for the rolling ratio,
  // workspace config for the threshold, then either calls `gh pr merge --squash
  // --delete-branch` (auto-merge) or applies the `needs-human` label (pause).
  // Manual-merge override is preserved by structural omission in SKILL.md — gate
  // is ONLY invoked under the done-ready-for-merge branch. (FR40, FR41, FR42)
  server.registerTool({
    name: "runAutoMergeGate",
    description:
      "Auto-merge gate for a PR that has reached done-ready-for-merge (FR40/FR41/FR42). " +
      "Reads done/<ref>.yaml for risk_tier, computeAgreement for the rolling agreement ratio, " +
      "and workspace config plugin.agreement_threshold (default 0.8). " +
      "Decision: low + met-threshold → gh pr merge --squash --delete-branch; " +
      "all other branches → gh api POST /labels with needs-human. " +
      "dryRun:true skips the gh shell-out. " +
      "Throws AutoMergeGateThresholdInvalidError on invalid thresholdOverride. " +
      "Story 4.10b.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        prNumber: { type: "number" },
        ref: { type: "string" },
        sessionUlid: { type: "string" },
        thresholdOverride: { type: "number" },
        lastNVerdictsOverride: { type: "number" },
        dryRun: { type: "boolean" },
        role: { type: "string" },
      },
      required: ["targetRepoRoot", "prNumber", "ref", "sessionUlid"],
    },
    handler: async (args) => {
      const parsed = {
        targetRepoRoot: args.targetRepoRoot as string,
        prNumber: args.prNumber as number,
        ref: args.ref as string,
        sessionUlid: args.sessionUlid as string,
        thresholdOverride: args.thresholdOverride as number | undefined,
        lastNVerdictsOverride: args.lastNVerdictsOverride as number | undefined,
        dryRun: args.dryRun as boolean | undefined,
        role: args.role as string | undefined,
      };
      try {
        const result = await runAutoMergeGate(parsed);
        AutoMergeGateResultSchema.parse(result);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 5.11 — scanOrphanedInProgress: pure read-only scan of in-progress/
  // for manifests whose claimed_by ULID differs from the current session ULID.
  // Returns orphans in alphabetical ref order. No write side-effects.
  server.registerTool({
    name: "scanOrphanedInProgress",
    description:
      "Scan <targetRepoRoot>/.crew/state/in-progress/ for manifests whose claimed_by ULID " +
      "is defined and does not match sessionUlid. Returns orphans in alphabetical ref order, " +
      "each with hasTranscript flag indicating whether the Story 5.10 transcript file exists. " +
      "Pure read-only — no write side-effects. Story 5.11.",
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
        const result = await scanOrphanedInProgress(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 5.11 — reattachOrphan: atomic claimed_by rewrite for the
  // transcript-present orphan-recovery path. Rewrites manifest.claimed_by
  // from stale ULID to currentSessionUlid. Throws NotAnOrphanError on race.
  server.registerTool({
    name: "reattachOrphan",
    description:
      "Reattach an orphaned in-progress manifest to the current session by rewriting " +
      "claimed_by from the stale ULID to currentSessionUlid. Used by the transcript-present " +
      "path of the orphan-recovery branch in /crew:start. " +
      "Throws NotAnOrphanError when claimed_by already matches currentSessionUlid (race). " +
      "Throws ManifestNotFoundError when the ref is absent from in-progress/. Story 5.11.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        ref: { type: "string" },
        currentSessionUlid: { type: "string" },
      },
      required: ["targetRepoRoot", "ref", "currentSessionUlid"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          targetRepoRoot: z.string().min(1),
          ref: z.string().min(1),
          currentSessionUlid: z.string().min(1),
        })
        .parse(args);
      try {
        const result = await reattachOrphan(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });

  // Story 5.11 — blockOrphanNoTranscript: atomic move + blocked_by stamp for the
  // no-transcript orphan-recovery path. Moves manifest from in-progress/ to
  // blocked/ and stamps blocked_by: orphan-no-transcript.
  server.registerTool({
    name: "blockOrphanNoTranscript",
    description:
      "Handle an orphaned in-progress manifest with no persisted transcript by moving it " +
      "from in-progress/ to blocked/ and stamping blocked_by: orphan-no-transcript. " +
      "Used by the no-transcript path of the orphan-recovery branch in /crew:start. " +
      "Throws ManifestNotFoundError when the ref is absent from in-progress/. Story 5.11.",
    inputSchema: {
      type: "object",
      properties: {
        targetRepoRoot: { type: "string" },
        ref: { type: "string" },
        staleUlid: { type: "string" },
      },
      required: ["targetRepoRoot", "ref", "staleUlid"],
    },
    handler: async (args) => {
      const parsed = z
        .object({
          targetRepoRoot: z.string().min(1),
          ref: z.string().min(1),
          staleUlid: z.string().min(1),
        })
        .parse(args);
      try {
        const result = await blockOrphanNoTranscript(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DomainError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err.name, message: err.message }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  });
}
