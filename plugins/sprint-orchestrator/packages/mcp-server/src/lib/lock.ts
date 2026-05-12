import { lock as lockfileLock } from "proper-lockfile";
import { LockTimeoutError } from "./errors.js";

const LOCK_OPTIONS = {
  retries: { retries: 5, factor: 2, minTimeout: 50, maxTimeout: 1000 },
  realpath: false,
  stale: 10_000,
};

/**
 * Acquire an exclusive lock on `path`, run `fn`, then release.
 * Throws {@link LockTimeoutError} if the lock cannot be acquired.
 *
 * @throws LockTimeoutError
 */
export async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfileLock(path, LOCK_OPTIONS);
  } catch (_err) {
    throw new LockTimeoutError(path);
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}
