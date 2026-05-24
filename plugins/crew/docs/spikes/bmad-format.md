# BMad story format — adapter spike

Maintainer-facing reference for the BMad planning adapter
(`plugins/crew/mcp-server/src/adapters/bmad/`). Captures the
observed shape of BMad story files in this repo as of Story 3.3.

This spike is **not** a user doc; do not link it from any README or
install path. The adapter source links here via TSDoc `@see`.

---

## Source-file location convention

`BmadAdapter.defaultConfig()` returns
`stories_root: "_bmad-output/planning-artifacts/stories"`. In this
repo, however, the actually-committed BMad stories live under
`_bmad-output/implementation-artifacts/`. The default is best-effort
for first-run auto-detect; the real location lives in
`.crew/config.yaml`'s `adapter_config.stories_root`, which always
wins.

**Precedence:** `adapter_config.stories_root` from `.crew/config.yaml`
> `BmadAdapter.defaultConfig().stories_root`.

`detect()` cannot read `.crew/config.yaml` (the config may not exist
at first-run auto-detect time), so it uses the default. If a custom
`stories_root` is set, the registry only consults `detect()` when
there is no config — so the default is correct.

## Frontmatter fields

BMad stories do **not** carry YAML frontmatter. The "frontmatter" is
a prose header block:

- **Story id** — parsed from the filename `<epic>-<story>-<slug>.md`
  and verified against the H1. Filename pattern:
  `^\d+-\d+-[a-z0-9-]+\.md$`. The H1 has the shape
  `# Story <epic>.<story>: <title>`. On mismatch, the parser throws
  `MalformedBmadStoryError`.
- **Title** — the H1 text after the colon. Inline backticks are
  preserved; surrounding whitespace stripped.
- **Status** — the `Status: <value>` line near the top of the file
  (typically line 3).
- **Sections** — `## Story`, `## Acceptance Criteria`,
  `## Tasks / Subtasks`, `## Dev Notes`, optional `## Dependencies`,
  `## Implementation Notes`. Section presence is used to extract
  narrative, ACs, dependencies, and implementation notes.

## Lifecycle vocabulary

Confirmed values from
`_bmad-output/implementation-artifacts/sprint-status.yaml` STATUS
DEFINITIONS plus Story 3.1's backward-compat note. Mapping to the
plugin's execution-state vocabulary
(`to-do | in-progress | blocked | done`):

| BMad status      | Execution state | Notes                                                   |
|------------------|-----------------|---------------------------------------------------------|
| `backlog`        | `to-do`         |                                                         |
| `ready-for-dev`  | `to-do`         | manifest moves to `in-progress` on claim                |
| `in-progress`    | `in-progress`   |                                                         |
| `done`           | `done`          |                                                         |
| `optional`       | _(skipped)_     | `listSourceStories` filters these out                   |
| `contexted`      | `to-do`         | legacy, backward-compat                                 |
| _(anything else)_ | _(throws)_     | `MalformedBmadStoryError` naming the unknown status     |

Operators who want `optional` stories executed should remove the
`optional` tag and use `backlog` / `ready-for-dev`.

## Acceptance criteria shape

ACs are bolded numbered headings followed by Given/When/Then prose:

```
**AC1:**
**Given** ...
**When** ...
**Then** ...

**AC2 (user-surface):**
...

**AC3 (integration):**
...
```

- The numeric prefix is canonical (`AC<n>`).
- The parenthetical tag is the kind hint:
  - `(integration)` → `kind: "integration"`.
  - `(user-surface)` → `kind: "integration"` (user-surface ACs are
    end-to-end by construction; see `user-surface-acs.md`).
  - any other parenthetical, or none → `kind: "unit"`.
- Matching is case-insensitive.
- HTML comments inside an AC body are stripped.

The planning-discipline validator (Story 3.5) is responsible for
raising the bar when a state-mutating story lacks an `integration`
AC. The adapter just reports what it sees.

## Dependency syntax

BMad stories in this repo do not carry a structured `depends_on`
field. The adapter parses an optional `## Dependencies` (or
`### Dependencies`) section as a bullet list. Refs accepted:

- `bmad:<epic>.<story>` — already-normalised form.
- `<epic>-<story>-<slug>` — filename-style; the adapter normalises
  to `bmad:<epic>.<story>`.

If the section is missing, `depends_on` is `[]`. The adapter does
**not** mine prose for dependencies.

## `raw_frontmatter` carrier

BMad has no real frontmatter; the adapter synthesises:

```
{
  status: "<status-string>",
  title: "<title>",
  id: "<epic>.<story>",
  filename_slug: "<slug>"
}
```

The `bmad:`-prefixed form lives in `ref`. Additional fields are not
populated.

## Leniency rules (Story 3.8)

Story 3.8 widened the BMad adapter to handle deviations that accumulate in
organic BMad backlogs. These rules apply to the parser and `scan-sources`
loop; the canonical BMad spec shape (H1 contract, `## Acceptance Criteria`
heading, AC heading shape, `Dependencies` parsing) is unchanged.

### (a) Letter-suffixed story IDs are accepted

Files like `4-8b-...md` and `5-4b-...md` are parsed successfully. The
returned `SourceStory.ref` preserves the letter suffix (e.g. `bmad:4.8b`),
and `raw_frontmatter.id` is `"4.8b"`. Manifests downstream key off the
suffixed ref so `bmad:4.8b` and `bmad:4.8` never collide.

The accepted suffix shape is one lowercase letter (`[a-z]?`) immediately
following the story number. Wider patterns (multi-letter, alphanumeric)
are deferred to a later story.

### (b) Missing `Status:` defaults to `backlog`

If no `Status:` line appears between the H1 and the first `##` section
heading, the parser sets `status = "backlog"` and marks
`raw_frontmatter.status_defaulted = true`. The story flows to `to-do/` as
normal. No error is thrown.

### (c) Unknown `Status:` values produce a blocked manifest, not a hard error

If `Status:` is present but its value is not in the known BMad vocabulary
(`backlog`, `ready-for-dev`, `in-progress`, `done`, `optional`, `contexted`),
the parser does **not** throw. Instead it:

1. Sets `raw_frontmatter.status_unknown = { raw: "<value>", reason: "status-vocabulary-unknown" }`.
2. Uses `"backlog"` as the effective execution-mapped status.

The `scan-sources` loop detects `status_unknown` and:

1. Writes the manifest to `.crew/state/blocked/<ref>.yaml` with
   `blocked_by: "status-vocabulary-unknown"`.
2. Appends a structured warning to `ScanResult.warnings` naming the file path
   and the unrecognised value.
3. Continues the scan — it does **not** halt on the first bad file.

To fix: edit the spec's `Status:` line to one of the known values, or remove
the line entirely (it then defaults to `backlog`), and re-run `/crew:scan`.

### (d) Non-conforming filenames in the stories directory are silently skipped

Files whose names do not match the BMad story-spec pattern (e.g.
`epic-1-retro-2026-05-20.md`, `sprint-status.yaml`, `index.md`) are silently
skipped — no warning emitted, no error thrown, no manifest written. Retros
and bookkeeping files legitimately live in the same directory.

The filename pattern (after Story 3.8) is:
`/^\d+-\d+[a-z]?-[a-z0-9-]+\.md$/`

### Cross-reference

Leniency rules introduced in
`_bmad-output/implementation-artifacts/3-8-bmad-adapter-real-world-leniency.md`.
The integration fixture exercising all four rules lives at
`plugins/crew/mcp-server/src/adapters/bmad/fixtures/sample-real-world-repo/`.

## Disagreements with Story 3.3 tasks

None at spike time. If the dev finds disagreements during
implementation, record them in the Dev Agent Record so the
orchestrator can correct course before PR.
