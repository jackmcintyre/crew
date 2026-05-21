/**
 * Integration tests for the `NativeAdapter` (Story 3.4 Task 6.3).
 *
 * Exercises `detect`, `listSourceStories`, `readSourceStory`, and
 * `resolveSourcePath` against the fixture target repo at
 * `src/adapters/native/fixtures/`.
 *
 * Mirrors the structure of `bmad-adapter.test.ts` (Story 3.3).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NativeAdapter,
  configureNativeAdapter,
  resetNativeAdapter,
} from "../src/adapters/native/index.js";
import { MalformedNativeStoryError } from "../src/errors.js";
import { parseNativeStory } from "../src/adapters/native/parse-native-story.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.join(HERE, "..", "src", "adapters", "native", "fixtures");

afterEach(() => {
  resetNativeAdapter();
});

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

describe("NativeAdapter.detect()", () => {
  it("returns true for the fixture repo (has ULID .md files under .crew/native-stories/)", async () => {
    expect(await NativeAdapter.detect(FIXTURE_REPO)).toBe(true);
  });

  it("returns false for an empty temp repo", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "native-detect-empty-"));
    try {
      expect(await NativeAdapter.detect(tmp)).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns false when the directory exists but has no ULID .md files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "native-detect-nofiles-"));
    try {
      await fs.mkdir(path.join(tmp, ".crew", "native-stories"), { recursive: true });
      // Write a non-ULID file — should not match.
      await fs.writeFile(path.join(tmp, ".crew", "native-stories", "README.md"), "# ignore\n");
      expect(await NativeAdapter.detect(tmp)).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns true when exactly one ULID .md file is present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "native-detect-one-"));
    try {
      const dir = path.join(tmp, ".crew", "native-stories");
      await fs.mkdir(dir, { recursive: true });
      await fs.cp(
        path.join(FIXTURE_REPO, ".crew", "native-stories", "01JX9000000000000000000001.md"),
        path.join(dir, "01JX9000000000000000000001.md"),
      );
      expect(await NativeAdapter.detect(tmp)).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// listSourceStories()
// ---------------------------------------------------------------------------

describe("NativeAdapter.listSourceStories()", () => {
  beforeEach(() => {
    configureNativeAdapter({ targetRepo: FIXTURE_REPO });
  });

  it("returns a SourceStory for each ULID .md file in the fixture repo", async () => {
    const stories = await NativeAdapter.listSourceStories();
    expect(stories).toHaveLength(2);
  });

  it("stories are sorted lexicographically by ref (ULID order = insertion order)", async () => {
    const stories = await NativeAdapter.listSourceStories();
    const refs = stories.map((s) => s.ref);
    expect(refs).toEqual(["native:01JX9000000000000000000001", "native:01JX9000000000000000000002"]);
  });

  it("story refs follow 'native:<ULID>' shape", async () => {
    const stories = await NativeAdapter.listSourceStories();
    for (const s of stories) {
      expect(s.ref).toMatch(/^native:[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it("the second fixture story declares a depends_on ref to the first", async () => {
    const stories = await NativeAdapter.listSourceStories();
    const second = stories.find((s) => s.ref === "native:01JX9000000000000000000002");
    expect(second).toBeDefined();
    expect(second!.depends_on).toContain("native:01JX9000000000000000000001");
  });

  it("produced SourceStory has the key set required by the PlanningAdapter contract", async () => {
    const stories = await NativeAdapter.listSourceStories();
    const s = stories[0]!;
    expect(s).toHaveProperty("ref");
    expect(s).toHaveProperty("title");
    expect(s).toHaveProperty("narrative");
    expect(s).toHaveProperty("acceptance_criteria");
    expect(s).toHaveProperty("depends_on");
    expect(s).toHaveProperty("raw_path");
    expect(s).toHaveProperty("raw_frontmatter");
    expect(s).toHaveProperty("source_hash");
  });

  it("source_hash is a 64-char hex string", async () => {
    const stories = await NativeAdapter.listSourceStories();
    for (const s of stories) {
      expect(s.source_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("silently skips non-ULID files in the stories directory", async () => {
    // Create a scratch copy of the fixture with an extra non-ULID file.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "native-list-skip-"));
    try {
      await fs.cp(FIXTURE_REPO, tmp, { recursive: true });
      await fs.writeFile(path.join(tmp, ".crew", "native-stories", "not-a-ulid.md"), "# ignore\n");
      configureNativeAdapter({ targetRepo: tmp });
      const stories = await NativeAdapter.listSourceStories();
      // Should still be exactly 2 — the non-ULID file is skipped.
      expect(stories).toHaveLength(2);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// readSourceStory()
// ---------------------------------------------------------------------------

describe("NativeAdapter.readSourceStory()", () => {
  beforeEach(() => {
    configureNativeAdapter({ targetRepo: FIXTURE_REPO });
  });

  it("reads story 01JX9000000000000000000001 by ref", async () => {
    const s = await NativeAdapter.readSourceStory("native:01JX9000000000000000000001");
    expect(s.ref).toBe("native:01JX9000000000000000000001");
    expect(s.title).toBe("Add user authentication");
  });

  it("reads story 01JX9000000000000000000002 by ref", async () => {
    const s = await NativeAdapter.readSourceStory("native:01JX9000000000000000000002");
    expect(s.ref).toBe("native:01JX9000000000000000000002");
    expect(s.title).toBe("Show user profile page");
  });

  it("throws on an invalid ref shape", async () => {
    await expect(NativeAdapter.readSourceStory("bmad:1.1")).rejects.toThrow(
      "not a valid native ref",
    );
  });

  it("throws when the ULID file does not exist", async () => {
    await expect(
      NativeAdapter.readSourceStory("native:01JX9ZZZZZZZZZZZZZZZZZZZZZZ"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveSourcePath()
// ---------------------------------------------------------------------------

describe("NativeAdapter.resolveSourcePath()", () => {
  beforeEach(() => {
    configureNativeAdapter({ targetRepo: FIXTURE_REPO });
  });

  it("returns the absolute path for a valid native ref", () => {
    const p = NativeAdapter.resolveSourcePath("native:01JX9000000000000000000001");
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toContain("01JX9000000000000000000001.md");
    expect(p).toContain(path.join(".crew", "native-stories"));
  });

  it("is a pure function — returns the path even for a non-existent ULID", () => {
    // A 26-char Crockford base32 string that doesn't exist on disk.
    const p = NativeAdapter.resolveSourcePath("native:01JX9000000000000000000099");
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toContain("01JX9000000000000000000099.md");
  });

  it("throws on an invalid ref shape", () => {
    expect(() => NativeAdapter.resolveSourcePath("not-a-ref")).toThrow(
      "not a valid native ref",
    );
  });
});

// ---------------------------------------------------------------------------
// parseNativeStory() error paths
// ---------------------------------------------------------------------------

describe("parseNativeStory() — error paths", () => {
  const fakeUlid = "01JX9000000000000000000001";
  const fakePath = `/tmp/${fakeUlid}.md`;

  it("throws MalformedNativeStoryError when H1 is missing", () => {
    expect(() => parseNativeStory(fakePath, "## Narrative\n\nSome text\n")).toThrow(
      MalformedNativeStoryError,
    );
  });

  it("throws MalformedNativeStoryError when ## Narrative is missing", () => {
    const body = `# My Story\n\n## Acceptance Criteria\n\n**AC1:**\n**Given** x **When** y **Then** z\n\n## Dependencies\n`;
    expect(() => parseNativeStory(fakePath, body)).toThrow(MalformedNativeStoryError);
  });

  it("throws MalformedNativeStoryError when ## Acceptance Criteria is missing", () => {
    const body = `# My Story\n\n## Narrative\n\nAs a user I want something.\n\n## Dependencies\n`;
    expect(() => parseNativeStory(fakePath, body)).toThrow(MalformedNativeStoryError);
  });

  it("throws MalformedNativeStoryError when no parseable ACs are found", () => {
    const body = `# My Story\n\n## Narrative\n\nAs a user.\n\n## Acceptance Criteria\n\nNo AC blocks here.\n\n## Dependencies\n`;
    expect(() => parseNativeStory(fakePath, body)).toThrow(MalformedNativeStoryError);
  });

  it("throws MalformedNativeStoryError when an AC has no Given/When/Then", () => {
    const body =
      `# My Story\n\n## Narrative\n\nAs a user.\n\n## Acceptance Criteria\n\n` +
      `**AC1:**\nThis AC has no GWT structure.\n\n## Dependencies\n`;
    expect(() => parseNativeStory(fakePath, body)).toThrow(MalformedNativeStoryError);
  });

  it("throws MalformedNativeStoryError for a malformed dependency ref", () => {
    const body =
      `# My Story\n\n## Narrative\n\nAs a user.\n\n## Acceptance Criteria\n\n` +
      `**AC1:**\n**Given** x **When** y **Then** z.\n\n## Dependencies\n\n- not-a-valid-ref\n`;
    expect(() => parseNativeStory(fakePath, body)).toThrow(MalformedNativeStoryError);
  });

  it("throws MalformedNativeStoryError when the filename is not a ULID", () => {
    const badPath = "/tmp/not-a-ulid.md";
    const body =
      `# My Story\n\n## Narrative\n\nAs a user.\n\n## Acceptance Criteria\n\n` +
      `**AC1:**\n**Given** x **When** y **Then** z.\n\n## Dependencies\n`;
    expect(() => parseNativeStory(badPath, body)).toThrow(MalformedNativeStoryError);
  });
});

// ---------------------------------------------------------------------------
// NativeAdapter static config
// ---------------------------------------------------------------------------

describe("NativeAdapter static config", () => {
  it("name is 'native'", () => {
    expect(NativeAdapter.name).toBe("native");
  });

  it("defaultConfig() returns empty object", () => {
    expect(NativeAdapter.defaultConfig()).toEqual({});
  });

  it("adapterConfigSchema accepts empty object", () => {
    expect(() => NativeAdapter.adapterConfigSchema.parse({})).not.toThrow();
  });

  it("adapterConfigSchema rejects unknown keys", () => {
    expect(() =>
      NativeAdapter.adapterConfigSchema.parse({ unexpected: true }),
    ).toThrow();
  });

  it("validateAgainstDiscipline is a pass-through (Story 3.5 stub)", () => {
    configureNativeAdapter({ targetRepo: FIXTURE_REPO });
    const story = {
      ref: "native:01JX9000000000000000000001",
      title: "Test",
      narrative: "As a user.",
      acceptance_criteria: [{ text: "**Given** x **When** y **Then** z.", kind: "unit" as const }],
      depends_on: [],
      raw_path: "/tmp/01JX9000000000000000000001.md",
      raw_frontmatter: {},
      source_hash: "a".repeat(64),
    };
    expect(NativeAdapter.validateAgainstDiscipline(story)).toBe(story);
  });
});
