# crew

AI Engineering Team v1 — a Claude Code plugin that drives a continuous-flow backlog of stories through dev and review subagents.

See `_bmad-output/planning-artifacts/prd-crew-v1/index.md` for the PRD.

## Install

Six checkpoints from clone to "the plugin sees my repo": [`docs/README-install.md`](docs/README-install.md).

Full first-run walkthrough (running the bundled example sprint, scanning sources, opening your first PR) lands in Epic 7 Story 7.2.

## Available skills

- `/crew:plan` — open a planning conversation. On native repos, spawns the planner subagent to author stories under `.crew/native-stories/`; on BMad repos, points you at BMad's authoring skills.
- `/crew:scan` — project your planning tool's source stories into per-story execution manifests under `.crew/state/to-do/`. Idempotent on re-run.
- `/crew:status` — print the current plugin version, target repo, adapter, and standards-doc state.
- `/crew:hire` — open a hiring conversation; the hiring manager reads your repo and proposes a starting team.
- `/crew:team` — print a one-shot snapshot of your hired team.
- `/crew:ask` — ask a single question to a hired role and get one answer.

## Standards doc

Every reviewer verdict reads `<target-repo>/docs/standards.md`. The install walkthrough's checkpoint 5 copies the shipped template (`plugins/crew/docs/standards-example.md`) into your target repo.
