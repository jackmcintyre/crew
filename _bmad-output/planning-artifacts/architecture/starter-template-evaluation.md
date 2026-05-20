# Starter Template Evaluation

## Primary Technology Domain

**Claude Code plugin** — locally-installable, by-repo distribution. Plugin contains: agent catalogue (Markdown), skills (Markdown slash-commands), an MCP server (state-machine boundary), example artifacts, and a `.claude-plugin/marketplace.json` manifest. Runs *inside* the user's existing Claude Code installation; no bundled runtime, no separate process manager.

## Starter Options Considered

No general-purpose "create-claude-code-plugin" CLI scaffold exists. Claude Code plugins are authored directly against the plugin contract. Options examined:

1. **No external starter — scaffold directly against the Claude Code plugin contract**, reusing stack choices proven in this repo's retired `sprint-orchestrator` plugin (TypeScript MCP server via `@modelcontextprotocol/sdk`, pnpm workspace, vitest).
2. **Generic TypeScript-MCP-server starter** (e.g. `@modelcontextprotocol/create-server`). Covers only the MCP server piece; provides nothing for skills / agents / catalogue / persona files; adds an unfamiliar default layout to fight.
3. **Fork-from-`sprint-orchestrator`.** PRD explicitly says "borrow code and patterns where useful, but the new product is not obliged to coexist with it." Source was removed in commit `ed66ee6`; only build artifacts remain. Borrowing happens at the *pattern* level (claim-by-mv, MCP tool layout, hooks structure), not at the code level.

## Selected Starter

**No external starter — scaffold directly + inherit `sprint-orchestrator` stack choices.**

**Rationale.** The PRD pins almost every decision a starter would normally make (file shapes, runtime, state machine, integration surface). The remaining stack choices (TypeScript vs Python for the MCP server, pnpm vs npm, test framework) have a strong local precedent in the retired plugin that worked end-to-end in this same repo. Adopting a generic MCP-server starter would force a layout fight without buying anything; adopting a web/CLI starter would be actively misleading.

## Initialization

Directory scaffold authored manually as the first implementation story (not a CLI command). Target shape (architecture-step decisions still to make may rename/move things):

```
plugins/<plugin-name>/
  .claude-plugin/
    plugin.json            # plugin manifest, declares skills/agents/mcp-server
  catalogue/
    <role>.md              # one Markdown spec per role template
  skills/
    <skill>.md             # one Markdown file per slash-command
  mcp-server/              # TypeScript MCP server (Node, @modelcontextprotocol/sdk)
    src/
    package.json
    tsconfig.json
    vitest.config.ts
  docs/
    standards-example.md   # copy-target template shipped with the plugin
    risk-tiering.md        # FR40a deliverable (architecture phase)
  example/                 # bundled target repo for the canonical scenario
    _bmad-output/...       # example BMad-shaped source stories
    .crew/
      config.yaml
      state/{to-do,in-progress,blocked,done}/
    docs/standards.md
.claude-plugin/
  marketplace.json         # repo-level marketplace entry (reused shape)
```

## Architectural Decisions Provided by This Approach

**Language & Runtime (MCP server):** TypeScript on Node, packaged with pnpm workspaces. Inherits the sprint-orchestrator stack; matches `@modelcontextprotocol/sdk` first-class support.

**Styling Solution:** N/A — no plugin-owned UI; user-facing surfaces are terminal text, GitHub PR comments, and local Markdown files.

**Build Tooling:** TypeScript compiler + pnpm. Skills and agents are authored Markdown — no build step.

**Testing Framework:** vitest (same precedent as the retired plugin); integration tests cover the recoverable-session-death scenarios from NFR7 and the no-silent-failure assertion from NFR6.

**Code Organization:** plugin-shipped catalogue templates separated from target-repo persona instances; MCP tools as the only state-mutation boundary; filesystem layout as the canonical state machine.

**Development Experience:** plain Markdown for skills and agents (no compile step on the authoring surface); MCP server built and run via pnpm scripts; integration tests via vitest.

## Decisions Deferred to Upcoming Architecture Steps

- Exact MCP tool surface (what tools the server exposes, names, signatures).
- Whether the plugin and target repo share a single workspace root or are split via configurable path.
- Logging library, structured-error library, schema-validation library for frontmatter.
- Specific risk-tier classification rules (FR40a) and the spec file format.

**Note:** "Scaffold the plugin skeleton" should be the first implementation story.
