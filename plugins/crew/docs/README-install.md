# Install crew

Six checkpoints from clone to seeing the plugin recognise your repo. Each step has one runnable command and one expected confirmation. If a checkpoint fails, the failure is local to that step — don't proceed.

> Heads-up: steps 3a, 3b, and 6 are **slash commands you type inside a running Claude Code session**, not shell commands. Steps 3a and 3b in particular open Claude Code's interactive **Marketplaces** TUI panel — there is no stdout line to grep for; you confirm inside the panel.

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

   Expected confirmation: Claude Code opens its **Marketplaces** TUI panel. You should see something shaped like the block below — the panel title, your existing marketplaces (if any), and a new `crew` entry sourced from `./`. Confirm inside the panel (the panel's own prompt tells you which key); on confirmation you land on the **`crew`** tab listing the plugins published by that marketplace.

   ```text
   ┌─ Marketplaces ─────────────────────────────────┐
   │   <any pre-existing marketplaces…>             │
   │ > crew                              source: ./ │
   └────────────────────────────────────────────────┘
   ```

   There is **no stdout confirmation line** — the panel is the surface. If the panel doesn't open, the command literal didn't register; re-check that you typed it inside Claude Code (not a shell) and that the `./` is present.

   3b. Install the `crew` plugin from that marketplace:

   ```text
   /plugin install crew@crew
   ```

   Expected confirmation: Claude Code opens its install TUI flow for `crew@crew`, validates the plugin locally, and on success lands you on the plugin's tab inside the Marketplaces panel showing it as **installed**. Again, no `Plugin installed: …` stdout line — the panel state is the surface.

   If validation fails (e.g. the plugin's `plugin.json` is malformed, the committed `dist/` is missing, or any other local-shape regression), Claude Code surfaces a cache path in the error output that looks like:

   ```text
   ~/.claude/plugins/cache/temp_local_<hash>
   ```

   That directory is where Claude Code staged the plugin for validation. The failure is **local** — there is no remote registry call. If you hit it, `ls` the `temp_local_*` path to see what was staged, fix the underlying file in your checkout, and re-run `/plugin install crew@crew`.

4. **Restart Claude Code.**

   ```text
   Quit and reopen Claude Code (no shell command).
   ```

   The restart is **non-optional**. `crew` ships an MCP server, and Claude Code only spawns MCP servers **at launch** — `/plugin install` registers the plugin but does NOT start the server mid-session. If you skip the restart, `/crew:status` will either be missing from tab-complete or fail with a `Tool not found` shape, and there is no other signal that the restart is what's missing.

   Expected confirmation: after you reopen Claude Code, type `/` and start typing `crew`. The `/crew:` namespace appears in the slash-command picker / tab-complete, with at least `/crew:status` listed. You do **not** need to invoke anything yet.

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

6. **Run `/<plugin>:status` and see the expected line.**

   ```text
   /crew:status
   ```

   (Run inside Claude Code, with `<target-repo>` loaded as the workspace.)

   Expected confirmation:

   ```text
   crew v0.1.0
   target repo: /Users/you/projects/your-repo
   adapter: bmad (ok)
   standards: ok — /Users/you/projects/your-repo/docs/standards.md
   cycle: none
   ```

   (First line matches `^crew v\d+\.\d+\.\d+(?:-[\w.]+)?$`; the `standards:` line starts with `standards: ok`.)

## Build artefacts

`plugins/crew/mcp-server/dist/` is **committed to git by design** (Story 1.9). `/plugin install` copies the working tree as-is and does not run a build step, so the compiled MCP server must already be present in the tree.

Contract:

- Any change to `plugins/crew/mcp-server/src/**` must be followed by `pnpm install --frozen-lockfile && pnpm build` from `plugins/crew/mcp-server/`, and the resulting `dist/` committed in the same change.
- CI fails any PR where the committed `dist/` drifts from a fresh `pnpm build` (see `.github/workflows/ci.yml` — the `Verify committed dist/ matches fresh build` step runs `git diff --exit-code mcp-server/dist`). The vitest suite `tests/dist-shipping.test.ts` mirrors that check locally and also imports `dist/index.js` and `dist/tools/register.js` as a sentinel against partial builds.
- Do NOT re-add `dist/` (or `**/dist/`) to any `.gitignore`. If a new workspace package needs its own `dist/` ignored, name it explicitly and leave a comment.
- Do NOT introduce a `prepare` / `postinstall` build hook to "fix" this. `/plugin install` won't run it. The committed-artefact path is the v1 contract.

> See Story 7.2 (Epic 7) for the full first-run walkthrough.
