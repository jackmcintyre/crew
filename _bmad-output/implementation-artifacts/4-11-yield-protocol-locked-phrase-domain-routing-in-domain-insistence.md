# Story 4.11: Yield protocol — locked phrase, domain routing, in-domain insistence

story_shape: user-surface

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **plugin operator**,
I want **generalist reviewers to yield to hired specialists when work falls inside a specialist's declared `domain:`, and specialists to refuse to defer inside their own domain**,
so that **the "AI reviews AI" rubber-stamping failure mode is structurally avoided: when I hire a security specialist, security-flavoured PRs are reviewed by the specialist (clean context, specialist persona, specialist locked phrases) — not silently waved through by the generalist reviewer that lacks the domain reflexes to push back**.

### What this story is, in one sentence

Wire the yield locked phrase (`This sits in <role>'s domain — handing off.`) through a deterministic tool-layer parser (`parseYield`) plus a routing helper (`routeYield`, sitting atop the shipped `lookupRoleByDomain` tool); when a reviewer subagent emits the phrase on its last non-empty line, the SKILL.md inner cycle parses the phrase, calls `routeYield`, and either (a) spawns a specialist reviewer subagent with a clean context via the existing `buildPersonaSpawnPrompt` + `Task` seam, (b) stamps `blocked_by: routing-failure` on the in-progress manifest and surfaces `[routing-failure] no hired role matches domain "<x>"` when no hired role matches, or (c) refuses to act on the yield when the specialist is yielding into its own domain (in-domain insistence, enforced in the parser's `kind: "self-yield-rejected"` return); a new `yield.handoff` telemetry event records every successful routing; vitest covers the five branches against a fixture with a hired `security-specialist`.

### What this story does (and why it needs its own story)

Two prior stories established the substrate this story consumes:

1. **Story 2.3 / Story 2.4** shipped `domain:` as a first-class field on every persona file (`plugins/crew/mcp-server/src/lib/persona-file.ts`) plus `lookupRoleByDomain` (`plugins/crew/mcp-server/src/tools/lookup-role-by-domain.ts`, already registered in `register.ts:143`). That tool already does exact-match byte-equality domain → role lookup over `<targetRepoRoot>/team/`. **This story does not re-implement domain lookup.**
2. **Story 2.4** also shipped the persona-catalogue `locked_phrases.yield` field; `plugins/crew/catalogue/security-specialist.md:14` already carries `yield: "This sits in <role>'s domain — handing off"`. `buildPersonaSpawnPrompt` (`plugins/crew/mcp-server/src/tools/build-persona-spawn-prompt.ts:117`) already lifts that phrase into every spawned reviewer's system prompt and emits the substitution-instruction line. **This story does not add the yield phrase to persona prompts.**

What is missing — and what this story ships — is the **runtime side** of the contract:

- The dev session can spawn a reviewer subagent, get its transcript back, parse a `Handoff to reviewer — ...` phrase, and parse a `**Verdict: ...**` line (Story 4.3, 4.6, 4.8b). But there is **no parser today for the yield phrase**, no router that translates yield → specialist spawn, and no telemetry event recording handoffs. Until those land, every yield phrase emitted by a generalist-reviewer is invisible to the runtime — the specialist is never spawned, and the generalist's chat-only "yield" becomes a no-op that the verdict line then contradicts. That is the rubber-stamp failure mode FR99–FR104 were written to close.
- Story 4.11 is the story that closes it. The work splits cleanly into (a) a pure parser mirroring `handoff-parser.ts`, (b) a routing helper that joins the parser to `lookupRoleByDomain` and returns a discriminated-union result the SKILL.md prose switches on, (c) a SKILL.md inner-cycle branch that calls the router and dispatches to `Task` spawn / `writeManagedFile` block / no-op, (d) a `YieldHandoffEventSchema` joining the discriminated telemetry union plus a single `logTelemetryEvent` call from the routing path, and (e) an integration suite that drives the five branches end-to-end.

Three reasons this is its own story rather than folded into Story 4.6, 4.8b, or 4.12:

1. **Different review surface from Story 4.8b (handoff-parser hardening).** 4.8b hardened the dev→reviewer handoff parser and the PR-URL extractor — pure-function moves into the tool layer. This story adds a NEW parser and a NEW router, both with their own behavioural contracts and test surfaces. The locked-phrase grammar-drift findings memorialised in memory (`project_locked_phrase_grammar_drift.md`) explicitly cite the yield phrase as the next at-risk parse — that memory predicts this story.
2. **Specialist hiring already shipped; v1 specialists exist in the catalogue.** `plugins/crew/catalogue/security-specialist.md`, `test-specialist.md`, `docs-specialist.md`, `debugger.md` are all shipped and instantiable today. The integration suite needs a hired specialist; the fixture loads `security-specialist` as the test target. There is no upstream-blocker reason to wait.
3. **Telemetry schema widening lands here, not in Story 4.12.** Story 4.12 ships the `agent.invoke` writer wiring and `reviewer.verdict` schema + writer. The `yield.handoff` event type is a SEPARATE addition — different shape (carries `from_role`, `to_role`, `triggering_domain`), different emitter (called from the routing helper, not from `runReviewerSession` or the dev-session spawn loop). Co-locating the `yield.handoff` schema with its first writer matches the pattern Story 4.10 set (schema widening lands with first reader/writer, not separately).

### What this story does NOT

- **(a) Touch `_bmad-output/implementation-artifacts/sprint-status.yaml` or any other file under `_bmad-output/implementation-artifacts/`.** The orchestrator owns status transitions. The dev agent MUST NOT edit any status/state file when implementing this story.
- **(b) Modify `lookupRoleByDomain` or the persona-file schema.** Both shipped in Story 2.3 / 2.4. Exact-match byte-equality is pinned (`core-architectural-decisions.md:18`); this story does not relax it, does not add case-folding, does not add trimming, does not add fuzzy matching, does not add ambiguity diagnostics, does not change the "first match wins" rule for hand-edited collisions (`lookup-role-by-domain.ts:35-39`).
- **(c) Add a new persona file, modify any shipped persona's `domain:` field, or change the `locked_phrases.yield` template in any catalogue file.** The yield phrase in shipped personas is `This sits in <role>'s domain — handing off` (no trailing period; see `catalogue/security-specialist.md:14`). This story's parser MUST accept the phrase **with the trailing period** as written in Epic 4 AC1 and the PRD FR100 quote — and Subtask 1.4 patches the four catalogue personas (`security-specialist`, `test-specialist`, `docs-specialist`, `debugger`) to add the period so catalogue templates match the parser. The catalogue patch is mechanical (single character added per file); no persona semantics change.
- **(d) Implement the in-domain-insistence guard inside the specialist's persona prompt itself.** AC2's "specialist refuses to defer inside its own domain" is enforced at the routing layer: `parseYield` returns `kind: "self-yield-rejected"` when the named role in the yield phrase equals the **emitting** role (i.e. the yielding subagent is the specialist for the domain it is being asked to defer in). The SKILL.md prose swallows that result and keeps the specialist's verdict authoritative. Pinning the refusal in the runtime (deterministic seam) rather than in persona prose follows the principle in memory `feedback_default_to_deterministic_seams.md` — load-bearing decisions live in tool-written artefacts.
- **(e) Add a `dev` yield path.** Yield is a **reviewer-only** pattern in v1 (Epic 4 AC1 says "a generalist reviewer encountering work…"). The dev subagent's handoff parser (`handoff-parser.ts`) is unchanged. A future story can add dev-side yield if hired specialist-devs (e.g. a security-implementation specialist) need the same routing; out-of-scope here.
- **(f) Implement yield-loop / cycle detection.** If specialist A yields to specialist B and B yields to A, v1 allows the cycle — the operator hits Story 4.12's 8-min reviewer wall-clock timeout (NFR2) and `needs-human` label fires. A `yield-cycle` blocked_by is deferred work; v1 trusts catalogue domain non-overlap.
- **(g) Add an "ambiguous domain match" surface.** `lookup-role-by-domain.ts:35-39` documents the collision behaviour: hand-edited collisions return the first match in OS-dependent filesystem order. v1 routing inherits this. A diagnostic for ambiguous routes is deferred work tracked in the lookup tool's TSDoc (Story 2.3 deferred item).
- **(h) Add a `yield.handoff.failed` telemetry event for routing-failure cases.** Per FR103 / NFR29, telemetry records successful handoffs (so retros can observe which roles fire how often). Routing failures are surfaced on the orchestration surface AND stamped as `blocked_by: routing-failure` on the manifest — that is the durable evidence trail. v1 does NOT emit a `yield.handoff.failed` event. If retro analysts later want a fire-count of failed routings, a follow-up can widen the schema; v1 keeps the event set minimal (closed v1 set per `schemas/telemetry-events.ts:8`).
- **(i) Add a CLI command, slash command, or operator-visible MCP tool wrapper named `routeYield` / `parseYield`.** The router and parser are internal to the SKILL.md inner cycle; only the SKILL.md prose calls them (via a single new composite MCP tool `routeYield`, exposed for the prose layer's `allowed_tools` list — analogous to how `processReviewerTranscript` is exposed without being operator-typed). No `/crew:yield` slash command, no `crew route-yield` CLI.
- **(j) Implement the `gh pr-comment` posting of the yield itself.** When the generalist-reviewer emits the yield phrase, the runtime spawns the specialist; the specialist runs `runReviewerSession`, derives its own verdict, and posts comments via `postReviewerComments` exactly as the generalist would have. The yield event surfaces in the chat log and telemetry; there is no separate "yield comment" posted to the PR. (The specialist's eventual PR review IS the user-visible record of the yield.)
- **(k) Add a "yield-back" path where the specialist hands back to the generalist after determining no in-domain finding.** AC2 says the specialist refuses to DEFER in-domain; it does not require yield-back when the specialist finds nothing. The specialist's verdict (`READY FOR MERGE`, `NEEDS CHANGES`, `BLOCKED`) IS the terminal output for the inner cycle. If a specialist needs to hand findings back to the generalist for a broader pass, that is a multi-reviewer composition Story (deferred; see `plugins/crew/catalogue/security-specialist.md` § "Out of mandate" which already pre-baked this intent into the persona prose). v1 inner cycle accepts one reviewer verdict per dev iteration.
- **(l) Update the `read-reviewer-result-file` / `reviewer-result.json` schema.** The specialist subagent writes a `reviewer-result.json` identical in shape to a generalist's (Story 4.6 revision 2). The yield does NOT mutate the file shape; downstream consumers (`processReviewerTranscript`, `applyReviewerLabels`, `postReviewerComments`) see exactly one `reviewer-result.json` per inner cycle — whichever reviewer (generalist or specialist) actually called `runReviewerSession` last.
- **(m) Persist a yield decision durably outside telemetry.** No `.crew/state/sessions/<ulid>/yield.json` file, no manifest field carrying `yielded_to: <role>`. The `yield.handoff` event in `.crew/telemetry/<YYYY-MM>.jsonl` is the only durable record. Manifest state remains `claimed_by`, `blocked_by`, `rework_count` (and friends from Stories 1.6 / 3.x / 4.x); no new field.
- **(n) Change permission-allowlist files (`permissions/*.yaml`).** The router runs in-process inside the SKILL.md prose layer's MCP tool calls; no new `gh` call, no new canonical-state write. The existing `routeYield` MCP tool inherits the existing allowlist surface. `permissions/generalist-reviewer.yaml`, `permissions/security-specialist.yaml`, etc. already permit the tools the spawned specialist will use (they spawn with the SAME permission contract any reviewer uses — Story 1.4 / 2.2). One additive change is needed: append `routeYield` to `/crew:start`'s `allowed_tools` in `plugins/crew/skills/start/SKILL.md:4` so the prose can call it.
- **(o) Cache the routing result.** Each yield invokes `lookupRoleByDomain` fresh; the tool re-reads `team/<role>/PERSONA.md` files on every call. Same precedent as Story 4.10 (no caching in stats helpers). The lookup is O(hired-roles) per yield, and v1 teams will have < 10 hired roles.
- **(p) Update the existing dev-handoff `parseHandoff` function or its test file.** The yield parser is a NEW function in a NEW file (`plugins/crew/mcp-server/src/skills/yield-parser.ts`); `handoff-parser.ts` is unchanged. The two parsers coexist and share no code; each is small enough that a shared "locked-phrase parsing primitive" would be premature abstraction (memory: `feedback_default_to_deterministic_seams.md` — three similar lines beats premature abstraction).
- **(q) Validate that the yield phrase's named role matches a CATALOGUE entry as opposed to a hired team entry.** Routing is over `<targetRepoRoot>/team/` only (i.e. hired roles). If a generalist yields to `chaos-engineer` but `chaos-engineer` exists in the catalogue but has not been hired, the result is `routing-failure` — exactly as if the role had been named without any catalogue entry. The user-visible surface line is the same in both cases (`[routing-failure] no hired role matches domain "<x>"`). This matches the PRD FR99 ("look up hired roles by `domain:`") — never catalogue.

### Deferred work

- **Yield-cycle / `yield-cycle` blocked_by detection.** A graph of yields per inner cycle, with a `blocked_by: yield-cycle` stamp when the same `(from_role, to_role)` pair appears twice in one inner cycle. Needs design: do we abort on cycle, or hand to operator? v1 trusts catalogue non-overlap and lets the 8-min wall-clock cap (Story 4.12 NFR2) bound runaway cycles.
- **Ambiguous-domain diagnostic.** When two hired roles share a `domain:` string (hand-edit error), surface a `routing-ambiguous` blocker with the candidate role list. Stub in `lookup-role-by-domain.ts:35-39` since Story 2.3.
- **`yield.handoff.failed` telemetry event.** A separate event type for `routing-failure` and `self-yield-rejected` outcomes, so retro analysts can count drift in catalogue domain coverage. Additive widening of the discriminated union; preserves NFR21's "closed v1 set" by being a deliberate v2 addition.
- **Yield-back path.** Specialist → generalist handoff after specialist finds no in-domain issue. Currently the specialist owns the terminal verdict; a yield-back would require a multi-verdict reconciliation (and an answer to "whose verdict wins").
- **Dev-side yield.** Specialist devs (e.g. a security-implementation specialist) could yield within the dev lane the same way reviewers do. Adds symmetric parser + router on the dev side and a `handoff-parser` companion file. Trivial extension once a hired specialist-dev exists.
- **Surface yield chain in `/crew:status`.** Operator-facing yield-chain rendering for a given in-progress story (e.g. "generalist-reviewer → security-specialist for `auth/secret-handling`"). Reads telemetry; cheap follow-up after Epic 5.

---

## Acceptance Criteria

> AC1, AC2, AC3, AC4, AC5 are verbatim from Epic 4. AC6 is the integration suite. Per `plugins/crew/docs/user-surface-acs.md`, this story is **user-surface**: AC3's `[routing-failure] no hired role matches domain "<x>"` line lands on the orchestration chat surface the operator reads during `/crew:start`. AC1's chat-surface lines for successful yield spawns also surface. AC2 (in-domain insistence) is substrate-only (no operator-visible artefact). AC4 (telemetry) is substrate. AC5 (no-yield path) is substrate. Per the rubric's strict-membership rule (iii), AC1 and AC3 trigger the `(user-surface)` tag; AC2, AC4, AC5, AC6 do not.

**AC1 (user-surface):**
**Given** a generalist reviewer encountering work inside a hired specialist's `domain:`,
**When** it emits the locked yield phrase `This sits in <role>'s domain — handing off.`,
**Then** the runtime looks up the role by exact-match domain, spawns the specialist reviewer subagent with a clean context, and routes the review. _(FR99, FR100, FR102)_

<!-- User-surface: the spawn produces the verbatim chat line `yield routed: generalist-reviewer → <role> for domain "<domain>" — spawning specialist (clean context)` on the operator's `/crew:start` chat. -->

**AC2:**
**Given** a specialist asked to defer inside its own domain,
**When** the specialist runs,
**Then** it refuses to defer even when another agent has produced a contrary verdict (in-domain insistence). _(FR101)_

<!-- Not user-surface: refusal is enforced at the routing layer; the specialist's verdict (which DOES surface via existing reviewer chat lines) is unchanged. No new chat line is emitted for the self-yield rejection. -->

**AC3 (user-surface):**
**Given** a yield whose named role has no hired match,
**When** the runtime looks up the domain,
**Then** the yield surfaces as `[routing-failure] no hired role matches domain "<x>"` on the orchestration surface; the story is blocked with `blocked_by: routing-failure`. _(FR100)_

<!-- User-surface: the verbatim `[routing-failure] no hired role matches domain "<x>"` line is operator-facing. -->

**AC4:**
**Given** any yield,
**When** routing succeeds,
**Then** a `yield.handoff` telemetry event records both roles and the triggering domain. _(FR103, NFR29)_

<!-- Not user-surface: telemetry JSONL is operator-readable only via the planned `/crew:status` and retro tooling; this story does not surface telemetry to chat. -->

**AC5:**
**Given** work where no hired specialist's domain matches,
**When** the generalist runs,
**Then** the generalist handles the work without yield. _(FR104)_

<!-- Not user-surface: this is the "happy path no-yield" case. No new chat line; the generalist's existing verdict line surfaces. -->

**AC6 (integration):**
vitest covers the five yield branches against a fixture with a hired security specialist.

### Expanded acceptance specifics (folded into AC1–AC6 above; each clause maps to an AC for the AC-table gate)

**AC1 unpacked.** Parser contract, router contract, and SKILL.md dispatch:

- **(1a) `parseYield` signature.** `parseYield(transcript: string, opts: { emittingRole: string }): YieldParseResult`, pure, no IO. Returns the discriminated union below. Pattern mirrors `parseHandoff` (`plugins/crew/mcp-server/src/skills/handoff-parser.ts:44`):
  ```ts
  export const YIELD_PHRASE_TEMPLATE = "This sits in <role>'s domain — handing off.";
  export type YieldParseResult =
    | { kind: "yield"; toRole: string }
    | { kind: "self-yield-rejected"; toRole: string }
    | { kind: "no-yield" };
  ```
  - The yield phrase MUST appear on the LAST non-empty line of the transcript (mirrors handoff-parser invariant). A correct phrase mid-transcript with a different last line returns `{ kind: "no-yield" }` — pinned by AC5's "no yield" semantics. This intentionally suppresses prose preambles before the locked phrase; reviewers must emit the locked phrase as their final line (mirrors handoff discipline).
  - The em-dash `—` (U+2014) is part of the literal. An en-dash, hyphen, or "—" with surrounding tab characters does NOT match.
  - The `<role>` token is extracted by greedy match against the regex `^This sits in (?<toRole>[a-z0-9-]+)'s domain — handing off\.$` (kebab-case role name, byte-exact rest). The toRole MUST satisfy the catalogue role regex (Story 1.4: `^[a-z0-9-]+$`); a phrase with `<role>` substituted by `Foo Bar` returns `{ kind: "no-yield" }`.
  - The "(`'s`)" apostrophe is the ASCII `'` (U+0027). A curly `'` (U+2019) does NOT match. Pinned because LLMs sometimes auto-correct apostrophes.
  - When the matched `toRole` byte-equals `opts.emittingRole`, the parser returns `{ kind: "self-yield-rejected", toRole }`. This is the in-domain-insistence guard at the parser level. (AC2.)
  - Empty / all-whitespace transcript → `{ kind: "no-yield" }`. No need for a separate `empty` reason: the SKILL.md prose treats no-yield as "specialist did not yield; verdict path proceeds normally."
- **(1b) `routeYield` MCP tool signature.** `routeYield(opts: { targetRepoRoot: string; sessionUlid: string; ref: string; manifestPath: string; transcript: string; emittingRole: string }): Promise<RouteYieldResult>`. Composite tool that:
  1. Calls `parseYield(transcript, { emittingRole })`.
  2. On `{ kind: "no-yield" }`: returns `{ next: "no-yield", chatLog: [] }`. No telemetry. No spawn. No manifest mutation. SKILL.md continues to its existing reviewer verdict path.
  3. On `{ kind: "self-yield-rejected", toRole }`: returns `{ next: "self-yield-rejected", chatLog: [] }`. No telemetry. No spawn. SKILL.md continues to its existing verdict path AS IF the yield was not emitted — the specialist's actual verdict (from `reviewer-result.json`) becomes the inner-cycle terminal. (AC2.)
  4. On `{ kind: "yield", toRole }`: calls `lookupRoleByDomain({ targetRepoRoot, domain: <inferred from toRole's persona> })` — see (1c). Two sub-branches:
     - **Match found.** Calls `buildPersonaSpawnPrompt({ targetRepoRoot, role: toRole })` and returns `{ next: "spawn-specialist", chatLog: ["yield routed: <emittingRole> → <toRole> for domain \"<domain>\" — spawning specialist (clean context)"], specialistRole: toRole, specialistPrompt: <prompt>, triggeringDomain: <domain> }`. Telemetry `yield.handoff` event written by `routeYield` BEFORE returning, carrying `from_role: emittingRole`, `to_role: toRole`, `triggering_domain: <domain>`. (AC1, AC4.)
     - **No match.** Calls `writeManagedFile` to stamp `blocked_by: "routing-failure"` on the in-progress manifest (in-place rewrite, no manifest move — same pattern as Story 4.3 grammar-drift handling). Returns `{ next: "routing-failure", chatLog: ["[routing-failure] no hired role matches domain \"<domain>\""] }`. NO telemetry event (deferred-work item: failed-yield telemetry is v2). (AC3.)
- **(1c) Role-name → domain resolution inside `routeYield`.** The yield phrase names a ROLE; FR99 looks up by DOMAIN. The router resolves the role → domain via `readPersona({ targetRepoRoot, role: toRole })` and reads the persona's `domain` field. This gives the `triggeringDomain` string the lookup uses. Two edge cases:
  - The named role is in the catalogue but NOT in `<targetRepoRoot>/team/` (not hired): `readPersona` throws `PersonaFileNotFoundError`. `routeYield` catches it, treats as "no hired role matches" (routing-failure branch), and stamps `blocked_by: "routing-failure"`. The chat line is `[routing-failure] no hired role matches domain "<role>"` where `<role>` is the named role name (since we cannot resolve a domain when the persona file is absent). This is a small fidelity loss (the surface says "domain" but quotes the role name) — the operator has the information they need to diagnose ("you mentioned X, X isn't hired"). Pinned in TSDoc.
  - The named role's persona IS hired and its `domain` field is read successfully — but `lookupRoleByDomain` returns `{ role: null }` (the domain was hand-edited away from the catalogue default). Same `routing-failure` outcome; the chat line quotes the resolved domain string for diagnostic clarity.
- **(1d) `buildPersonaSpawnPrompt` re-use.** The router calls the existing `buildPersonaSpawnPrompt` tool (`plugins/crew/mcp-server/src/tools/build-persona-spawn-prompt.ts`) verbatim. The composed prompt INCLUDES the specialist's `locked_phrases.yield` (line 117 of the assembler already lifts it). This means the spawned specialist CAN itself yield further — and the SKILL.md inner cycle handles that recursively (see (1e)).
- **(1e) SKILL.md inner-cycle dispatch (revised reviewer step in `plugins/crew/skills/start/SKILL.md`).** New step 9b inserted after step 9 (existing `runReviewerSession` ran and persisted `reviewer-result.json`), BEFORE step 9a (`postReviewerComments`). Step 9b:
  1. Reads the reviewer subagent's final transcript (the `Task` tool's returned text — distinct from the persisted `reviewer-result.json`).
  2. Calls `routeYield({ targetRepoRoot, sessionUlid, ref, manifestPath, transcript, emittingRole: <currentReviewerRole> })`. (`<currentReviewerRole>` starts as `generalist-reviewer` and is updated to the spawned specialist's role on subsequent iterations.)
  3. Switches on `next`:
     - `no-yield` or `self-yield-rejected` → fall through to existing step 9a (`postReviewerComments`). The specialist's verdict is the inner-cycle terminal.
     - `spawn-specialist` → surface every `chatLog` line, invoke the `Task` tool with `specialistPrompt` and the standard `initial_context` block (carrying `ref`, `title`, `sessionUlid`, `targetRepoRoot`, `prNumber`), capture the specialist's transcript on return, **delete `reviewer-result.json`** (so the specialist's `runReviewerSession` writes a fresh one), update `<currentReviewerRole> = specialistRole`, **loop back to step 9b** to re-evaluate yield from the specialist's transcript. The recursion terminates when either (a) the specialist returns `no-yield` / `self-yield-rejected`, (b) `routing-failure` fires (no further hop possible), or (c) the 8-min reviewer wall-clock (Story 4.12 NFR2) fires.
     - `routing-failure` → surface the `chatLog` line. The manifest is already stamped `blocked_by: routing-failure` by `routeYield`. Skip `postReviewerComments` and `processReviewerTranscript`; surface `[routing-failure]` as the inner-cycle terminal and return to the outer loop.
- **(1f) `routeYield` MUST be registered in `plugins/crew/mcp-server/src/tools/register.ts` as an MCP tool**, and **MUST be added to `/crew:start`'s `allowed_tools` array** in `plugins/crew/skills/start/SKILL.md:4`. No allowlist file (`permissions/*.yaml`) change needed — the tool is invoked by the SKILL.md prose layer, not by spawned subagents.

**AC2 unpacked.** In-domain insistence:

- **(2a) Enforced in the parser, not the persona prose.** When `parseYield`'s extracted `toRole` byte-equals `opts.emittingRole`, the parser short-circuits with `{ kind: "self-yield-rejected", toRole }`. This is the deterministic seam. The specialist's persona prompt (which already says "do not yield in-domain" in the `## Mandate` section of `security-specialist.md:24-28`) is the suggestive layer; the parser is the load-bearing one.
- **(2b) The specialist's verdict survives the self-yield.** When `routeYield` returns `{ next: "self-yield-rejected" }`, the SKILL.md prose falls through to `postReviewerComments` and `processReviewerTranscript` using the `reviewer-result.json` the specialist already persisted. The specialist's actual verdict (`READY FOR MERGE` / `NEEDS CHANGES` / `BLOCKED`) becomes the inner-cycle terminal — i.e. "even if the specialist tried to defer back to the generalist, their `runReviewerSession` verdict counts." (FR101 satisfied.)
- **(2c) Edge case: specialist yields to a DIFFERENT specialist whose domain is also in-scope for the original specialist.** Out of scope for AC2: AC2 specifically covers self-yield. A specialist yielding to a DIFFERENT specialist is a normal `kind: "yield"` and follows the AC1 routing path (with potential cycle risk per Deferred Work item).
- **(2d) No telemetry event is written for `self-yield-rejected`.** AC4 says "when routing succeeds." A rejected self-yield is not a successful routing. The fall-through path through `postReviewerComments` and `processReviewerTranscript` will trigger normal `reviewer.verdict` telemetry (Story 4.12) as usual.

**AC3 unpacked.** Routing-failure surface and block:

- **(3a) Chat-surface line is byte-exact `[routing-failure] no hired role matches domain "<x>"`** where `<x>` is the resolved domain string (when readable) or the role name (when persona is absent). The square brackets are literal. The double quotes are ASCII `"` (U+0022). No trailing punctuation. The line is emitted in `chatLog` by `routeYield` so the SKILL.md prose can surface it verbatim — operator-visible, scannable, copy-pasteable into a grep for retros.
- **(3b) Manifest `blocked_by: "routing-failure"`** is stamped in-place via `writeManagedFile` (same primitive Story 4.3 grammar-drift uses). No manifest move to a `blocked/` directory — Story 5.1's atomic move to `blocked/` is the planned retrofit; v1 keeps the file in `in-progress/` with the `blocked_by` stamp. The stamp uses the literal string `"routing-failure"` so retro analysts can grep for it the same way they grep for `"handoff-grammar"` and `"reviewer-verdict-needs-changes"`.
- **(3c) Skip `postReviewerComments` and `processReviewerTranscript` on the routing-failure branch.** The SKILL.md prose (step 9b on `routing-failure`) returns to the outer `claimNextStory` loop immediately after surfacing the chat line. The reviewer's `reviewer-result.json` (if one exists from a prior reviewer in the inner cycle) is left in place — it represents the generalist's prior pass; a future re-run can use or discard it. The `routing-failure` blocker says "operator must intervene to hire the missing role"; the `reviewer-result.json` is not consulted for the verdict path.

**AC4 unpacked.** Telemetry event schema and write path:

- **(4a) `YieldHandoffEventSchema` joins `TelemetryEventSchema`'s discriminated union** in `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`. Shape (additive, strict, payload-fields-only — no string payloads per NFR14):
  ```ts
  export const YieldHandoffEventSchema = TelemetryEventBase.extend({
    type: z.literal("yield.handoff"),
    data: z
      .object({
        from_role: z.string().min(1).regex(/^[a-z0-9-]+$/),
        to_role: z.string().min(1).regex(/^[a-z0-9-]+$/),
        triggering_domain: z.string().min(1),
      })
      .strict(),
  }).strict();
  ```
  The union becomes:
  ```ts
  export const TelemetryEventSchema = z.discriminatedUnion("type", [
    AgentInvokeEventSchema,
    TelemetryInvalidEventSchema,
    YieldHandoffEventSchema,
  ]);
  ```
- **(4b) Single write path: `routeYield`** calls `logTelemetryEvent({ targetRepoRoot, event: { type: "yield.handoff", session_id, agent: emittingRole, story_id: ref, data: { from_role, to_role, triggering_domain } } })` on the spawn-specialist branch ONLY (not on routing-failure, not on self-yield-rejected, not on no-yield). The write happens BEFORE the `Task` spawn returns — so a crash mid-spawn still leaves a forensic record that the yield was decided.
- **(4c) `agent: <emittingRole>` semantics.** The `agent` field on the base event records "the agent that emitted the action being telemetered." For `yield.handoff` that is the YIELDING role (the generalist-reviewer in the canonical case). The `data.from_role` field is redundantly the same value — kept for explicit join semantics in retro queries (so a query for "all yields originating from generalist-reviewer" can use `data.from_role` without depending on the `agent` semantic mapping).
- **(4d) No backfill on routing failure.** If `lookupRoleByDomain` succeeds in finding a role but the subsequent `Task` spawn fails (e.g. `Task` tool error), the `yield.handoff` event is already written. There is no compensating `yield.spawn-failed` event in v1. Retro analysts comparing yield events against subsequent reviewer.verdict events will see the mismatch and can investigate.
- **(4e) Existing `readTeamTelemetryStats` (Story 2.6) continues to work.** That function filters on `type === "agent.invoke"`; `yield.handoff` is ignored (not counted as malformed) — same way `team-stats.ts` ignores `telemetry.invalid` events today. Verified by adding a `yield.handoff` event to one of the existing `team-stats.test.ts` fixtures and asserting the function's output is unchanged.

**AC5 unpacked.** No-yield happy path:

- **(5a) `parseYield` returns `{ kind: "no-yield" }`** for: empty transcript, transcript whose last non-empty line is anything other than the locked phrase, transcript containing the phrase mid-text but with a different last line. `routeYield` returns `{ next: "no-yield" }`. SKILL.md falls through to `postReviewerComments` and `processReviewerTranscript` as if step 9b had been a no-op. No telemetry event. No manifest mutation.
- **(5b) The integration suite asserts that the GENERALIST'S verdict survives** in the no-yield path. The fixture spawns a generalist-reviewer with a transcript whose last line is `**Verdict: READY FOR MERGE**`; the AC4 sequence runs, no yield is parsed, the generalist's verdict drives the manifest to `done/`.

**AC6 unpacked.** Integration suite — `plugins/crew/mcp-server/src/tools/__tests__/yield-protocol.integration.test.ts`:

The suite seeds a fixture target repo with:
- `team/generalist-reviewer/PERSONA.md` (existing template, hired).
- `team/security-specialist/PERSONA.md` (existing template, hired, `domain: "authentication authorization and secret handling"`).
- A claimed `in-progress/<ref>.yaml` manifest with `claimed_by: <test-ulid>`.
- A pre-written `reviewer-result.json` from the generalist reviewer (for the spawn-specialist branch, the specialist will overwrite this).
- A `.crew/telemetry/` directory (created on first event).

The five branches asserted:
1. **Spawn-specialist branch (AC1, AC4):** Transcript whose last line is `This sits in security-specialist's domain — handing off.`. Assert: `routeYield` returns `next: "spawn-specialist"`, `specialistRole: "security-specialist"`, `triggeringDomain: "authentication authorization and secret handling"`. Assert: one `yield.handoff` line appended to `<YYYY-MM>.jsonl` with the expected payload. Assert: chatLog contains the verbatim spawn line. Assert: manifest is unchanged (no `blocked_by` stamp).
2. **Routing-failure branch (AC3):** Transcript whose last line names a role not hired (`This sits in performance-specialist's domain — handing off.`). Assert: `routeYield` returns `next: "routing-failure"`, chatLog `[routing-failure] no hired role matches domain "performance-specialist"`. Assert: manifest is stamped `blocked_by: "routing-failure"`. Assert: NO telemetry event written.
3. **Self-yield-rejected branch (AC2):** Transcript whose last line is `This sits in security-specialist's domain — handing off.` AND `emittingRole: "security-specialist"`. Assert: `routeYield` returns `next: "self-yield-rejected"`. Assert: NO spawn, NO telemetry, NO manifest mutation.
4. **No-yield branch (AC5):** Transcript whose last line is `**Verdict: READY FOR MERGE**` (a normal verdict; no yield phrase). Assert: `routeYield` returns `next: "no-yield"`. Assert: NO spawn, NO telemetry, NO manifest mutation.
5. **Mid-transcript drift (AC1 invariant from (1a)):** Transcript containing `This sits in security-specialist's domain — handing off.` on a non-last line, with `**Verdict: READY FOR MERGE**` on the last line. Assert: `routeYield` returns `next: "no-yield"` (last-line semantics).

Plus three unit-test files for the parser:
- `plugins/crew/mcp-server/src/skills/__tests__/yield-parser.test.ts` — covers em-dash drift, apostrophe drift, kebab-case enforcement, self-yield rejection, last-line semantics, empty transcript, paraphrase drift. ≥ 12 test cases.
- `plugins/crew/mcp-server/src/tools/__tests__/route-yield.test.ts` — unit-level tests for `routeYield` with mocked `lookupRoleByDomain` and `readPersona`. Covers `readPersona` throwing `PersonaFileNotFoundError`, telemetry write happens before spawn signal, manifest stamp happens before chat line.
- `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events.test.ts` — additive test asserting `YieldHandoffEventSchema` accepts the canonical payload, rejects unknown keys (`.strict()`), rejects malformed role names (regex). Mirrors existing schema-test pattern.

---

## Tasks / Subtasks

> **Load-bearing order** — schema first (so other tasks compile against the new union), parser second (no deps), router third (depends on parser + schema), SKILL.md wiring fourth, integration test last. Catalogue period-fix can happen anytime but is co-located with parser implementation (Subtask 1.4) for review-pack coherence.

### Task 1: Yield-phrase parser (`yield-parser.ts`)

- [ ] **1.1** Create `plugins/crew/mcp-server/src/skills/yield-parser.ts` mirroring `handoff-parser.ts`'s structure (TSDoc header citing the behavioural-contract source at `_bmad-output/implementation-artifacts/4-11-...md § AC1 unpacked`). Export `YIELD_PHRASE_TEMPLATE` and `YieldParseResult` type per (1a).
- [ ] **1.2** Implement `parseYield(transcript, { emittingRole })` per (1a) invariants. Pure function, no IO. Use the regex `/^This sits in (?<toRole>[a-z0-9-]+)'s domain — handing off\.$/` against the last non-empty line (trimEnd per-line, mirrors handoff-parser).
- [ ] **1.3** Add the self-yield short-circuit: when extracted `toRole` byte-equals `emittingRole`, return `{ kind: "self-yield-rejected", toRole }`. Pin behaviour in TSDoc with a one-line "AC2 (in-domain insistence) enforcement seam" annotation.
- [ ] **1.4** Patch the four shipped catalogue personas (`security-specialist.md`, `test-specialist.md`, `docs-specialist.md`, `debugger.md`) to add the trailing period to `locked_phrases.yield`. The new value: `yield: "This sits in <role>'s domain — handing off."`. No other persona changes.
- [ ] **1.5** Add unit-test file `plugins/crew/mcp-server/src/skills/__tests__/yield-parser.test.ts` per AC6 unpacked § parser unit tests. Use Vitest's `describe.each` for the drift table. Assert kebab-case enforcement (uppercase, spaces, dots all rejected), em-dash enforcement, apostrophe enforcement, last-line semantics, self-yield rejection, empty / whitespace-only transcript.

### Task 2: Telemetry schema widening (`telemetry-events.ts`)

- [ ] **2.1** Append `YieldHandoffEventSchema` definition per (4a) to `plugins/crew/mcp-server/src/schemas/telemetry-events.ts`. Update the discriminated-union expression to include it. TSDoc on the new schema points to this story spec's AC4 § (4a).
- [ ] **2.2** Add schema unit-test cases in `plugins/crew/mcp-server/src/schemas/__tests__/telemetry-events.test.ts`: accepts the canonical payload, rejects unknown keys, rejects bad role-name regex, rejects empty `triggering_domain`. ≥ 4 cases for this schema.
- [ ] **2.3** Add one fixture event to `plugins/crew/mcp-server/src/lib/__tests__/team-stats.test.ts` asserting `readTeamTelemetryStats` is unchanged by the presence of a `yield.handoff` event in the JSONL (per (4e)).

### Task 3: `routeYield` MCP tool

- [ ] **3.1** Create `plugins/crew/mcp-server/src/tools/route-yield.ts`. Function signature per (1b). TSDoc header points to this spec's AC1 unpacked § (1b)–(1f) and AC4 § (4b)–(4d).
- [ ] **3.2** Implement the four branches of (1b) in order: `no-yield` (early return), `self-yield-rejected` (early return), `yield` → `readPersona` → `lookupRoleByDomain` (the spawn-specialist sub-branch and routing-failure sub-branch).
- [ ] **3.3** On the spawn-specialist sub-branch: call `logTelemetryEvent` BEFORE returning. On the routing-failure sub-branch: call `writeManagedFile` to stamp `blocked_by: "routing-failure"` on the in-progress manifest BEFORE returning the chat line. Manifest stamp uses the same YAML-frontmatter primitive Story 4.3 uses for `handoff-grammar` (verify by grep of `process-dev-transcript.ts` for the existing stamp pattern; reuse the same helper).
- [ ] **3.4** Register `routeYield` in `plugins/crew/mcp-server/src/tools/register.ts` (input schema with the six fields from (1b), output schema for the four `next` values). Mirror the registration style of `processReviewerTranscript` (composite tool that returns a discriminated `next` with a `chatLog` array).
- [ ] **3.5** Add unit-test file `plugins/crew/mcp-server/src/tools/__tests__/route-yield.test.ts`. Use Vitest mocks for `lookupRoleByDomain`, `readPersona`, `buildPersonaSpawnPrompt`, `logTelemetryEvent`, `writeManagedFile`. Assert: telemetry write happens before `next: "spawn-specialist"` return; manifest stamp happens before `next: "routing-failure"` return; `PersonaFileNotFoundError` from `readPersona` is mapped to the routing-failure branch (per (1c)); the chat-line quotes the role name (not a domain) in that edge case.
- [ ] **3.6** Update `plugins/crew/mcp-server/dist/` by running the build (memory: `project_smoke_test_install.md`-adjacent — dist is committed). `pnpm --filter @crew/mcp-server build` from repo root.

### Task 4: SKILL.md inner-cycle wiring (`plugins/crew/skills/start/SKILL.md`)

- [ ] **4.1** Append `routeYield` to the `allowed_tools` array on line 4.
- [ ] **4.2** Insert new step 9b between existing step 9 and step 9a per (1e). The new step:
  ```
  9b. invoke routeYield({ targetRepoRoot, sessionUlid, ref, manifestPath, transcript: <reviewer Task return text>, emittingRole: <currentReviewerRole> }). Switch on the `next` field:
     - `no-yield` or `self-yield-rejected` → proceed to step 9a (postReviewerComments) using the persisted reviewer-result.json.
     - `spawn-specialist` → surface every chatLog entry; delete `<targetRepoRoot>/.crew/state/sessions/<sessionUlid>/reviewer-result.json` so the specialist's runReviewerSession writes fresh; invoke the Task tool with `specialistPrompt` and the standard initial_context block (`ref`, `title`, `sessionUlid`, `targetRepoRoot`, `prNumber`); update `<currentReviewerRole>` = `specialistRole`; loop back to step 9b with the specialist's transcript.
     - `routing-failure` → surface every chatLog entry. The manifest is already stamped `blocked_by: routing-failure` by routeYield. Skip steps 9a, 10, 10a. Return to outer loop step 4.
  ```
  Initialise `<currentReviewerRole>` = `generalist-reviewer` before the first reviewer spawn (step 8 area).
- [ ] **4.3** Update the "# Failure modes" section to add a new entry for `blocked_by: routing-failure` describing the recovery flow (operator hires the missing role then re-runs `/crew:start`; manifest `blocked_by` clears on next claim). Mirror the entry style of the existing `handoff-grammar` entry on line 135.
- [ ] **4.4** Add a behavioural-contract source comment at the top of SKILL.md (mirroring the existing comments on lines 7–9) pointing to this spec's AC1 unpacked § (1e).

### Task 5: Integration suite

- [ ] **5.1** Create `plugins/crew/mcp-server/src/tools/__tests__/yield-protocol.integration.test.ts` per AC6 unpacked § integration suite. Fixture setup helper lives in the same file (mirrors `inner-cycle.integration.test.ts` precedent). Use `mkdtemp` + `cp -R` of a minimal seed `team/` directory (held under `plugins/crew/mcp-server/src/tools/__tests__/__fixtures__/yield-protocol/`).
- [ ] **5.2** Assert all five branches per AC6 § (1)–(5). The spawn-specialist branch asserts the telemetry-line shape by re-parsing the appended JSONL via `TelemetryEventSchema.parse` (no string-match brittleness on event order).
- [ ] **5.3** Add the `mid-transcript drift` case (branch 5) explicitly with a transcript that places the yield phrase on a non-last line — guards against the locked-phrase drift the memory cites (`project_locked_phrase_grammar_drift.md`).

### Task 6: Build + smoke

- [ ] **6.1** `pnpm install` (refresh lockfile if needed).
- [ ] **6.2** `pnpm --filter @crew/mcp-server build` to refresh `dist/` (per CLAUDE.md: dist is committed alongside src changes).
- [ ] **6.3** `pnpm --filter @crew/mcp-server test` — all suites green (existing + new parser, schema, route-yield, integration).
- [ ] **6.4** `pnpm --filter @crew/mcp-server lint` and `pnpm --filter @crew/mcp-server typecheck` — both clean.
- [ ] **6.5** Manual smoke: in a scratch fresh-install repo with the bundled example, simulate the spawn-specialist branch by hand-editing a generalist-reviewer transcript and running `routeYield` via the MCP tool surface. Verify a `yield.handoff` line lands in `<repo>/.crew/telemetry/<YYYY-MM>.jsonl` with the expected payload. (Operator-driven; not an automated smoke.) — Optional if Task 5 integration suite covers the same ground; record outcome in PR description.

---

## Implementation strategy

### Why the parser is a NEW file, not a refactor of `handoff-parser.ts`

The shared substrate would be ~15 lines (split + trimEnd + find-last-non-empty). Two parsers each at ~50 lines with one shared helper would obscure the per-parser invariants (last-line semantics, em-dash, apostrophe, regex, role-name extraction) under a helper indirection. The parsers' behavioural contracts are independent — Story 4.8b's verdict parser hardened similarly and chose to stay separate from the handoff parser. This story follows that precedent: two small parser files, each self-contained, each with a one-page TSDoc that ties its invariants to the spec.

### Why `routeYield` is one composite tool, not three (parse + lookup + telemetry)

The four `next` outcomes form one logical decision tree. Splitting them across MCP tools would force the SKILL.md prose to thread state across three calls and reproduce the decision tree in prose — exactly the failure mode `feedback_prose_mut_steps_need_seam.md` warns against. One composite tool with a discriminated-union `next` field keeps the load-bearing logic in TypeScript and the prose layer's role to "switch and surface."

### Why telemetry writes from `routeYield`, not from the SKILL.md prose

The `logTelemetryEvent` call is a side effect with ordering constraints (must happen before the spawn signal returns, must NOT happen on routing-failure / self-yield / no-yield branches). Pinning it to the deterministic seam (the tool's spawn-specialist branch) gives a single ground truth for "when does a yield.handoff get written?" The SKILL.md prose has zero way to skip or duplicate the event by accident.

### Why the routing-failure branch stamps `blocked_by` in the tool, not via a follow-up MCP call

Same rationale: the manifest stamp is a load-bearing side effect with a strict ordering relationship to the chat-line emission (stamp first so an operator who reads the chat line and immediately inspects the manifest sees the stamp; never the other way around). The composite tool owns both side effects.

### Why the SKILL.md inner cycle loops on yield (rather than capping at one specialist spawn)

The locked-phrase contract says ANY reviewer can yield, including spawned specialists yielding further (e.g. `security-specialist` yields to a future `compliance-specialist`). v1 catalogue does not have nested specialists, so the recursion will terminate after one hop in practice. But pinning the recursion in the SKILL.md prose (and capping it implicitly with the 8-min reviewer wall-clock per NFR2) keeps the architecture honest for v2 specialists. A hard hop-cap is deferred work.

### Why the test fixture uses `security-specialist` (not a synthetic test role)

Epic 4 AC6 names "a hired security specialist" explicitly. `security-specialist.md` is the canonical specialist persona in the bundled catalogue. Using it as the integration-test target exercises the same persona file the operator gets from `/crew:hire` — no synthetic test-only persona that drifts from production shape.

---

## Locked files (exceptions to the locked-file rule)

This story modifies the following files outside the dev agent's usual write surface; each modification is justified by the AC mapping:

| File | Reason |
|------|--------|
| `plugins/crew/catalogue/security-specialist.md`, `test-specialist.md`, `docs-specialist.md`, `debugger.md` | Subtask 1.4 — add trailing period to `locked_phrases.yield`. Catalogue files are usually only edited via persona-design work; here a one-character fix syncs the catalogue with the parser invariant. |
| `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` | Subtask 2.1 — additive schema widening per AC4 § (4a). The existing schemas are unchanged. |
| `plugins/crew/skills/start/SKILL.md` | Subtask 4.1–4.4 — wires the new `routeYield` MCP tool into the inner cycle. The behavioural-contract comment at the top is updated accordingly. |
| `plugins/crew/mcp-server/dist/**` | Subtask 6.2 — `dist/` is committed per CLAUDE.md (Build artefacts rule). Rebuild + commit alongside `src/` changes. |

All other files created by this story are new (`yield-parser.ts`, `route-yield.ts`, three test files, one fixture directory).

---

## Developer context

### Files to read before starting

- `plugins/crew/mcp-server/src/skills/handoff-parser.ts` — your parser will mirror its structure.
- `plugins/crew/mcp-server/src/tools/lookup-role-by-domain.ts` — your router consumes this verbatim; do not re-implement.
- `plugins/crew/mcp-server/src/tools/build-persona-spawn-prompt.ts` — your router consumes this verbatim; the `Yield` locked phrase is already lifted into spawn prompts.
- `plugins/crew/mcp-server/src/schemas/telemetry-events.ts` — your schema widening joins this discriminated union.
- `plugins/crew/mcp-server/src/lib/logger.ts` — `logTelemetryEvent` entrypoint (line 92); your router calls this.
- `plugins/crew/skills/start/SKILL.md` — inner cycle prose layer; you insert step 9b here.
- `plugins/crew/mcp-server/src/tools/process-dev-transcript.ts` — reference for how `blocked_by` is stamped on the in-progress manifest (find the `handoff-grammar` stamp; reuse the helper).
- `plugins/crew/mcp-server/src/tools/process-reviewer-transcript.ts` — reference for the chat-log + `next` discriminated-union return shape.
- `plugins/crew/catalogue/security-specialist.md` — your integration-test fixture target.
- `_bmad-output/implementation-artifacts/4-8b-deterministic-seam-hardening-handoff-parser-and-pr-url-extraction.md` — adjacent shipped spec; mirrors the deterministic-seam pattern this story extends.
- `_bmad-output/implementation-artifacts/4-6-reviewer-subagent-read-sources-and-run-acs.md` — reviewer subagent spawn contract.
- `_bmad-output/implementation-artifacts/4-3-dev-reviewer-handoff-reviewer-spawn-and-rework-signal.md` — handoff parser invariants; mirror them.

### Files to read because the story changes adjacent behaviour

- `plugins/crew/mcp-server/src/lib/persona-file.ts` — your router calls `readPersona` which loads via this; understand the `PersonaFileNotFoundError` vs `PersonaFileMalformedError` distinction.
- `plugins/crew/mcp-server/src/tools/register.ts` (line 143 — existing `lookupRoleByDomain` registration) — your `routeYield` registration sits adjacent.
- `plugins/crew/mcp-server/src/tools/__tests__/inner-cycle.integration.test.ts` — pattern for your integration suite's fixture setup.
- `plugins/crew/mcp-server/src/lib/team-stats.test.ts` (Task 2.3) — additive `yield.handoff` event assertion.

### Files explicitly NOT to read or modify (out of scope)

- `plugins/crew/mcp-server/src/tools/run-reviewer-session.ts` — your story does NOT change reviewer-result.json shape, AC extraction, applicability classification, or any verdict-derivation logic.
- `plugins/crew/mcp-server/src/tools/post-reviewer-comments.ts` — unchanged.
- `plugins/crew/mcp-server/src/tools/apply-reviewer-labels.ts` — unchanged.
- `plugins/crew/mcp-server/src/tools/complete-story.ts` — unchanged.
- `plugins/crew/mcp-server/src/tools/claim-next-story.ts` / `claim-story.ts` — unchanged.
- Any persona file's `## Mandate` / `## Out of mandate` / `## Prompt` section — Subtask 1.4 only edits the frontmatter `locked_phrases.yield` field.
- `permissions/*.yaml` — no permission allowlist changes (per §What this story does NOT § (n)).

---

## Technical requirements

- TypeScript strict mode (existing repo config).
- Vitest for all new tests; mirror the existing test-file co-location convention (`__tests__/` siblings of source files).
- `pnpm` for install/build/test/lint/typecheck.
- Node ≥ 22 (existing repo target).
- All new source files include a TSDoc header pointing to this spec by relative path (`_bmad-output/implementation-artifacts/4-11-...md § <AC>`). Mirrors the convention in `handoff-parser.ts:1-25`, `lookup-role-by-domain.ts:15-39`, `run-reviewer-session.ts:1-30`.
- `dist/` rebuilt and committed in the same change as `src/` per CLAUDE.md § "Plugin build output is tracked in git."

## Architecture compliance

- **Exact-match domain routing** pinned in `core-architectural-decisions.md:18` — preserved (no fuzzy matching, no case-folding, no trimming).
- **Closed v1 telemetry event set** pinned in `schemas/telemetry-events.ts:7-13` and Implementation-patterns §5 — adding `yield.handoff` is a deliberate, additive widening with `.strict()` payload and no `data: z.record(...)` escape hatch.
- **Deterministic seams over LLM prose for load-bearing decisions** — memory `feedback_default_to_deterministic_seams.md` validated by Story 4.6 rev-2. This story extends the pattern to yield routing: parser + router are tool-layer; SKILL.md prose only dispatches.
- **Last-line locked-phrase semantics** pinned by Story 4.3 / 4.8b — extended to the yield phrase.
- **No `data:` string payloads on telemetry events** (NFR14) — `yield.handoff` carries only role names and the triggering domain string (which is the persona-declared `domain:` field, not free-text reviewer content).
- **`blocked_by` stamped in-place on in-progress/ manifest** — matches Story 4.3 `handoff-grammar` precedent; Story 5.1 will retrofit the atomic move to `blocked/` for both stamps in one pass.

## Library / framework requirements

- `zod` — existing dependency; used for the schema widening.
- No new runtime dependencies. No new dev dependencies (vitest, tsx already present).

## File structure requirements

```
plugins/crew/mcp-server/src/
├── skills/
│   ├── handoff-parser.ts          (unchanged)
│   ├── verdict-parser.ts          (unchanged)
│   ├── yield-parser.ts            (NEW — Task 1)
│   └── __tests__/
│       └── yield-parser.test.ts   (NEW — Task 1.5)
├── schemas/
│   ├── telemetry-events.ts        (MODIFY — Task 2.1, additive)
│   └── __tests__/
│       └── telemetry-events.test.ts (MODIFY — Task 2.2, additive)
├── tools/
│   ├── lookup-role-by-domain.ts   (unchanged)
│   ├── build-persona-spawn-prompt.ts (unchanged)
│   ├── route-yield.ts             (NEW — Task 3.1)
│   ├── register.ts                (MODIFY — Task 3.4, additive)
│   └── __tests__/
│       ├── route-yield.test.ts    (NEW — Task 3.5)
│       └── yield-protocol.integration.test.ts (NEW — Task 5)
│       └── __fixtures__/yield-protocol/ (NEW — Task 5.1)
└── lib/
    └── __tests__/
        └── team-stats.test.ts     (MODIFY — Task 2.3, additive)

plugins/crew/skills/start/SKILL.md (MODIFY — Task 4)
plugins/crew/catalogue/
├── security-specialist.md         (MODIFY — Task 1.4, one-char period add)
├── test-specialist.md             (MODIFY — Task 1.4, one-char period add)
├── docs-specialist.md             (MODIFY — Task 1.4, one-char period add)
└── debugger.md                    (MODIFY — Task 1.4, one-char period add)

plugins/crew/mcp-server/dist/      (REBUILT — Task 6.2)
```

## Testing requirements

- **Unit:** `yield-parser.test.ts` — ≥ 12 cases covering every invariant in (1a).
- **Unit:** `route-yield.test.ts` — ≥ 8 cases covering the four `next` branches, the `PersonaFileNotFoundError` mapping, telemetry-before-return ordering, manifest-stamp-before-return ordering.
- **Unit:** `telemetry-events.test.ts` additions — ≥ 4 cases for `YieldHandoffEventSchema`.
- **Unit additive:** `team-stats.test.ts` — 1 case asserting `readTeamTelemetryStats` ignores `yield.handoff`.
- **Integration:** `yield-protocol.integration.test.ts` — 5 cases per AC6.
- All suites green via `pnpm --filter @crew/mcp-server test`.
- Lint clean via `pnpm --filter @crew/mcp-server lint`.
- Typecheck clean via `pnpm --filter @crew/mcp-server typecheck`.

---

## Previous-story intelligence (Story 4.10)

Story 4.10 shipped the `computeAgreement` helper and added the `reviewer.verdict` schema as a precedent for additive telemetry-union widening. Patterns to lift:

- **TSDoc header** points to the spec verbatim (`team-stats.ts` style).
- **Schema widening is additive and strict** — preserves NFR21's closed v1 set semantics.
- **The first reader/writer of a new event type co-locates the schema** — this story is the first writer of `yield.handoff`; schema lives with it.
- **Vitest fixtures use `mkdtemp` + per-test seed** — pattern reused in the integration suite.
- **Composite MCP tool returns `{ next, chatLog, ...payload }`** — pattern reused by `routeYield`.

Story 4.10 also reinforced that **`null` / discriminated-union returns beat optional flags** — `routeYield`'s `next: "no-yield" | "self-yield-rejected" | "spawn-specialist" | "routing-failure"` is the discriminated union; SKILL.md switches exhaustively.

## Git intelligence summary

Recent commits relevant to this story:

- `7e91670 spec(4-9b): author spec for risk-tier classifier, evidence stamping, and fallback` — same spec template style.
- `0b07f7d spec(4-10): author spec for agreement-metric helper + sprint-status tidy` — sibling story; same telemetry-union widening pattern.
- Stories 4.6, 4.6b, 4.7, 4.8 — established the reviewer-subagent spawn loop your inner-cycle change extends.
- Stories 4.8b, 4.3c — established the deterministic-seam-over-prose pattern your parser + router extend.

## Latest tech information

No external library research required. All seams are internal to the plugin (`zod` discriminated union, Vitest mocking, `Task` tool invocation per existing SKILL.md patterns). Node 22, TypeScript strict, pnpm workspaces — all unchanged from Story 4.10's shipping config.

---

## Project context reference

- **PRD (sharded):** `_bmad-output/planning-artifacts/prd-crew-v1/index.md`
  - **FR98–FR104:** `_bmad-output/planning-artifacts/prd-crew-v1/functional-requirements.md:144-153`
  - **NFR29:** `_bmad-output/planning-artifacts/prd-crew-v1/non-functional-requirements.md:47`
- **Epic 4:** `_bmad-output/planning-artifacts/epics/epic-4-dev-review-loop-the-engineering-heart.md:316-340`
- **Architecture pinning:** `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md:17-19, 78-82`
- **Memory:**
  - `project_locked_phrase_grammar_drift.md` — predicts the yield-phrase drift this story's parser closes.
  - `feedback_default_to_deterministic_seams.md` — the architectural principle this story extends.
  - `project_reviewer_rubber_stamps.md` — the failure mode the yield protocol structurally avoids.

---

## Story completion status

Ready for dev. All grounding artefacts identified, all seams pinned, all out-of-scope items enumerated. The dev agent has everything needed for a single-PR implementation that lands the yield protocol end-to-end with deterministic seams, additive telemetry widening, and integration coverage of every branch the operator can hit.

Ultimate context engine analysis completed - comprehensive developer guide created.
