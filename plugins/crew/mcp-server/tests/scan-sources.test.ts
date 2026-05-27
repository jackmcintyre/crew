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
import { parseExecutionManifest } from "../src/schemas/execution-manifest.js";
import { scanSources } from "../src/tools/scan-sources.js";
import { parse as yamlParse } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "fixtures", "scan-sources-fixture");
const DISCIPLINE_FIXTURE_DIR = path.join(HERE, "fixtures", "scan-sources-discipline-fixture");

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
// AC5 — malformed manifest in to-do/ is contained per-file (Story 5.19 flip)
//
// Pre-5.19: scanSources propagated MalformedExecutionManifestError to the
// boundary on the first malformed manifest, aborting the whole pass.
// Post-5.19: each bad manifest is contained — the ref lands in
// result.skippedRefs with reason "unreadable-manifest" and a non-empty detail,
// and the scan continues with the remaining manifests. See
// scan-sources-readfile-resilience.test.ts for the dedicated coverage.
// ---------------------------------------------------------------------------

describe("AC5 (post 5.19 flip) — malformed manifest is contained, not thrown", () => {
  it("structurally-valid YAML missing a required field (source_hash) is contained per-file", async () => {
    // First scan — create manifests.
    await scanSources({ targetRepoRoot: scratch });

    const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");

    // Overwrite with YAML that is valid YAML but missing required field.
    await fs.writeFile(
      path11,
      "ref: bmad:1.1\nstatus: to-do\nadapter: bmad\nsource_path: some/path.md\ndepends_on: []\nacceptance_criteria:\n  - text: Some AC\n    kind: unit\ntitle: Test\nnarrative: As a test.\nwithdrawn: false\n",
    );

    // Re-scan: must NOT throw; the bad ref lands in skippedRefs.
    const result = await scanSources({ targetRepoRoot: scratch });
    const skipped = result.skippedRefs.find((s) => s.ref === "bmad:1.1");
    expect(skipped).toBeDefined();
    expect(skipped!.reason).toBe("unreadable-manifest");
    expect(skipped!.detail).toBeDefined();
    expect(skipped!.detail!.length).toBeGreaterThan(0);
    // Detail still references the manifest path so the operator can act.
    expect(skipped!.detail).toContain(path11);
  });

  it("YAML with extra unknown key is contained per-file (strict-mode reject path)", async () => {
    // First scan.
    await scanSources({ targetRepoRoot: scratch });

    const path11 = path.join(scratch, ".crew", "state", "to-do", "bmad:1.1.yaml");
    const raw = await fs.readFile(path11, "utf8");
    // Append an unknown key to trigger .strict() rejection.
    await fs.writeFile(path11, raw + "unknown_future_field: surprise\n");

    const result = await scanSources({ targetRepoRoot: scratch });
    const skipped = result.skippedRefs.find((s) => s.ref === "bmad:1.1");
    expect(skipped).toBeDefined();
    expect(skipped!.reason).toBe("unreadable-manifest");
    expect(skipped!.detail).toBeDefined();
    expect(skipped!.detail!.length).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Story 3.5 AC4 — scan-sources writes blocked manifest for discipline violation
// ---------------------------------------------------------------------------

describe("AC4 (Story 3.5) — scan-sources blocked manifest on discipline violation", () => {
  let disciplineScratch: string;

  beforeEach(async () => {
    disciplineScratch = await fs.mkdtemp(path.join(os.tmpdir(), "crew-scan-disc-"));
    await fs.cp(DISCIPLINE_FIXTURE_DIR, disciplineScratch, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(disciplineScratch, { recursive: true, force: true });
  });

  it("AC4 — state-mutating BMad story without integration AC produces a blocked/ manifest", async () => {
    const result = await scanSources({ targetRepoRoot: disciplineScratch });

    // The story should be skipped (discipline-violation) and blocked.
    expect(result.skippedRefs.some((s) => s.ref === "bmad:2.1" && s.reason === "discipline-violation")).toBe(true);
    expect(result.blockedRefs).toContain("bmad:2.1");
    expect(result.createdRefs).not.toContain("bmad:2.1");

    // The blocked manifest should exist on disk.
    const blockedPath = path.join(disciplineScratch, ".crew", "state", "blocked", "bmad:2.1.yaml");
    const raw = await fs.readFile(blockedPath, "utf8");
    const manifest = yamlParse(raw) as Record<string, unknown>;

    expect(manifest["status"]).toBe("blocked");
    expect(manifest["blocked_by"]).toBe("planning-discipline");
    expect(Array.isArray(manifest["discipline_violations"])).toBe(true);

    const violations = manifest["discipline_violations"] as Array<{ code: string; field: string; detail: string }>;
    expect(violations.some((v) => v.code === "missing-integration-ac")).toBe(true);

    // Manifest MUST NOT also exist in to-do/.
    const toDoPath = path.join(disciplineScratch, ".crew", "state", "to-do", "bmad:2.1.yaml");
    await expect(fs.stat(toDoPath)).rejects.toThrow();
  });

  it("AC4 — two-pass idempotency: second scan does NOT rewrite the blocked manifest when source is unchanged", async () => {
    // First scan — creates the blocked manifest.
    await scanSources({ targetRepoRoot: disciplineScratch });

    const blockedPath = path.join(disciplineScratch, ".crew", "state", "blocked", "bmad:2.1.yaml");

    // Backdate mtime so any rewrite is detectable on 1 s granularity filesystems.
    const past = new Date(Date.now() - 5000);
    await fs.utimes(blockedPath, past, past);
    const mtimeBefore = (await fs.stat(blockedPath)).mtimeMs;

    // Second scan — source unchanged, so must NOT touch the blocked manifest.
    const result2 = await scanSources({ targetRepoRoot: disciplineScratch });

    // blockedRefs should be empty (source unchanged — no re-evaluation triggered).
    expect(result2.blockedRefs).not.toContain("bmad:2.1");
    // The ref should be skipped (reason: not-in-to-do — hash-unchanged short-circuit).
    expect(result2.skippedRefs.some((s) => s.ref === "bmad:2.1" && s.reason === "not-in-to-do")).toBe(true);

    // Mtime must be unchanged — idempotency load-bearing assertion.
    const mtimeAfter = (await fs.stat(blockedPath)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("path (c): source changed AND validator still fails — blocked manifest is rewritten with new hash and violations", async () => {
    // First scan — creates the blocked manifest with the original source_hash.
    await scanSources({ targetRepoRoot: disciplineScratch });

    const blockedPath = path.join(disciplineScratch, ".crew", "state", "blocked", "bmad:2.1.yaml");
    const toDoPath = path.join(disciplineScratch, ".crew", "state", "to-do", "bmad:2.1.yaml");

    const rawAfterFirstScan = await fs.readFile(blockedPath, "utf8");
    const manifestAfterFirstScan = yamlParse(rawAfterFirstScan) as Record<string, unknown>;
    const originalBlockedHash = manifestAfterFirstScan["source_hash"] as string;

    // Edit the source story to change its hash — but keep it discipline-violating
    // (still state-mutating with no integration AC).
    const storyPath = path.join(
      disciplineScratch,
      "_bmad-output",
      "planning-artifacts",
      "stories",
      "2-1-state-mutating-no-integration.md",
    );
    const original = await fs.readFile(storyPath, "utf8");
    // Append a comment to change the content (still no integration AC → still fails).
    const edited = original + "\n<!-- narrative updated, still missing integration AC -->\n";
    await fs.writeFile(storyPath, edited, "utf8");

    const newExpectedHash = createHash("sha256").update(edited).digest("hex");
    expect(newExpectedHash).not.toBe(originalBlockedHash); // Sanity: hash must differ.

    // Second scan — validator re-runs (source hash changed), story still fails.
    const result2 = await scanSources({ targetRepoRoot: disciplineScratch });

    // (i) The blocked manifest's source_hash must be updated to the new hash.
    const rawAfterSecondScan = await fs.readFile(blockedPath, "utf8");
    const manifestAfterSecondScan = yamlParse(rawAfterSecondScan) as Record<string, unknown>;
    expect(manifestAfterSecondScan["source_hash"]).toBe(newExpectedHash);

    // (ii) discipline_violations must reflect the latest validator output (still non-empty).
    const violations = manifestAfterSecondScan["discipline_violations"] as Array<{
      code: string;
      field: string;
      detail: string;
    }>;
    expect(Array.isArray(violations)).toBe(true);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === "missing-integration-ac")).toBe(true);

    // (iii) The ref appears in blockedRefs.
    expect(result2.blockedRefs).toContain("bmad:2.1");

    // (iv) No to-do/ manifest was written.
    await expect(fs.stat(toDoPath)).rejects.toThrow();
  });

  it("AC4 — fix-then-rescan: fixing blocked story deletes blocked manifest and writes to-do/ manifest", async () => {
    // First scan — creates the blocked manifest.
    await scanSources({ targetRepoRoot: disciplineScratch });

    const blockedPath = path.join(disciplineScratch, ".crew", "state", "blocked", "bmad:2.1.yaml");
    const toDoPath = path.join(disciplineScratch, ".crew", "state", "to-do", "bmad:2.1.yaml");

    // Verify the blocked manifest exists and to-do/ does not.
    await expect(fs.stat(blockedPath)).resolves.toBeTruthy();
    await expect(fs.stat(toDoPath)).rejects.toThrow();

    // Fix the source story by inserting an integration-tagged AC into the
    // ## Acceptance Criteria section (before the ## Dev Notes section).
    const storyPath = path.join(
      disciplineScratch,
      "_bmad-output",
      "planning-artifacts",
      "stories",
      "2-1-state-mutating-no-integration.md",
    );
    const original = await fs.readFile(storyPath, "utf8");
    // Insert before "## Dev Notes" to stay within the Acceptance Criteria section.
    const fixed = original.replace(
      "## Dev Notes",
      "**AC2 (integration):**\n**Given** the tool runs,\n**When** the manifest is written,\n**Then** the blocked/ manifest is created and verifiable end-to-end.\n\n## Dev Notes",
    );
    await fs.writeFile(storyPath, fixed, "utf8");

    // Second scan — validator re-runs (source hash changed), story now passes.
    const result2 = await scanSources({ targetRepoRoot: disciplineScratch });

    // Story should now be in createdRefs (promoted to to-do/).
    expect(result2.createdRefs).toContain("bmad:2.1");
    expect(result2.blockedRefs).not.toContain("bmad:2.1");
    expect(result2.skippedRefs.some((s) => s.ref === "bmad:2.1")).toBe(false);

    // Blocked manifest must be deleted; to-do/ manifest must now exist.
    await expect(fs.stat(blockedPath)).rejects.toThrow();
    const raw = await fs.readFile(toDoPath, "utf8");
    const manifest = yamlParse(raw) as Record<string, unknown>;
    expect(manifest["status"]).toBe("to-do");
    expect(manifest["ref"]).toBe("bmad:2.1");
  });
});
