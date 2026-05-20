---
name: crew:ask
description: Open a non-mutating side-session with a hired role — ask one question, get one answer.
allowed_tools: [Read, Task]
---

# /crew:ask

# What this skill does

Opens a one-shot side-session against a hired role. The role's persona prompt is assembled from `team/<role>/PERSONA.md`, the operator's question is delivered, and the response is printed back verbatim.

The side-session is **non-mutating by contract** — the role MAY read PR comments, story manifests, persona files, and `docs/standards.md` to answer, but ALL canonical-state writes are refused at the MCP server boundary (`_meta.role: ask-mode`). The role cannot hire new personas, record verdicts, append knowledge, or perform any write-shaped operation. If the role surfaces an insight worth retaining, the operator captures it manually.

This is a one-shot surface: one question, one response. For follow-up questions, invoke `/crew:ask` again. Responses are printed verbatim — no Markdown beautification, no "the planner says:" prefix.

**Canonical use case (FR76):** Ask the planner to translate a reviewer's verdict comment without breaking the dev loop.
`/crew:ask planner "explain this reviewer verdict comment: ..."`

If your team is not yet hired, run `/crew:hire` to go through the full hiring conversation, or `/crew:skip-hiring` to instantly hire the default roster. To see who is currently hired (including role ids), run `/crew:team`.

# Prerequisites

A target repo with the specific `<role>` already hired — i.e. `<target-repo>/team/<role>/PERSONA.md` exists and parses. Created by `/crew:hire` or `/crew:skip-hiring`.

`.crew/config.yaml` is NOT required. The skill takes `targetRepoRoot` directly; the adapter is not consulted.

# Steps

1. **Parse invocation arguments.** Extract `<role>` (single token, kebab-case role id) and `<question>` (the remaining quoted string) from the slash-command invocation. If `<role>` is empty or `<question>` is empty after parsing, print `Usage: /crew:ask <role> "<question>"` and exit.

2. **Identify the target repo root.** Use the current Claude Code workspace root as `targetRepoRoot`. Do NOT call `getStatus` — adapter resolution is not needed.

3. **Verify the role is hired.** Call `readPersona({ targetRepoRoot, role: <role> })`.
   - If it throws `PersonaFileNotFoundError`, print the following block verbatim (substituting `<role>` with the operator-typed token) and exit:
     ```
     crew:ask — role "<role>" is not hired in this repo.

     Run /crew:hire to hire a project-shaped team (interactive), or /crew:skip-hiring to hire the default roster (planner, generalist-dev, generalist-reviewer, retro-analyst, orchestrator).

     If you meant a different role id, run /crew:team to see your current roster.
     ```
   - If it throws `PersonaFileMalformedError`, print `crew:ask — persona for "<role>" is malformed: <zod-message>. Open <target-repo>/team/<role>/PERSONA.md and fix the malformation; git revert <persona-path> is the bail-out.` and exit.
   - Otherwise capture the persona's `## Prompt` section body.

4. **Assemble the side-session system prompt.** Concatenate:
   - The persona's `## Prompt` body verbatim.
   - A blank line.
   - The literal `<ask-mode>` block below, with `<question>` substituted by the operator's actual question text:

   ```
   <ask-mode>
   You are running in /crew:ask mode. This is a non-mutating side-session.

   You MAY read:
     - PR comments and PR metadata via `gh pr view` and `gh api` read-only paths.
     - Story manifests at <target-repo>/_bmad-output/planning-artifacts/stories/*.md (or the active adapter's equivalent).
     - Persona files at <target-repo>/team/<role>/PERSONA.md.
     - The standards doc at <target-repo>/docs/standards.md (or the configured standards path).

   You MUST NOT mutate canonical state. The MCP server will refuse any tool call
   that writes to story manifests, registry, telemetry, or persona files. If you
   need to recommend a mutation, surface it as plain text in your reply — the
   operator will decide whether to run the corresponding skill (e.g. `/crew:hire`
   to hire a missing role, the dev-loop to record a verdict, etc.).

   Your reply is the operator's one-shot answer to: <question>
   </ask-mode>
   ```

5. **Spawn the side-session subagent.** Use the Claude Code `Task` tool. Pass the assembled system prompt and the operator's `<question>` verbatim as the initial user message. The `Task` invocation should carry `_meta.role: "ask-mode"` so the MCP server's permission boundary refuses any canonical-state mutation attempt. The ask-mode allowlist (`permissions/ask-mode.yaml`) permits only read-shaped tools (`getStatus`, `readCatalogue`, `readPersona`, `lookupRoleByDomain`, `readRepoSignals`, `readCustomRole`, `getTeamSnapshot`, `heartbeat`) and a single `gh` subcommand (`pr-view`).

6. **Print the subagent's final reply verbatim.** No post-processing. No "the planner says:" prefix. The skill body is a pipe.

# Failure modes

- **Role not hired:** the skill prints the error block from Step 3 and exits. Run `/crew:hire` to hire interactively, or `/crew:skip-hiring` to hire the default roster.
- **Persona file malformed:** the skill prints a diagnostic naming the path and the Zod issue, and exits. Open the persona file directly (it is plain Markdown per NFR25) and fix the malformation; `git revert <persona-path>` is the bail-out.
- **Empty `<question>`:** the skill prints the usage line and exits. Re-invoke with a quoted question.
- **The asked role yields to a different role (locked-phrase yield in its reply):** the yield (`This sits in <role>'s domain — handing off.`) is surfaced as plain text in the printed reply. `/crew:ask` does NOT chain — the operator decides whether to re-invoke `/crew:ask` against the yielded-to role.
- **Subagent attempts a canonical-state mutation:** the MCP server refuses at the `_meta.role: ask-mode` boundary (`PermissionDeniedError`); the subagent observes the refusal as a tool error and — per the `<ask-mode>` prompt block — surfaces it as plain text in the final reply.
- **Subagent attempts a write-shaped `gh` subcommand (`pr-comment`, `pr-create`, `pr-review`, `pr-close`, `pr-merge`):** the `gh_allow` allowlist refuses; same refusal-surface as above.
