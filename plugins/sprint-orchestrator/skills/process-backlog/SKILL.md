---
name: process-backlog
description: Drive the sprint backlog to completion. Phase 1 — only the ping smoke test is wired up.
user-invocable: true
allowed-tools:
  - "mcp__sprint-orchestrator__ping"
---

# process-backlog (Phase 1 smoke test)

The full backlog loop lands in Phase 4. For now this skill exists to prove the plugin's MCP server is reachable.

When invoked: call the `mcp__sprint-orchestrator__ping` tool with `message: "hello from skill"` and report what came back, then stop. Do not do anything else.
