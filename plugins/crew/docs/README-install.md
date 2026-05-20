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

## Build artefacts

`plugins/crew/mcp-server/dist/` is **committed to git by design** (Story 1.9). `/plugin install` copies the working tree as-is and does not run a build step, so the compiled MCP server must already be present in the tree.

Contract:

- Any change to `plugins/crew/mcp-server/src/**` must be followed by `pnpm install --frozen-lockfile && pnpm build` from `plugins/crew/mcp-server/`, and the resulting `dist/` committed in the same change.
- CI fails any PR where the committed `dist/` drifts from a fresh `pnpm build` (see `.github/workflows/ci.yml` — the `Verify committed dist/ matches fresh build` step runs `git diff --exit-code mcp-server/dist`). The vitest suite `tests/dist-shipping.test.ts` mirrors that check locally and also imports `dist/index.js` and `dist/tools/register.js` as a sentinel against partial builds.
- Do NOT re-add `dist/` (or `**/dist/`) to any `.gitignore`. If a new workspace package needs its own `dist/` ignored, name it explicitly and leave a comment.
- Do NOT introduce a `prepare` / `postinstall` build hook to "fix" this. `/plugin install` won't run it. The committed-artefact path is the v1 contract.

> See Story 7.2 (Epic 7) for the full first-run walkthrough.
