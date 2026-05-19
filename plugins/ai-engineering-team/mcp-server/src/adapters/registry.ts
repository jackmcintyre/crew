import { NotImplementedError } from "../errors.js";
import type { PlanningAdapter } from "./adapter.js";

/**
 * Registered planning adapters. Story 3.1 populates this list and
 * implements selection. Story 1.1 leaves it empty as a seam.
 */
export const adapters: PlanningAdapter[] = [];

/**
 * Resolve the active planning adapter for the current repo.
 *
 * Real implementation lands in Story 3.1.
 */
export function getActiveAdapter(): PlanningAdapter {
  throw new NotImplementedError("adapter registry: getActiveAdapter lands in Story 3.1");
}
