/**
 * Integration tests for the `scanSources` tool (Story 3.2).
 *
 * Each `it` block gets its own scratch dir via `fs.mkdtemp` + `fs.cp` from
 * the committed fixture at `tests/fixtures/scan-sources-fixture/`.
 * Tests never mutate the committed fixture tree — all writes go into the
 * scratch dir.
 *
 * Mtime preservation (AC2): On macOS APFS the mtime resolution is 1 ns, so
 * a second `scanSources` call that writes nothing should leave the mtime
 * untouched. To make this assertion deterministic across CI runners
 * (Linux ext4/tmpfs may have 1 s resolution), we use `fs.utimes` to backdate
 * the mtimes before the second scan so any spurious write is detectable even
 * on 1 s granularity filesystems.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getPluginRoot } from "../src/lib/plugin-root.js";
import { MalformedExecutionManifestError } from "../src/errors.js";
import { parseExecutionManifest } from "../src/schemas/execution-manifest.js";
import { scanSources } from "../src/tools/scan-sources.js";
import { parse as yamlParse } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "fixtures", "scan-sources-fixture");

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-scan-"));
  await fs.cp(FIXTURE_DIR, scratch, { recursive: true });
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC1 — first scan creates manifests for every source story
// ---------------------------------------------------------------------------

it("AC1 — first scan creates manifests for every source story", async () => {
  const result = await scanSources({ targetRepoRoot: scratch });

  expect(result.createdRefs).toHaveLength(2);
  expect(result.createdRefs).toContain("bmad:1.1");
  expect(result.createdRefs).toContain("bmad:1.2");
  expect(result.updatedRefs).toHaveLength(0);
  expect(result.unchangedRefs).toHaveLength(0);
  expect(result.skippedRefs).toHaveLength(0);

  // Verify the on-disk manifest for bmad:1.1 parses and has expected fields.
  const manifestPath11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
  const raw11 = await fs.readFile(manifestPath11, "utf8");
  const parsed11 = parseExecutionManifest(yamlParse(raw11), { absPath: manifestPath11 });

  expect(parsed11.status).toBe("to-do");
  expect(parsed11.adapter).toBe("bmad");
  expect(parsed11.ref).toBe("bmad:1.1");

  // Verify source_hash matches what we'd compute from the fixture file bytes.
  const storyBytesA = await fs.readFile(
    path.join(scratch, "_bmad-output", "planning-artifacts", "stories", "1-1-fixture-story-a.md"),
  );
  const expectedHashA = createHash("sha256").update(storyBytesA).digest("hex");
  expect(parsed11.source_hash).toBe(expectedHashA);

  // Verify bmad:1.2 manifest parses too.
  const manifestPath12 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.2.yaml");
  const raw12 = await fs.readFile(manifestPath12, "utf8");
  const parsed12 = parseExecutionManifest(yamlParse(raw12), { absPath: manifestPath12 });
  expect(parsed12.ref).toBe("bmad:1.2");
  expect(parsed12.status).toBe("to-do");
  // bmad:1.2 depends_on bmad:1.1 (from the ## Dependencies section in the fixture).
  expect(parsed12.depends_on).toContain("bmad:1.1");
});

// ---------------------------------------------------------------------------
// AC2 — second scan with no changes is a no-op (idempotent)
// ---------------------------------------------------------------------------

it("AC2 — second scan with no source changes is a no-op", async () => {
  // First scan — creates manifests.
  await scanSources({ targetRepoRoot: scratch });

  const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
  const path12 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.2.yaml");

  // Backdate mtimes by 5 seconds so any write is detectable even on 1 s granularity.
  // We use the past time as the deterministic baseline.
  const past = new Date(Date.now() - 5000);
  await fs.utimes(path11, past, past);
  await fs.utimes(path12, past, past);

  const mtimeBefore11 = (await fs.stat(path11)).mtimeMs;
  const mtimeBefore12 = (await fs.stat(path12)).mtimeMs;

  // Second scan — should not rewrite anything.
  const result2 = await scanSources({ targetRepoRoot: scratch });

  expect(result2.createdRefs).toHaveLength(0);
  expect(result2.updatedRefs).toHaveLength(0);
  expect(result2.unchangedRefs).toHaveLength(2);
  expect(result2.unchangedRefs).toContain("bmad:1.1");
  expect(result2.unchangedRefs).toContain("bmad:1.2");

  // Mtime must be unchanged — the load-bearing AC2 assertion.
  const mtimeAfter11 = (await fs.stat(path11)).mtimeMs;
  const mtimeAfter12 = (await fs.stat(path12)).mtimeMs;
  expect(mtimeAfter11).toBe(mtimeBefore11);
  expect(mtimeAfter12).toBe(mtimeBefore12);
});

// ---------------------------------------------------------------------------
// AC3 — source edit triggers hash refresh for to-do manifest
// ---------------------------------------------------------------------------

it("AC3 — source edit triggers hash refresh for to-do manifest", async () => {
  // First scan.
  await scanSources({ targetRepoRoot: scratch });

  const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
  const path12 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.2.yaml");

  // Record bmad:1.2's mtime for the unchanged-check below.
  const past = new Date(Date.now() - 5000);
  await fs.utimes(path12, past, past);
  const mtime12Before = (await fs.stat(path12)).mtimeMs;

  // Read the pre-edit hash of bmad:1.1.
  const rawBefore = await fs.readFile(path11, "utf8");
  const manifestBefore = parseExecutionManifest(yamlParse(rawBefore), { absPath: path11 });
  const hashBefore = manifestBefore.source_hash;

  // Edit the source for story 1.1 (append a newline — changes bytes but stays parseable).
  const storyAPath = path.join(
    scratch,
    "_bmad-output",
    "planning-artifacts",
    "stories",
    "1-1-fixture-story-a.md",
  );
  const originalContent = await fs.readFile(storyAPath, "utf8");
  await fs.writeFile(storyAPath, originalContent + "\n");

  // Compute the expected new hash.
  const newBytes = await fs.readFile(storyAPath);
  const newHash = createHash("sha256").update(newBytes).digest("hex");
  expect(newHash).not.toBe(hashBefore);

  // Second scan — should update bmad:1.1 only.
  const result2 = await scanSources({ targetRepoRoot: scratch });

  expect(result2.updatedRefs).toContain("bmad:1.1");
  expect(result2.updatedRefs).toHaveLength(1);
  expect(result2.unchangedRefs).toContain("bmad:1.2");

  // Verify the manifest now has the new hash.
  const rawAfter = await fs.readFile(path11, "utf8");
  const manifestAfter = parseExecutionManifest(yamlParse(rawAfter), { absPath: path11 });
  expect(manifestAfter.source_hash).toBe(newHash);

  // bmad:1.2 must be untouched (mtime preserved).
  const mtime12After = (await fs.stat(path12)).mtimeMs;
  expect(mtime12After).toBe(mtime12Before);
});

// ---------------------------------------------------------------------------
// AC3 negative — manifest in in-progress/ is NOT touched by re-scan
// ---------------------------------------------------------------------------

it("AC3 — manifest in in-progress/ is NOT touched by re-scan", async () => {
  // First scan — creates to-do/ manifests.
  await scanSources({ targetRepoRoot: scratch });

  const toDoPath11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
  const inProgressPath11 = path.join(scratch, ".crew", "state", "in-progress", "bmad:1.1.yaml");

  // Move bmad:1.1 to in-progress/ (simulate claim; bypass state machine in test setup).
  await fs.mkdir(path.dirname(inProgressPath11), { recursive: true });
  await fs.rename(toDoPath11, inProgressPath11);

  // Record the in-progress manifest contents before re-scan.
  const contentsBefore = await fs.readFile(inProgressPath11, "utf8");

  // Edit the source story so a hash-refresh would occur if scan touched it.
  const storyAPath = path.join(
    scratch,
    "_bmad-output",
    "planning-artifacts",
    "stories",
    "1-1-fixture-story-a.md",
  );
  const orig = await fs.readFile(storyAPath, "utf8");
  await fs.writeFile(storyAPath, orig + "\n");

  // Second scan.
  const result2 = await scanSources({ targetRepoRoot: scratch });

  // bmad:1.1 must be in skippedRefs with reason: "not-in-to-do".
  const skippedEntry = result2.skippedRefs.find((s) => s.ref === "bmad:1.1");
  expect(skippedEntry).toBeDefined();
  expect(skippedEntry?.reason).toBe("not-in-to-do");
  expect(result2.updatedRefs).toHaveLength(0);

  // The in-progress manifest must be byte-identical to before the scan.
  const contentsAfter = await fs.readFile(inProgressPath11, "utf8");
  expect(contentsAfter).toBe(contentsBefore);
});

// ---------------------------------------------------------------------------
// AC5 — malformed manifest in to-do/ surfaces MalformedExecutionManifestError
// ---------------------------------------------------------------------------

describe("AC5 — malformed manifest refuses with typed error", () => {
  it("structurally-valid YAML missing a required field (source_hash)", async () => {
    // First scan — create manifests.
    await scanSources({ targetRepoRoot: scratch });

    const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");

    // Overwrite with YAML that is valid YAML but missing required field.
    await fs.writeFile(
      path11,
      "ref: bmad:1.1\nstatus: to-do\nadapter: bmad\nsource_path: some/path.md\ndepends_on: []\nacceptance_criteria:\n  - text: Some AC\n    kind: unit\ntitle: Test\nnarrative: As a test.\nwithdrawn: false\n",
    );

    // Re-scan: should throw MalformedExecutionManifestError because source_hash is missing.
    await expect(scanSources({ targetRepoRoot: scratch })).rejects.toThrow(
      MalformedExecutionManifestError,
    );

    // The error message must contain the absolute path of the manifest.
    await expect(scanSources({ targetRepoRoot: scratch })).rejects.toSatisfy(
      (err: unknown) => err instanceof MalformedExecutionManifestError && err.absPath === path11,
    );
  });

  it("YAML with extra unknown key triggers strict-mode rejection", async () => {
    // First scan.
    await scanSources({ targetRepoRoot: scratch });

    const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
    const raw = await fs.readFile(path11, "utf8");
    // Append an unknown key to trigger .strict() rejection.
    await fs.writeFile(path11, raw + "unknown_future_field: surprise\n");

    await expect(scanSources({ targetRepoRoot: scratch })).rejects.toThrow(
      MalformedExecutionManifestError,
    );
  });
});

// ---------------------------------------------------------------------------
// AC7 — SKILL.md contains required content anchors (structural anchor)
// ---------------------------------------------------------------------------

describe("skills/scan/SKILL.md content anchors (AC7)", () => {
  it("SKILL.md contains 'name: crew:scan' and 'scan-sources'", async () => {
    const skillPath = path.join(getPluginRoot(), "skills", "scan", "SKILL.md");
    const contents = await fs.readFile(skillPath, "utf8");

    // AC7 anchor 1: frontmatter name field.
    expect(contents).toContain("name: crew:scan");
    // AC7 anchor 2: body references the MCP tool (kebab-case form, as asserted by AC7).
    expect(contents).toContain("scan-sources");
  });
});
