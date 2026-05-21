# Install crew

> **Engineer working on the plugin itself?** Use `pnpm dev:install` from the repo
> root and see [dev-loop.md](./dev-loop.md). The six checkpoints below are the
> production install path for end-users. These two paths are kept separate so an
> engineer iterating on a worktree branch does not interfere with the stable
> production install, and vice versa.

Six checkpoints from clone to seeing the plugin recognise your repo. Each step has one runnable command and one expected confirmation. If a checkpoint fails, the failure is local to that step — don't proceed.

> Heads-up: steps 3a, 3b, 4, and 6 are **slash commands you type inside a running Claude Code session**, not shell commands. Each one prints a single-line toast back into the transcript — there's no separate TUI panel to confirm in.

1. **Install Claude Code.**

   ```bash
   claude --version
   ```

   Expected confirmation:

   ```text
   claude 1.2.3
   ```

   (Any line matching `^claude \d+\.\d+\.\d+`.)

2. **Clone the repo and install plugin dependencies.**

   ```bash
   git clone https://github.com/jackmcintyre/crew.git && cd crew && pnpm --dir plugins/crew install
   ```

   Expected confirmation:

   ```text
   Done
   ```

   (The final line of `pnpm install` matches `^(Done|Already up to date)`.)

3. **Load the plugin into Claude Code.**

   Run two slash commands inside a running Claude Code session, from the repo root.

   3a. Register the repo as a plugin marketplace:

   ```text
   /plugin marketplace add ./
   ```

   Expected confirmation — a single-line toast in the transcript:

   ```text
   Successfully added marketplace: crew
   ```

   If you don't see that toast, the command literal didn't register; re-check that you typed it inside Claude Code (not a shell) and that the `./` is present.

   3b. Install the `crew` plugin from that marketplace:

   ```text
   /plugin install crew@crew
   ```

   Expected confirmation — a single-line toast in the transcript:

   ```text
   ✓ Installed crew. Run /reload-plugins to apply.
   ```

   The toast tells you the next step explicitly: `/reload-plugins` (step 4 below) is what actually applies the install.

4. **Reload plugins.**

   ```text
   /reload-plugins
   ```

   Expected confirmation — a single-line toast in the transcript shaped like:

   ```text
   Reloaded: 5 plugins · 3 skills · 6 agents · 0 hooks · 3 plugin MCP servers · 1 plugin LSP server
   ```

   The exact counts vary by what else you have installed; what matters is the line starts with `Reloaded:` and the `plugin MCP servers` count is **non-zero** (that's the `crew` MCP server coming online). `/reload-plugins` reloads MCP servers in-process — **no Claude Code restart is required**.

5. **Copy the standards template into your target repo.**

   ```bash
   cp plugins/crew/docs/standards-example.md <target-repo>/docs/standards.md
   ```

   `<target-repo>` may be the same as the cloned `crew` repo (Jack's same-repo case) or a different repo (Maya's split-repo case) — no behavioural difference.

   Expected confirmation:

   ```text
   <target-repo>/docs/standards.md
   ```

   (`ls <target-repo>/docs/standards.md` returns the path — the file now exists.)

   Available slash commands after install:

   | Skill | Description |
   |---|---|
   | `/crew:status` | Print the current plugin version, target repo, adapter, and standards-doc state. |
   | `/crew:hire` | Open a hiring conversation — the hiring manager reads your repo and proposes a starting team. |
   | `/crew:skip-hiring` | Hire the default five-role roster directly without an interactive proposal. |
   | `/crew:plan` | Open a planning conversation. On native repos, spawn the planner subagent to author stories; on BMad repos, point you at BMad's authoring skills. |
   | `/crew:scan` | Scan the active adapter's source stories into `.crew/state/to-do/` execution manifests. Idempotent. |
   | `/crew:team` | Print a one-shot snapshot of your hired team — roles, domains, recent knowledge entries, fire counts. |
   | `/crew:ask` | Open a non-mutating side-session with a hired role — ask one question, get one answer. |

6. **Run `/<plugin>:status` and see the current adapter state.**

   ```text
   /crew:status
   ```

   (Run inside Claude Code, with `<target-repo>` loaded as the workspace.)

   Expected confirmation **today** — a known-limitation error toast:

   ```text
   bmad adapter: detect lands in Story 3.3
   ```

   This is the **current ground-truth output on a clean install**. The BMad adapter's detect path is parked — it ships in Story 3.3 ("BMad adapter detect path"). Until then, `/crew:status` correctly reports that no adapter has been confirmed for the repo. Seeing the line above means the plugin is installed, the MCP server is running, and the status tool is wired through end-to-end; only the adapter probe is still stubbed.

   Once Story 3.3 lands, this step will instead return the full status block (`crew vX.Y.Z`, target repo, adapter, standards, cycle). This README will be updated in the same change.

## Planning-discipline enforcement

Story 3.5 introduced automatic planning-discipline validation at two points in the backlog lifecycle:

**At authoring time (`/crew:plan` — native adapter only):** The planner subagent calls `validatePlannerBacklog` before writing any story. If a story violates a discipline rule, the planner refuses to write and surfaces the violation to the operator. The four refusal codes are:

- `missing-integration-ac` — a state-mutating story has no integration-tagged AC. Fix: add a `(integration)`-tagged AC that exercises the changed code path end-to-end.
- `implicit-depends-on` — a story references another story's ref in its narrative or ACs but omits it from `depends_on`. Fix: add the ref to `depends_on`, or rephrase to remove the cross-story reference.
- `missing-ship-gate` — no story in the backlog is flagged as the release gate. Fix: designate one story (`ship_gate: true`) or author a dedicated ship-gate story that `depends_on` every other story.
- `state-mutating-without-integration-ac` — scan-time mirror of `missing-integration-ac` (forward-compat).

**At scan time (`/crew:scan` — BMad and native adapters):** If a source story violates a discipline rule, `scan-sources` writes its manifest to `.crew/state/blocked/<ref>.yaml` (not `to-do/`) with `status: blocked`, `blocked_by: planning-discipline`, and a `discipline_violations:` block naming the rule. The `/crew:scan` output prints a `blocked:` line naming the affected refs.

**Operator remediation:** Edit the source story to satisfy the violated rule, then re-run `/crew:scan`. The next scan detects the changed `source_hash` and re-evaluates the story against the discipline rules. If it now passes, the blocked manifest is deleted and a new `to-do/` manifest is written automatically — the story is promoted and ready for the dev loop to claim. If the story is still violating, the blocked manifest is rewritten with the updated hash and latest violations. If the source is unchanged since the last scan, the blocked manifest is left untouched (no spurious mtime updates).

## Discarding a feature (FR78)

Story 3.6 introduces a first-class discard flow accessible from `/crew:plan` on its second and subsequent invocations (re-open mode). Two branches:

**Native adapter — revert/deprecate story:** When you choose `discard` against a `native:<ULID>` ref, the planner authors a new story with the title prefix `revert/deprecate: ` followed by the original story's title. This new story enters the backlog as a fresh `to-do/` manifest on the next `/crew:scan`. The original native story file and its execution manifest are never deleted — they remain on disk for traceability.

**External-adapter (BMad) — manifest withdrawal:** When you choose `discard` against a `bmad:<source-id>` ref (or any non-native ref), the plugin calls the `markWithdrawn` MCP tool, which flips `withdrawn: true` in the execution manifest in-place (same state directory, same filename). The plugin then surfaces a reminder: `"Manifest marked withdrawn. Close the source story in <adapter-name> manually — the plugin cannot edit the source tool's tree."` Closing the source story in BMad (or whichever external tool owns it) is your responsibility.

**Confirming a withdrawal landed:** Inspect the manifest under `.crew/state/<state>/<ref>.yaml` and check for the `withdrawn: true` field. Once set, the dev loop's claim path skips the manifest automatically — it will never be picked up for implementation unless you hand-edit the field back.

## Build artefacts

`plugins/crew/mcp-server/dist/` is **committed to git by design** (Story 1.9). `/plugin install` copies the working tree as-is and does not run a build step, so the compiled MCP server must already be present in the tree.

Contract:

- Any change to `plugins/crew/mcp-server/src/**` must be followed by `pnpm install --frozen-lockfile && pnpm build` from `plugins/crew/mcp-server/`, and the resulting `dist/` committed in the same change.
- CI fails any PR where the committed `dist/` drifts from a fresh `pnpm build` (see `.github/workflows/ci.yml` — the `Verify committed dist/ matches fresh build` step runs `git diff --exit-code mcp-server/dist`). The vitest suite `tests/dist-shipping.test.ts` mirrors that check locally and also imports `dist/index.js` and `dist/tools/register.js` as a sentinel against partial builds.
- Do NOT re-add `dist/` (or `**/dist/`) to any `.gitignore`. If a new workspace package needs its own `dist/` ignored, name it explicitly and leave a comment.
- Do NOT introduce a `prepare` / `postinstall` build hook to "fix" this. `/plugin install` won't run it. The committed-artefact path is the v1 contract.

> See Story 7.2 (Epic 7) for the full first-run walkthrough.
