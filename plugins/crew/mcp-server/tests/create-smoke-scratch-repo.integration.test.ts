/**
 * Integration tests for `createSmokeScratchRepo` — Story 4.14 AC1 / AC3.
 *
 * Exercises the helper end-to-end against a real `os.tmpdir()` scratch:
 *   - git init + initial empty commit succeed (planner's `git rev-parse HEAD`
 *     would succeed afterwards).
 *   - `.crew/config.yaml` is the minimal native-adapter shape.
 *   - `.crew/standards.md` is a verbatim copy of the shipped template
 *     (`plugins/crew/docs/standards-example.md`).
 *   - The returned `cleanup` closure removes the scratch tree.
 *
 * No fakes for git or the filesystem — follows the precedent of
 * `claim-complete-loop.integration.test.ts`, `mark-withdrawn.integration.test.ts`,
 * and `hand-edit-allowance.integration.test.ts`.
 */

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createSmokeScratchRepo } from "../src/tools/create-smoke-scratch-repo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");
const STANDARDS_TEMPLATE_PATH = path.join(PLUGIN_ROOT, "docs", "standards-example.md");

let parentDir: string;

beforeEach(async () => {
  parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crew-smoke-parent-"));
});

afterEach(async () => {
  await fs.rm(parentDir, { recursive: true, force: true });
});

describe("createSmokeScratchRepo (Story 4.14)", () => {
  it("creates a scratch root under parentDir whose name embeds the label and ends with a ULID", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "4-14-test",
    });
    try {
      const stats = await fs.stat(scratchRoot);
      expect(stats.isDirectory()).toBe(true);

      const base = path.basename(scratchRoot);
      expect(base).toMatch(/^crew-smoke-4-14-test-[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(path.dirname(scratchRoot)).toBe(parentDir);
    } finally {
      await cleanup();
    }
  });

  it("initialises git with an initial empty commit (planner's rev-parse HEAD would succeed)", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "git-init",
    });
    try {
      const rev = await execa("git", ["-C", scratchRoot, "rev-parse", "HEAD"]);
      expect(rev.exitCode).toBe(0);
      expect((rev.stdout ?? "").trim()).toMatch(/^[0-9a-f]{40}$/);

      // The initial commit is empty — `git log --oneline` shows exactly one entry.
      const log = await execa("git", ["-C", scratchRoot, "log", "--oneline"]);
      expect((log.stdout ?? "").trim().split("\n")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("writes a minimal `.crew/config.yaml` selecting the native adapter", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "config",
    });
    try {
      const configPath = path.join(scratchRoot, ".crew", "config.yaml");
      const contents = await fs.readFile(configPath, "utf8");
      expect(contents).toContain("adapter: native");
    } finally {
      await cleanup();
    }
  });

  it("copies the plugin's shipped standards template to `.crew/standards.md`", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "standards",
    });
    try {
      const template = await fs.readFile(STANDARDS_TEMPLATE_PATH, "utf8");
      const written = await fs.readFile(path.join(scratchRoot, ".crew", "standards.md"), "utf8");
      expect(written).toBe(template);
    } finally {
      await cleanup();
    }
  });

  it("returns a cleanup closure that removes the scratch tree", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "cleanup",
    });

    // Pre-cleanup: exists.
    await expect(fs.stat(scratchRoot)).resolves.toBeDefined();

    await cleanup();

    // Post-cleanup: gone.
    await expect(fs.stat(scratchRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleanup closure is idempotent (second call is a no-op)", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "idempotent",
    });
    await cleanup();
    await expect(cleanup()).resolves.toBeUndefined();
    await expect(fs.stat(scratchRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("defaults parentDir to os.tmpdir() when omitted", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      label: "default-tmpdir",
    });
    try {
      // The realpath dance handles platforms (macOS, BSD) where `os.tmpdir()`
      // returns `/var/folders/...` while a child path under that tree may
      // surface as `/private/var/folders/...` once the OS resolves symlinks.
      const tmpReal = await fs.realpath(os.tmpdir());
      const scratchReal = await fs.realpath(scratchRoot);
      expect(scratchReal.startsWith(tmpReal)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("sanitises the label component to kebab-case (uppercase + spaces collapse to hyphens)", async () => {
    const { scratchRoot, cleanup } = await createSmokeScratchRepo({
      parentDir,
      label: "4.6 Rev 2",
    });
    try {
      const base = path.basename(scratchRoot);
      expect(base).toMatch(/^crew-smoke-4-6-rev-2-[0-9A-HJKMNP-TV-Z]{26}$/);
    } finally {
      await cleanup();
    }
  });
});
