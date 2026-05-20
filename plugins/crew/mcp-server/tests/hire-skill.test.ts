/**
 * Story 2.4 AC1–AC5 — `/crew:hire` skill, `readRepoSignals` MCP tool,
 * hiring-manager permission allowlist, integration harness.
 *
 * See `plugins/crew/docs/user-surface-acs.md` for the user-surface AC
 * rubric (Story 1.8 convention). AC1–AC4 are tagged `(user-surface)`;
 * AC5 (this integration harness) is NOT user-surface — operators never
 * type `pnpm --dir plugins/crew test`. The harness asserts the SKILL'S
 * TOOL ORCHESTRATION — which MCP tools are called, with what args, and
 * the persona-file side effects — not LLM conversational behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";
import { execa } from "execa";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createServer } from "../src/server.js";
import { registerAllTools } from "../src/tools/register.js";
import { readRepoSignals } from "../src/tools/read-repo-signals.js";
import { readCatalogue } from "../src/tools/read-catalogue.js";
import { readPersona } from "../src/tools/read-persona.js";
import * as instantiatePersonaModule from "../src/tools/instantiate-persona.js";
import { getPluginRoot } from "../src/lib/plugin-root.js";
import { parsePersonaFile } from "../src/lib/persona-file.js";
import { parseCatalogueRole } from "../src/lib/markdown-frontmatter.js";
import { loadRolePermissions } from "../src/state/load-role-permissions.js";
import {
  RepoSignalsSchema,
  type RepoSignals,
} from "../src/schemas/repo-signals.js";
import { PersonaAlreadyExistsError } from "../src/errors.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");

const FIXED_HIRED_AT = "2026-06-01T12:00:00.000Z";
const FIXED_VERSION = "0.1.0";
const FIXED_CLOCK = () => new Date(FIXED_HIRED_AT);

const DEFAULT_ROSTER = [
  "planner",
  "generalist-dev",
  "generalist-reviewer",
  "retro-analyst",
  "orchestrator",
] as const;

const VALID_CONFIG_YAML = `adapter: bmad
adapter_config:
  stories_root: _bmad-output/planning-artifacts/stories
plugin: {}
`;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
} as const;

async function makeTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `crew-hire-${prefix}-`));
}

async function seedConfig(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".crew"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".crew", "config.yaml"),
    VALID_CONFIG_YAML,
    "utf8",
  );
}

async function seedFreshFixture(root: string): Promise<void> {
  await seedConfig(root);
  await fs.writeFile(path.join(root, "README.md"), "# Test target repo\n", "utf8");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.1" }) + "\n",
    "utf8",
  );
  await execa("git", ["init", "-q"], { cwd: root, env: GIT_ENV });
  await execa(
    "git",
    ["commit", "-q", "-m", "init", "--allow-empty"],
    { cwd: root, env: GIT_ENV },
  );
}

const tmpDirs: string[] = [];
afterEach(async () => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try {
      await fs.rm(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ---------------------------------------------------------------------------
// In-process subagent stub — simulates the skill's orchestration without
// spawning Claude Code (Task 7.3). It encodes the SAME default-roster
// decision the catalogue prompt body authors, so the test asserts the
// tool-side contract (call counts + side effects), not LLM behaviour.
// ---------------------------------------------------------------------------

type HireResponse =
  | "approve all"
  | "decline"
  | "done"
  | `approve ${string}`
  | `add ${string}`;

interface HireFlowResult {
  signals: RepoSignals;
  currentRoster: Array<{ role: string; domain: string; hired_at: string }>;
  confirmations: string[];
  reentryBlock: string;
  instantiateCalls: string[];
}

async function listExistingRoster(
  targetRepoRoot: string,
): Promise<Array<{ role: string; domain: string; hired_at: string }>> {
  const teamDir = path.join(targetRepoRoot, "team");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(teamDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const roles = entries
    .filter((name) => name !== "custom" && name !== "_archived")
    .filter((name) => !name.startsWith("."))
    .sort();
  const roster: Array<{ role: string; domain: string; hired_at: string }> = [];
  for (const role of roles) {
    const personaFile = path.join(teamDir, role, "PERSONA.md");
    if (!existsSync(personaFile)) continue;
    const persona = await readPersona({ targetRepoRoot, role });
    roster.push({
      role: persona.role,
      domain: persona.domain,
      hired_at: persona.hired_at,
    });
  }
  return roster;
}

async function runHireFlow(opts: {
  targetRepoRoot: string;
  response: HireResponse;
}): Promise<HireFlowResult> {
  const signals = await readRepoSignals({
    targetRepoRoot: opts.targetRepoRoot,
  });
  // The subagent system prompt is the catalogue Prompt section; we call
  // readCatalogue here to mirror the skill's read (and ensure the
  // catalogue is exercised by the harness).
  await readCatalogue({ pluginRoot: getPluginRoot(), role: "hiring-manager" });

  const currentRoster = await listExistingRoster(opts.targetRepoRoot);

  const confirmations: string[] = [];
  const instantiateCalls: string[] = [];
  let reentryBlock = "";

  if (currentRoster.length > 0) {
    // Re-entry mode (AC4). The subagent's first reply lists the existing
    // roster and ends with the verbatim re-entry prompt line.
    const lines = currentRoster.map(
      (r) => `${r.role} — ${r.domain} — hired ${r.hired_at}`,
    );
    const prompt =
      "Hire one more (specify catalogue role id), unhire <role>, view-persona <role>, or done.";
    reentryBlock = ["Currently hired:", "", ...lines, "", prompt].join("\n");

    if (opts.response === "done") {
      // No-op exit.
    } else if (opts.response.startsWith("approve ") || opts.response === "approve all") {
      // Re-entry should not accept approve-all; treat as no-op per AC4.
    } else if (opts.response.startsWith("add ")) {
      const role = opts.response.slice(4);
      const callResult = await callInstantiate(
        opts.targetRepoRoot,
        role,
        instantiateCalls,
        confirmations,
      );
      void callResult;
    }
    return {
      signals,
      currentRoster,
      confirmations,
      reentryBlock,
      instantiateCalls,
    };
  }

  // Fresh-hire mode (AC1–AC3).
  if (opts.response === "decline") {
    confirmations.push(
      "No roles hired. Run /crew:hire again or /crew:skip-hiring to hire the default roster.",
    );
    return {
      signals,
      currentRoster,
      confirmations,
      reentryBlock,
      instantiateCalls,
    };
  }

  if (opts.response === "approve all") {
    for (const role of DEFAULT_ROSTER) {
      await callInstantiate(
        opts.targetRepoRoot,
        role,
        instantiateCalls,
        confirmations,
      );
    }
    return {
      signals,
      currentRoster,
      confirmations,
      reentryBlock,
      instantiateCalls,
    };
  }

  if (opts.response.startsWith("approve ")) {
    const ids = opts.response.slice("approve ".length).split(/\s+/).filter(Boolean);
    for (const role of ids) {
      await callInstantiate(
        opts.targetRepoRoot,
        role,
        instantiateCalls,
        confirmations,
      );
    }
    return {
      signals,
      currentRoster,
      confirmations,
      reentryBlock,
      instantiateCalls,
    };
  }

  if (opts.response.startsWith("add ")) {
    const role = opts.response.slice(4);
    // Validate against the catalogue first per AC3.
    try {
      await readCatalogue({ pluginRoot: getPluginRoot(), role });
    } catch {
      confirmations.push(
        `Unknown catalogue role: ${role}. See plugins/crew/catalogue/ for the v1 roster or use the manual escape hatch under <target-repo>/team/custom/.`,
      );
      return {
        signals,
        currentRoster,
        confirmations,
        reentryBlock,
        instantiateCalls,
      };
    }
    await callInstantiate(
      opts.targetRepoRoot,
      role,
      instantiateCalls,
      confirmations,
    );
    return {
      signals,
      currentRoster,
      confirmations,
      reentryBlock,
      instantiateCalls,
    };
  }

  throw new Error(`harness: unhandled response ${opts.response satisfies never}`);
}

async function callInstantiate(
  targetRepoRoot: string,
  role: string,
  instantiateCalls: string[],
  confirmations: string[],
): Promise<void> {
  instantiateCalls.push(role);
  try {
    const { path: personaPath } = await instantiatePersonaModule.instantiatePersona({
      pluginRoot: getPluginRoot(),
      targetRepoRoot,
      role,
      clock: FIXED_CLOCK,
      pluginVersion: FIXED_VERSION,
    });
    confirmations.push(`Hired: ${role} → ${personaPath}`);
  } catch (err) {
    if (err instanceof PersonaAlreadyExistsError) {
      confirmations.push(`Already hired: ${role} (no change).`);
      return;
    }
    throw err;
  }
}

// ===========================================================================
// AC1 / AC5(a, c) — fresh-empty fixture happy path
// ===========================================================================
describe("Story 2.4 AC1 / AC5(a, c) — fresh-hire happy path", () => {
  it("approve-all writes five default-roster persona files and calls instantiatePersona 5×", async () => {
    const tmp = await makeTmp("ac1");
    tmpDirs.push(tmp);
    await seedFreshFixture(tmp);

    const spy = vi.spyOn(instantiatePersonaModule, "instantiatePersona");

    const result = await runHireFlow({
      targetRepoRoot: tmp,
      response: "approve all",
    });

    // RepoSignals shape and content checks (AC1).
    expect(() => RepoSignalsSchema.parse(result.signals)).not.toThrow();
    expect(result.signals.targetRepoRoot).toBe(tmp);
    expect(result.signals.languages, "AC1 fixture A languages").toContain(
      "TypeScript",
    );
    expect(result.signals.languages).toContain("Markdown");
    expect(result.signals.dependencyManifests).toContain("package.json");
    expect(result.signals.readmeExcerpt).toContain("Test target repo");
    expect(result.signals.recentCommitTitles).toContain("init");

    // Five persona files exist and parse cleanly (AC5(a)).
    for (const role of DEFAULT_ROSTER) {
      const personaPath = path.join(tmp, "team", role, "PERSONA.md");
      const raw = await fs.readFile(personaPath, "utf8");
      const parsed = parsePersonaFile(raw, personaPath);
      expect(parsed.role, `AC5(a) role parity for ${role}`).toBe(role);
    }

    // No specialist hired in fresh-empty fixture.
    for (const specialist of [
      "security-specialist",
      "test-specialist",
      "docs-specialist",
      "debugger",
    ]) {
      expect(
        existsSync(path.join(tmp, "team", specialist, "PERSONA.md")),
        `AC1 no specialist hired: ${specialist}`,
      ).toBe(false);
    }

    // Tool-boundary assertions (AC5(c)).
    expect(result.instantiateCalls.length).toBe(5);
    expect(spy).toHaveBeenCalledTimes(5);
    for (const call of spy.mock.calls) {
      expect((call[0] as { targetRepoRoot: string }).targetRepoRoot).toBe(tmp);
    }
    // Hired confirmation lines count matches calls (AC5(c)).
    const hiredCount = result.confirmations.filter((l) =>
      l.startsWith("Hired: "),
    ).length;
    expect(hiredCount).toBe(spy.mock.calls.length);

    spy.mockRestore();
  });
});

// ===========================================================================
// AC4 / AC5(b, e) — already-hired re-entry
// ===========================================================================
describe("Story 2.4 AC4 / AC5(b, e) — re-entry against existing roster", () => {
  let tmp: string;
  const SEEDED = ["planner", "generalist-dev", "generalist-reviewer"] as const;

  beforeEach(async () => {
    tmp = await makeTmp("ac4");
    tmpDirs.push(tmp);
    await seedConfig(tmp);
    for (const role of SEEDED) {
      await instantiatePersonaModule.instantiatePersona({
        pluginRoot: getPluginRoot(),
        targetRepoRoot: tmp,
        role,
        clock: FIXED_CLOCK,
        pluginVersion: FIXED_VERSION,
      });
    }
  });

  it("done returns the re-entry block, calls instantiatePersona zero times, idempotent on re-run", async () => {
    const spy = vi.spyOn(instantiatePersonaModule, "instantiatePersona");

    const result = await runHireFlow({ targetRepoRoot: tmp, response: "done" });

    // No new hires.
    expect(result.instantiateCalls.length).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    // Re-entry block contains exactly three role lines, each in the
    // pinned `<role> — <domain> — hired <ts>` shape (AC5(b)).
    const roleLineRegex =
      /^([a-z0-9-]+) — (.+?) — hired (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;
    const matchedRoles = new Set<string>();
    for (const line of result.reentryBlock.split("\n")) {
      const m = roleLineRegex.exec(line);
      if (m) {
        matchedRoles.add(m[1]!);
        expect(m[3]).toBe(FIXED_HIRED_AT);
      }
    }
    expect(matchedRoles.size, `AC5(b) three role lines in re-entry block`).toBe(3);
    for (const seeded of SEEDED) {
      expect(matchedRoles.has(seeded)).toBe(true);
    }

    // Verbatim re-entry prompt line (AC4).
    expect(result.reentryBlock).toContain(
      "Hire one more (specify catalogue role id), unhire <role>, view-persona <role>, or done.",
    );

    // Domain cross-check: domain string in each line equals the catalogue's domain.
    for (const role of SEEDED) {
      const cataloguePath = path.join(PLUGIN_ROOT, "catalogue", `${role}.md`);
      const raw = await fs.readFile(cataloguePath, "utf8");
      const cat = parseCatalogueRole(raw, cataloguePath);
      expect(result.reentryBlock).toContain(
        `${role} — ${cat.domain} — hired ${FIXED_HIRED_AT}`,
      );
    }

    // Re-entry idempotency (AC5(e)).
    const second = await runHireFlow({ targetRepoRoot: tmp, response: "done" });
    expect(second.reentryBlock.trimEnd()).toBe(result.reentryBlock.trimEnd());

    spy.mockRestore();
  });

  it("view-persona returns the catalogue Prompt section byte-for-byte (AC5(b)(iv))", async () => {
    const cataloguePath = path.join(PLUGIN_ROOT, "catalogue", "planner.md");
    const raw = await fs.readFile(cataloguePath, "utf8");
    const cat = parseCatalogueRole(raw, cataloguePath);

    // The view-persona action returns the persona's Prompt section
    // verbatim; persona is a verbatim copy of the catalogue Prompt at
    // hire time (Story 2.3 contract).
    const persona = await readPersona({ targetRepoRoot: tmp, role: "planner" });
    expect(persona.sections.Prompt).toBe(cat.sections.Prompt);
  });
});

// ===========================================================================
// AC3 — add path
// ===========================================================================
describe("Story 2.4 AC3 — add <role> path", () => {
  it("rejects unknown catalogue role with the verbatim error string, no instantiation", async () => {
    const tmp = await makeTmp("ac3-unknown");
    tmpDirs.push(tmp);
    await seedFreshFixture(tmp);

    const spy = vi.spyOn(instantiatePersonaModule, "instantiatePersona");

    const result = await runHireFlow({
      targetRepoRoot: tmp,
      response: "add not-a-real-role",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.instantiateCalls.length).toBe(0);
    expect(
      result.confirmations.some((c) =>
        c.startsWith("Unknown catalogue role: not-a-real-role."),
      ),
      `AC3 unknown-role failure line missing — confirmations: ${JSON.stringify(result.confirmations)}`,
    ).toBe(true);

    spy.mockRestore();
  });

  it("add security-specialist instantiates exactly once and writes the persona file", async () => {
    const tmp = await makeTmp("ac3-add");
    tmpDirs.push(tmp);
    await seedFreshFixture(tmp);

    const spy = vi.spyOn(instantiatePersonaModule, "instantiatePersona");

    const result = await runHireFlow({
      targetRepoRoot: tmp,
      response: "add security-specialist",
    });
    expect(result.instantiateCalls).toEqual(["security-specialist"]);
    expect(spy).toHaveBeenCalledTimes(1);
    const personaPath = path.join(
      tmp,
      "team",
      "security-specialist",
      "PERSONA.md",
    );
    expect(existsSync(personaPath), `AC3 specialist persona at ${personaPath}`).toBe(
      true,
    );

    spy.mockRestore();
  });
});

// ===========================================================================
// AC3 — decline path
// ===========================================================================
describe("Story 2.4 AC3 — decline path", () => {
  it("decline emits the No-roles-hired line, no team/ directory created", async () => {
    const tmp = await makeTmp("ac3-decline");
    tmpDirs.push(tmp);
    await seedFreshFixture(tmp);

    const spy = vi.spyOn(instantiatePersonaModule, "instantiatePersona");

    const result = await runHireFlow({ targetRepoRoot: tmp, response: "decline" });
    expect(spy).not.toHaveBeenCalled();
    expect(result.instantiateCalls.length).toBe(0);
    expect(existsSync(path.join(tmp, "team"))).toBe(false);
    expect(result.confirmations).toContain(
      "No roles hired. Run /crew:hire again or /crew:skip-hiring to hire the default roster.",
    );

    spy.mockRestore();
  });
});

// ===========================================================================
// AC5(d) — permission allowlist
// ===========================================================================
describe("Story 2.4 AC5(d) — hiring-manager permission allowlist includes readRepoSignals", () => {
  it("tools_allow contains exactly the six expected entries", async () => {
    const perms = await loadRolePermissions({
      pluginRoot: getPluginRoot(),
      role: "hiring-manager",
    });
    expect([...perms.tools_allow].sort()).toEqual(
      [
        "heartbeat",
        "instantiatePersona",
        "lookupRoleByDomain",
        "readCatalogue",
        "readPersona",
        "readRepoSignals",
      ].sort(),
    );
    expect(perms.gh_allow).toEqual([]);
  });
});

// ===========================================================================
// Task 7.10 — SKILL.md self-consistency
// ===========================================================================
describe("Story 2.4 Task 7.10 — skills/hire/SKILL.md self-consistency", () => {
  it("frontmatter and required body sections are present in order", async () => {
    const skillPath = path.join(PLUGIN_ROOT, "skills", "hire", "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");

    // Frontmatter parse.
    const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    expect(fmMatch, `skills/hire/SKILL.md frontmatter delimiters`).not.toBeNull();
    const fm = yamlParse(fmMatch![1]!) as {
      name: string;
      description: string;
      allowed_tools: string[];
    };
    expect(fm.name).toBe("crew:hire");
    expect(fm.allowed_tools).toEqual(["Read", "Task"]);

    // Body sections in order.
    const body = fmMatch![2]!;
    const required = [
      "# What this skill does",
      "# Prerequisites",
      "# Steps",
      "# Failure modes",
    ];
    let cursor = 0;
    for (const heading of required) {
      const idx = body.indexOf(heading, cursor);
      expect(idx, `SKILL.md missing or out-of-order heading: ${heading}`).toBeGreaterThan(
        -1,
      );
      cursor = idx + heading.length;
    }

    // Body references the slash command literal.
    expect(body).toContain("/crew:hire");
  });
});

// ===========================================================================
// Task 7.11 — end-to-end MCP tool listing
// ===========================================================================
describe("Story 2.4 Task 7.11 — readRepoSignals reachable via MCP", () => {
  it("ListTools includes readRepoSignals and CallTool returns RepoSignals-shaped JSON", async () => {
    const tmp = await makeTmp("mcp-e2e");
    tmpDirs.push(tmp);
    await seedFreshFixture(tmp);

    const server = createServer();
    registerAllTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "story-2-4-test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const list = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    const names = list.tools.map((t) => t.name);
    expect(names).toContain("readRepoSignals");
    // Story 2.3 tools also present.
    expect(names).toContain("readCatalogue");
    expect(names).toContain("instantiatePersona");
    expect(names).toContain("readPersona");
    expect(names).toContain("lookupRoleByDomain");

    const call = await client.request(
      {
        method: "tools/call",
        params: {
          name: "readRepoSignals",
          arguments: { targetRepoRoot: tmp },
        },
      },
      CallToolResultSchema,
    );
    expect(call.isError).toBeFalsy();
    const block = (call.content as Array<{ type: string; text: string }>)[0]!;
    expect(block.type).toBe("text");
    const parsed = JSON.parse(block.text);
    expect(() => RepoSignalsSchema.parse(parsed)).not.toThrow();
    expect(parsed.targetRepoRoot).toBe(tmp);

    await client.close();
    await server.close();
  });
});
