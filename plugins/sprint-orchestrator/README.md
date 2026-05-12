# sprint-orchestrator

A Claude Code plugin that turns sprint backlogs into autonomous-but-supervised execution. Deterministic state and guardrails live in TypeScript; the LLM only does the irreducibly fuzzy parts (implementation, review).

Works standalone or with BMAD v6 planning artefacts. When BMAD layout is detected, the plugin auto-configures; otherwise it asks once where your PRD / architecture / story files live.

## Status

**Phase 1 — skeleton.** Scaffolding only. Tools, hooks, and agents are stubs. See `project.md` for the full build spec.

## Install

```bash
git clone <this-repo>
cd sprint-orchestrator
pnpm install
pnpm -r build
```

Then in Claude Code:

```
/plugin install <path-to-this-repo>
```

## Usage

```
/sprint-orchestrator:process-backlog
```

On first run in a project, the plugin asks where your planning docs live (or detects BMAD v6 layout automatically) and writes `.sprint-orchestrator/config.yaml`.

## Modes

- **Interactive** — installed into Claude Code, triggered via the slash command. Watch it run; intervene as needed.
- **Unattended** — `packages/sdk-runner` runs the same plugin via `@anthropic-ai/claude-agent-sdk` with no UI. Suitable for daemons / scheduled jobs.

## Development

```bash
pnpm -r build       # compile all packages
pnpm -r test        # vitest
pnpm -r typecheck   # tsc --noEmit
pnpm lint           # eslint
```

## License

MIT
