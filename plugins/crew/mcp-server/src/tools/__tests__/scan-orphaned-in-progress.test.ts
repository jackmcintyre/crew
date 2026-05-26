/**
 * Unit tests for `scanOrphanedInProgress` — Story 5.11 Task 1.5.
 *
 * Covers:
 *   (a) No in-progress/ directory → empty array.
 *   (b) Empty in-progress/ directory → empty array.
 *   (c) Current-session manifest only → empty array (5e fixture).
 *   (d) One stale-ULID manifest with transcript → one orphan with hasTranscript: true.
 *   (e) One stale-ULID manifest without transcript → hasTranscript: false.
 *   (f) Two stale-ULID manifests → returned in alphabetical ref order (5d fixture).
 *   (g) Absent claimed_by → skipped silently.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { scanOrphanedInProgress } from "../scan-orphaned-in-progress.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_SESSION_ULID = "01JVWX2CURRENT0000000001AA";
const STALE_ULID_A = "01JVWX2STALE0000000000001A";
const STALE_ULID_B = "01JVWX2STALE0000000000002B";
const SOURCE_HASH = "a".repeat(64);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifestYaml(
  ref: string,
  opts: { claimed_by?: string; omitClaimedBy?: boolean } = {},
): string {
  const manifest: Record<string, unknown> = {
    ref,
    status: "in-progress",
    adapter: "native",
    source_path: `.crew/native-stories/${ref.replace("native:", "")}.md`,
    source_hash: SOURCE_HASH,
    depends_on: [],
    acceptance_criteria: [
      { text: "Given AC, when done, then works.", kind: "integration" },
    ],
    title: "Test story",
    narrative: "As a dev, I want to test orphan scan.",
    withdrawn: false,
  };
  if (!opts.omitClaimedBy) {
    manifest["claimed_by"] = opts.claimed_by ?? CURRENT_SESSION_ULID;
  }
  return yamlStringify(manifest, { lineWidth: 0 });
}

async function seedInProgressManifest(
  stateRoot: string,
  ref: string,
  opts?: { claimed_by?: string; omitClaimedBy?: boolean },
): Promise<string> {
  const dir = path.join(stateRoot, "in-progress");
  await fs.mkdir(dir, { recursive: true });
  const absPath = path.join(dir, `${ref}.yaml`);
  await fs.writeFile(absPath, makeManifestYaml(ref, opts), "utf8");
  return absPath;
}

async function seedTranscriptFile(
  stateRoot: string,
  sessionUlid: string,
  content = "dev transcript content\nHandoff to reviewer — story x ready for review.",
): Promise<string> {
  const transcriptPath = path.join(
    stateRoot,
    "sessions",
    sessionUlid,
    "dev-transcript.txt",
  );
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.writeFile(transcriptPath, content, "utf8");
  return transcriptPath;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let stateRoot: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crew-5-11-scan-"));
  stateRoot = path.join(tmpDir, ".crew", "state");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (a) No in-progress/ directory → empty array
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — no in-progress directory", () => {
  it("returns empty orphans array when in-progress/ does not exist", async () => {
    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });
    expect(result.orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Empty in-progress/ → empty array
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — empty in-progress directory", () => {
  it("returns empty orphans array when in-progress/ is empty", async () => {
    await fs.mkdir(path.join(stateRoot, "in-progress"), { recursive: true });
    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });
    expect(result.orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) Current-session manifest only → empty array (5e fixture)
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — current-session manifest (5e fixture)", () => {
  it("returns empty array when in-progress/ has only the current session's manifest", async () => {
    const ref = "native:01JVWX2CURRENT0000000001";
    await seedInProgressManifest(stateRoot, ref, { claimed_by: CURRENT_SESSION_ULID });

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });
    expect(result.orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) One stale-ULID manifest with transcript → hasTranscript: true
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — stale manifest with transcript", () => {
  it("returns one orphan with hasTranscript: true when transcript exists", async () => {
    const ref = "native:01JVWX2STALE0000000000001";
    await seedInProgressManifest(stateRoot, ref, { claimed_by: STALE_ULID_A });
    await seedTranscriptFile(stateRoot, STALE_ULID_A);

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });

    expect(result.orphans).toHaveLength(1);
    const orphan = result.orphans[0]!;
    expect(orphan.ref).toBe(ref);
    expect(orphan.staleUlid).toBe(STALE_ULID_A);
    expect(orphan.hasTranscript).toBe(true);
    expect(orphan.manifestPath).toContain(`in-progress/${ref}.yaml`);
    expect(orphan.transcriptPath).toContain(
      path.join("sessions", STALE_ULID_A, "dev-transcript.txt"),
    );
  });
});

// ---------------------------------------------------------------------------
// (e) One stale-ULID manifest without transcript → hasTranscript: false
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — stale manifest without transcript", () => {
  it("returns one orphan with hasTranscript: false when no transcript exists", async () => {
    const ref = "native:01JVWX2STALE0000000000002";
    await seedInProgressManifest(stateRoot, ref, { claimed_by: STALE_ULID_A });
    // No transcript file seeded.

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });

    expect(result.orphans).toHaveLength(1);
    const orphan = result.orphans[0]!;
    expect(orphan.ref).toBe(ref);
    expect(orphan.staleUlid).toBe(STALE_ULID_A);
    expect(orphan.hasTranscript).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) Two stale-ULID manifests → alphabetical order (5d fixture)
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — alphabetical ordering (5d fixture)", () => {
  it("returns two orphans in alphabetical ref order", async () => {
    const refA = "native:01JVWX2A-FIRST00000000001";
    const refB = "native:01JVWX2B-SECOND0000000001";
    // Seed in reverse order to test sorting.
    await seedInProgressManifest(stateRoot, refB, { claimed_by: STALE_ULID_B });
    await seedInProgressManifest(stateRoot, refA, { claimed_by: STALE_ULID_A });

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });

    expect(result.orphans).toHaveLength(2);
    // Should be in alphabetical order by ref (filename).
    expect(result.orphans[0]!.ref).toBe(refA);
    expect(result.orphans[1]!.ref).toBe(refB);
  });
});

// ---------------------------------------------------------------------------
// (g) Absent claimed_by → skipped silently
// ---------------------------------------------------------------------------

describe("scanOrphanedInProgress — absent claimed_by skipped silently", () => {
  it("silently skips manifests with no claimed_by field", async () => {
    const ref = "native:01JVWX2MALFORMED00000001A";
    await seedInProgressManifest(stateRoot, ref, { omitClaimedBy: true });

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });

    expect(result.orphans).toEqual([]);
  });

  it("returns other orphans when mixed with a malformed manifest", async () => {
    const refMalformed = "native:01JVWX2MALFORMED00000001B";
    const refOrphan = "native:01JVWX2ORPHAN000000000001";
    await seedInProgressManifest(stateRoot, refMalformed, { omitClaimedBy: true });
    await seedInProgressManifest(stateRoot, refOrphan, { claimed_by: STALE_ULID_A });

    const result = await scanOrphanedInProgress({
      targetRepoRoot: tmpDir,
      sessionUlid: CURRENT_SESSION_ULID,
    });

    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]!.ref).toBe(refOrphan);
  });
});
