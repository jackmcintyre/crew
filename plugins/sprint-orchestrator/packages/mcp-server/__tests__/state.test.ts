import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as YAML from "yaml";
import { readSprintStatus, writeSprintStatus, updateSprintStatus } from "../src/state/sprint-status.js";
import { StateNotFoundError, StateParseError, LockTimeoutError } from "../src/lib/errors.js";
import { baseSprint, makeTempProject } from "./fixtures.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(initial = baseSprint) {
  const tmp = await makeTempProject(initial);
  cleanups.push(tmp.cleanup);
  return tmp;
}

describe("state/sprint-status", () => {
  it("reads a valid file", async () => {
    const { ctx } = await setup();
    const state = await readSprintStatus(ctx.sprintStatusPath);
    expect(state.sprint_id).toBe("test-sprint-1");
    expect(state.stories.length).toBe(3);
  });

  it("throws StateNotFoundError for missing file", async () => {
    const { ctx } = await setup();
    await fs.rm(ctx.sprintStatusPath);
    await expect(readSprintStatus(ctx.sprintStatusPath)).rejects.toBeInstanceOf(StateNotFoundError);
  });

  it("throws StateParseError for corrupt YAML", async () => {
    const { ctx } = await setup();
    await fs.writeFile(ctx.sprintStatusPath, "::: not yaml :::\n  - [", "utf8");
    await expect(readSprintStatus(ctx.sprintStatusPath)).rejects.toBeInstanceOf(StateParseError);
  });

  it("throws StateParseError for shape that fails the zod schema", async () => {
    const { ctx } = await setup();
    await fs.writeFile(ctx.sprintStatusPath, YAML.stringify({ sprint_id: "x" }), "utf8");
    await expect(readSprintStatus(ctx.sprintStatusPath)).rejects.toBeInstanceOf(StateParseError);
  });

  it("preserves unknown top-level and story fields across a write", async () => {
    const enriched = {
      ...baseSprint,
      bmad_owned: "do not touch",
      stories: baseSprint.stories.map((s) =>
        s.id === "S1" ? { ...s, bmad_extra: { foo: "bar" } } : s,
      ),
    };
    const { ctx } = await setup(enriched as unknown as typeof baseSprint);
    const state = await readSprintStatus(ctx.sprintStatusPath);
    await writeSprintStatus(ctx.sprintStatusPath, state);
    const after = await readSprintStatus(ctx.sprintStatusPath);
    expect((after as unknown as { bmad_owned: string }).bmad_owned).toBe("do not touch");
    const s1 = after.stories.find((s) => s.id === "S1");
    expect((s1 as unknown as { bmad_extra: { foo: string } }).bmad_extra).toEqual({ foo: "bar" });
  });

  it("updateSprintStatus serialises concurrent writes via lock", async () => {
    const { ctx } = await setup();
    const observed: string[] = [];
    const op = (label: string) =>
      updateSprintStatus(ctx.sprintStatusPath, async (state) => {
        observed.push(`${label}:enter`);
        await new Promise((r) => setTimeout(r, 25));
        observed.push(`${label}:exit`);
        return { next: state, result: undefined };
      });
    await Promise.all([op("A"), op("B"), op("C")]);
    // No interleaving: every enter is immediately followed by its own exit.
    for (let i = 0; i < observed.length; i += 2) {
      const a = observed[i]!.split(":")[0];
      const b = observed[i + 1]!.split(":")[0];
      expect(a).toBe(b);
    }
  });

});

describe("LockTimeoutError", () => {
  it("carries the path it tried to lock", () => {
    const err = new LockTimeoutError("/tmp/foo");
    expect(err.code).toBe("LOCK_TIMEOUT");
    expect(err.details).toEqual({ path: "/tmp/foo" });
  });
});
