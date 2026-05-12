import { promises as fs } from "node:fs";
import * as YAML from "yaml";
import { SprintStatus, type Story } from "./schema.js";
import { StateNotFoundError, StateParseError, StoryNotFoundError } from "../lib/errors.js";
import { withLock } from "../lib/lock.js";

/**
 * Read sprint-status.yaml and validate against the zod schema.
 *
 * Unknown fields are preserved. Throws on missing file or invalid YAML/shape.
 *
 * @throws StateNotFoundError, StateParseError
 */
export async function readSprintStatus(path: string): Promise<SprintStatus> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new StateNotFoundError(path);
    throw new StateParseError(path, err);
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    throw new StateParseError(path, err);
  }
  const result = SprintStatus.safeParse(parsed);
  if (!result.success) throw new StateParseError(path, result.error);
  return result.data;
}

/**
 * Atomically write the sprint status back to disk, preserving comment-less
 * structure. Caller is responsible for holding the lock.
 */
export async function writeSprintStatus(path: string, value: SprintStatus): Promise<void> {
  const yaml = YAML.stringify(value, { lineWidth: 100 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, yaml, "utf8");
  await fs.rename(tmp, path);
}

/**
 * Read-modify-write helper. Acquires the file lock, reads, runs `mutator`
 * (which may return a Story update or new SprintStatus), writes if changed.
 *
 * @throws LockTimeoutError, StateNotFoundError, StateParseError
 */
export async function updateSprintStatus<T>(
  path: string,
  mutator: (current: SprintStatus) => Promise<{ next: SprintStatus; result: T }>,
): Promise<T> {
  return withLock(path, async () => {
    const current = await readSprintStatus(path);
    const { next, result } = await mutator(current);
    await writeSprintStatus(path, next);
    return result;
  });
}

export function findStory(state: SprintStatus, storyId: string): Story {
  const story = state.stories.find((s) => s.id === storyId);
  if (!story) throw new StoryNotFoundError(storyId);
  return story;
}

export function replaceStory(state: SprintStatus, updated: Story): SprintStatus {
  return {
    ...state,
    stories: state.stories.map((s) => (s.id === updated.id ? updated : s)),
  };
}
