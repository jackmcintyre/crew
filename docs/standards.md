version: "0.2.0"
updated: "2026-05-25"
criteria:
  - name: "story-aligned"
    what: "The PR's diff implements only what the story's acceptance criteria require."
    check: "Map each diff hunk to one or more ACs; flag any hunk that maps to none."
    anti_criterion: "Scope creep: refactors or rewrites that the story did not request."

  - name: "tests-cover-acs"
    what: "Every AC has at least one assertion in the test suite that fails when the AC behaviour is removed. AC tags imply test type: `(integration)` → at least one integration-suite test; `(user-surface)` → at least one test that exercises the operator-visible surface (slash command, MCP tool boundary, or rendered CLI string)."
    check: "For each AC, locate the named test(s) in the diff. Verify the test would fail if the AC implementation were reverted. Confirm tagged ACs have the matching test type."
    anti_criterion: "Tests that exercise happy paths without asserting the AC's specific behaviour, or that mock past the seam the AC describes."

  - name: "no-canonical-fs-writes-outside-mcp"
    what: "No code path writes to canonical-state paths (`.crew/state/**`, `team/**/PERSONA.md`, `.crew/telemetry/**`, `docs/standards.md`) except through MCP tools using the `managed-fs` seam."
    check: "Grep the diff for `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile`, `fs.appendFileSync`, `fs.rename`, `fs.unlink`. Any hit targeting a canonical path that bypasses `writeManagedFile`/`renameManagedFile` is a fail."
    anti_criterion: "Direct `fs.*` writes to `.crew/state`, telemetry, persona files, or `docs/standards.md` from skill prose, persona prompts, or non-MCP code paths."

  - name: "errors-are-typed"
    what: "Every named failure mode in the diff throws a `DomainError` subclass (defined in `plugins/crew/mcp-server/src/errors.ts`) with a one-line operator-facing message; uncaught throws and generic `Error` for known failures are bugs."
    check: "Inspect new throw sites. Assert they throw a class extending `DomainError`. Verify the message reads as operator guidance, not a stack trace or internal jargon."
    anti_criterion: "`throw new Error('...')`, returning `{ error: '...' }` envelopes for known failures, or `DomainError` messages that leak internal state shape."

  - name: "dist-in-sync-with-src"
    what: "If `plugins/crew/mcp-server/src/` changed, `plugins/crew/mcp-server/dist/` is rebuilt and committed in the same PR. CI fails on drift."
    check: "Diff `plugins/crew/mcp-server/src/**` against `plugins/crew/mcp-server/dist/**`; any src change without a matching dist change is a fail."
    anti_criterion: "Source-only commits that leave `dist/` stale, because `/plugin install` copies the tree as-is and won't run a build step."

  - name: "deterministic-seams-over-prose"
    what: "Load-bearing decisions (verdicts, claims, status flips, handoffs, agreement, risk classification) live in tool-written artefacts on disk, not in LLM prose. Personas read structured tool returns; they do not invent state."
    check: "Trace each new decision point: is the source of truth a tool return / JSON file under `.crew/state/sessions/<ulid>/`, or a sentence in a `SKILL.md` / persona prompt? If the latter, fail."
    anti_criterion: "`MUST-call-X` prose in `SKILL.md` as the only enforcement; persona prompts that compose verdicts without a tool seam to ground them."

  - name: "locked-phrases-intact"
    what: "Sentinel phrases used as parser inputs — handoff (`Handoff to <role> — <intent>`), yield (`This sits in <role>'s domain — handing off`), verdict (`**Verdict: <SENTINEL>**`) — must appear verbatim in any persona, SKILL.md, or catalogue file that emits them. Paraphrasing breaks the deterministic parsers and routes work into `blocked/` with `blocked_by: handoff-grammar`."
    check: "In any diff touching `team/**/PERSONA.md`, `plugins/crew/catalogue/**.md`, or `plugins/crew/skills/**/SKILL.md`, grep for the three sentinel shapes. Flag any drift (extra trailing prose, missing dash, swapped quotes, paraphrased verb)."
    anti_criterion: "Personas or skill prose that append a trailing sentence after the handoff phrase, e.g. `Handoff to reviewer — story 4.10 ready for review. Let me know if you need anything else.` (Surfaced in 4.3c + 4.6 smokes.)"

  - name: "user-surface-acs-verifiable"
    what: "Any AC tagged `(user-surface)` must have an explicit verification path the operator can walk without reading code — a slash-command output, an MCP tool's rendered text, or a file path the operator opens. Story 1.8 introduced this tag; the reviewer must be able to point to the path the operator takes."
    check: "For each AC tagged `(user-surface)`, name the operator-facing artefact (skill output, CLI string, rendered file). If the only verification is `read the source code`, the AC is mis-tagged or the implementation skipped the user surface."
    anti_criterion: "ACs tagged `(user-surface)` whose verification reduces to inspecting internal state, vitest assertions, or non-rendered TypeScript types."

  - name: "no-half-finished"
    what: "Code lands complete inside the story's scope — no `TODO`, `FIXME`, `XXX`, `STUB`, or `throw new NotImplementedError()` markers in shipped non-test paths. Tests may use `it.skip` only with an inline comment naming the follow-up story."
    check: "Grep the diff for `TODO|FIXME|XXX|STUB|NotImplementedError|it\\.skip|describe\\.skip` outside `__tests__/**`. Any hit in a non-test path is a fail unless explicitly carved out by the story's `## What this story does NOT do`."
    anti_criterion: "Half-built features hidden behind TODOs; placeholder error throws meant to be filled in `the next story`; skipped tests with no follow-up reference."

  - name: "no-direct-commits-to-main"
    what: "Every PR's head branch is NOT `main`. Direct commits to `main` cause divergence on squash-merge (per project memory `feedback_never_commit_to_local_main.md`)."
    check: "Read the PR's head-branch name from `gh pr view`. If it equals `main` or `master`, fail."
    anti_criterion: "Hotfixes pushed directly to `main` to bypass review; rebases that linearise feature branches onto a divergent local `main`."
