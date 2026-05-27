/**
 * Story 5.24 AC3 — build-determinism regression check.
 *
 * Runs the package's full build pipeline (`tsc -p tsconfig.json --outDir
 * <tmp>` followed by `scripts/normalise-dist.mjs <tmp>`) twice into two
 * disposable temp directories, then asserts the resulting trees are
 * byte-identical. This is the regression guard for the `.d.ts` Zod-enum
 * key-order churn documented in 5.24 Dev Notes — if a future change to
 * `tsconfig`, the Zod version, or the normaliser breaks the invariant, this
 * test fails.
 *
 * **Design notes.**
 *
 *   1. We build into temp dirs (not the committed `dist/`) so the test runs
 *      cleanly alongside `dist-shipping.test.ts`, which compares the
 *      committed `dist/` against a fresh build and is sensitive to anyone
 *      removing or clobbering that directory.
 *
 *   2. We invoke `tsc` + `normalise-dist.mjs` directly rather than `pnpm
 *      build` because `pnpm build` writes to `dist/` (the package script
 *      doesn't accept an `--outDir` override).
 *
 *   3. Cost: ~3s per build, two builds plus IO ≈ 6-8s end-to-end. Well
 *      under the 30-60s budget from the story.
 */

import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(HERE, "..");
const NORMALISE_SCRIPT = resolve(SERVER_ROOT, "scripts/normalise-dist.mjs");

/**
 * Build the package into `outDir`. Mirrors the production `build` script:
 * `tsc -p tsconfig.json --outDir <out>` followed by the post-build
 * normaliser pointed at the same dir.
 */
async function buildInto(outDir: string): Promise<void> {
  await execa(
    "pnpm",
    ["exec", "tsc", "-p", "tsconfig.json", "--outDir", outDir],
    { cwd: SERVER_ROOT },
  );
  await execa("node", [NORMALISE_SCRIPT, outDir], { cwd: SERVER_ROOT });
}

/**
 * Walk `root` recursively and return a sorted list of `{ path, sha256 }`
 * entries for every regular file. Sort by relative path so the resulting
 * list is itself deterministic.
 */
async function hashTree(
  root: string,
): Promise<Array<{ path: string; hash: string }>> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile());
  const out: Array<{ path: string; hash: string }> = [];
  for (const e of files) {
    // Node's recursive readdir attaches `parentPath` (or older `path`) on each Dirent.
    const parent =
      (e as unknown as { parentPath?: string; path?: string }).parentPath ??
      (e as unknown as { path?: string }).path ??
      root;
    const full = join(parent, e.name);
    const rel = relative(root, full);
    const buf = await readFile(full);
    out.push({ path: rel, hash: createHash("sha256").update(buf).digest("hex") });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

describe("Story 5.24 — build-determinism", () => {
  it(
    "two consecutive clean builds produce byte-identical `dist/`",
    async () => {
      const dirA = await mkdtemp(join(tmpdir(), "crew-build-det-a-"));
      const dirB = await mkdtemp(join(tmpdir(), "crew-build-det-b-"));
      try {
        await buildInto(dirA);
        await buildInto(dirB);

        const [hashesA, hashesB] = await Promise.all([
          hashTree(dirA),
          hashTree(dirB),
        ]);

        // Same set of files.
        const pathsA = hashesA.map((h) => h.path);
        const pathsB = hashesB.map((h) => h.path);
        expect(pathsB).toEqual(pathsA);

        // Same content for every file. Collect drifted paths into a list
        // so the failure message names the offenders rather than dumping
        // a sea of hashes.
        const aMap = new Map(hashesA.map((h) => [h.path, h.hash]));
        const drifted: string[] = [];
        for (const { path, hash } of hashesB) {
          if (aMap.get(path) !== hash) {
            drifted.push(path);
          }
        }
        expect(
          drifted,
          drifted.length > 0
            ? `dist/ drift detected on ${drifted.length} file(s):\n  ${drifted.join("\n  ")}`
            : "",
        ).toEqual([]);
      } finally {
        await rm(dirA, { recursive: true, force: true });
        await rm(dirB, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
