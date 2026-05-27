#!/usr/bin/env node
/**
 * Post-build normaliser for `dist/**\/*.d.ts` — Story 5.24.
 *
 * **Why this exists.** Zod 4's `z.enum([...])` typing flows through
 * `util.ToEnum<T[number]>`, which is a mapped type
 * `{ [k in T[number]]: k }` keyed by a string-literal union. When
 * TypeScript elaborates that mapped type into a concrete object in `.d.ts`
 * emit, the property order follows the union's *canonical* iteration order,
 * not the source array order. The canonical order is decided by an internal
 * per-process type cache and depends on which file referenced each literal
 * first during type-checking. Across clean rebuilds, unrelated source edits
 * can flip the cache, producing cosmetic key-order churn (e.g.
 * `"medium" | "low"` ↔ `"low" | "medium"`). Runtime is unchanged but the
 * working-tree-clean invariant from `pre-dogfood-hygiene.md` breaks.
 *
 * **What this does.** Walks every `.d.ts` under `dist/`, finds every
 * `ZodEnum<{ ... }>` block, and sorts the inner `key: value;` lines
 * alphabetically. Line-based, no AST parser — the surface is fixed and
 * trivial.
 *
 * **Why post-build instead of pinning Zod or rewriting schemas.** The
 * non-determinism is in TypeScript's union canonicalisation, not in Zod's
 * runtime or the source array order. Pinning the Zod version doesn't help;
 * neither does swapping `z.enum([...])` for explicit-shape constructors,
 * because both flow through the same `ToEnum` mapped type. A post-build sort
 * is the smallest seam that yields byte-stable output across rebuilds.
 *
 * Written as plain JS (not TS) to avoid a chicken-and-egg with the very
 * `tsc` step it post-processes, and to dodge a runtime dependency on `tsx`.
 *
 * Invoked from the package's `build` script after `tsc`.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * Walk a directory tree, returning absolute paths of every `.d.ts` file.
 * Entries are visited in sorted order for determinism (defence in depth — the
 * file rewriting is order-independent, but a deterministic walk makes the
 * verbose log reproducible).
 *
 * @param {string} root - Absolute path to start walking from.
 * @returns {string[]}
 */
function walkDts(root) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    entries.sort();
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && full.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Matches the opening of a `ZodEnum<{` block at end-of-line. Tolerant of the
 * `z.` namespace prefix and of arbitrary wrapping (`ZodOptional<z.ZodEnum<{`,
 * `ZodArray<z.ZodEnum<{`, etc.) — we only need to know that the next lines
 * are enum members until the closing `}`.
 */
const ZOD_ENUM_OPEN = /\bZodEnum<\{\s*$/;

/**
 * Normalise the contents of one `.d.ts` file by alphabetising the members of
 * every `ZodEnum<{ ... }>` block.
 *
 * Algorithm: scan lines. When a line ends with `ZodEnum<{`, capture
 * subsequent lines into a buffer until we hit a line whose first non-whitespace
 * char is `}` — that's the block close. Sort the buffer by the property key
 * (text before the first `:`, quotes stripped), then emit it back. The close
 * line is left as-is.
 *
 * Nested `ZodEnum<{...}>` inside another enum's value position cannot occur
 * (enum values are string literals, not nested types), so a flat scan is
 * sufficient.
 *
 * @param {string} source
 * @returns {string} Normalised content (may be byte-identical to input).
 */
export function normaliseDts(source) {
  const lines = source.split("\n");
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    if (ZOD_ENUM_OPEN.test(line)) {
      /** @type {string[]} */
      const members = [];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j];
        if (/^\s*\}/.test(m)) {
          break;
        }
        members.push(m);
        j += 1;
      }
      members.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
      for (const m of members) {
        out.push(m);
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join("\n");
}

/**
 * Extract the property key from a single member line of a `ZodEnum<{...}>`
 * block. Member lines look like `        "dep-bump": "dep-bump";` or
 * `        revert: "revert";`. We return the bare key (quotes stripped) for
 * `localeCompare`-based sorting.
 *
 * @param {string} line
 * @returns {string}
 */
function keyOf(line) {
  const trimmed = line.replace(/^\s+/, "");
  const colonAt = trimmed.indexOf(":");
  if (colonAt < 0) {
    return trimmed;
  }
  let key = trimmed.slice(0, colonAt).trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  return key;
}

/**
 * Entry point — walk the target `dist/` and rewrite each changed `.d.ts` in
 * place. Accepts an optional first CLI argument to override the target dir
 * (used by `tests/build-determinism.test.ts` to normalise a tsc temp build
 * without touching the real `dist/`); defaults to `../dist` relative to
 * this script.
 */
function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  // `scripts/` sits next to `dist/`, both under `mcp-server/`.
  const argDir = process.argv[2];
  const distDir = argDir ? resolve(argDir) : resolve(here, "..", "dist");
  const files = walkDts(distDir);
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = normaliseDts(before);
    if (before !== after) {
      writeFileSync(file, after);
      changed += 1;
    }
  }
  if (process.env.NORMALISE_DIST_VERBOSE) {
    process.stdout.write(`normalise-dist: ${changed}/${files.length} files rewritten\n`);
  }
}

// Run when invoked directly (i.e. `node scripts/normalise-dist.mjs`).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
