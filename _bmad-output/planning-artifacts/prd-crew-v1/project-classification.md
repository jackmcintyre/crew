# Project Classification

- **Project Type:** Claude Code plugin (locally installable, by-repo distribution; no npm channel in v1).
- **Domain:** AI agent orchestration / developer tooling. No regulated-domain data flows in v1.
- **Complexity:** High — multi-session coordination via filesystem, LLM nondeterminism in dev/reviewer/retro agents, calibration risk over time, risk-tier rules that must evolve from data, and a continuous-flow runtime that has to stay coherent across long-running sessions.
- **Project Context:** Greenfield. No installed users, no backwards-compatibility burden. The existing `sprint-orchestrator` plugin in this repo is treated as a learning stepping-stone — borrow code and patterns where useful, but the new product is not obliged to coexist with it or retain its sprint construct.
