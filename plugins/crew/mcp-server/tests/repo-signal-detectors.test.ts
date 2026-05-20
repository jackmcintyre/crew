/**
 * Story 2.4 Task 2.2 — unit tests for the pure repo-signal helpers.
 *
 * See `plugins/crew/docs/user-surface-acs.md` for the user-surface AC
 * rubric. These helpers are internal — no user-surface coverage here.
 */
import { describe, expect, it } from "vitest";
import {
  detectDependencyManifests,
  detectLanguagesFromLayout,
  truncateReadmeExcerpt,
} from "../src/lib/repo-signal-detectors.js";

describe("detectLanguagesFromLayout", () => {
  it("TS-only layout returns sorted [Markdown, TypeScript]", () => {
    const langs = detectLanguagesFromLayout([
      "package.json",
      "tsconfig.json",
      "README.md",
    ]);
    expect(langs).toEqual(["Markdown", "TypeScript"]);
  });

  it("Python layout with pyproject.toml returns [Python]", () => {
    expect(detectLanguagesFromLayout(["pyproject.toml", "src"])).toEqual([
      "Python",
    ]);
  });

  it("mixed layout returns sorted union", () => {
    const langs = detectLanguagesFromLayout([
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "README.md",
    ]);
    expect(langs).toEqual(["Markdown", "Python", "Rust", "TypeScript"]);
  });

  it("empty entries returns []", () => {
    expect(detectLanguagesFromLayout([])).toEqual([]);
  });
});

describe("detectDependencyManifests", () => {
  it("returns intersection with canonical manifest filenames, sorted", () => {
    expect(
      detectDependencyManifests([
        "src",
        "package.json",
        "pyproject.toml",
        "README.md",
      ]),
    ).toEqual(["package.json", "pyproject.toml"]);
  });

  it("empty input returns []", () => {
    expect(detectDependencyManifests([])).toEqual([]);
  });
});

describe("truncateReadmeExcerpt", () => {
  it("truncates long input to 501 chars ending in '…'", () => {
    const out = truncateReadmeExcerpt("a".repeat(600));
    expect(out.length).toBe(501);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns short input unchanged", () => {
    expect(truncateReadmeExcerpt("short")).toBe("short");
  });

  it("trims trailing whitespace before truncation check", () => {
    expect(truncateReadmeExcerpt("hello   \n\n")).toBe("hello");
  });
});
