/**
 * Acceptance suite for Story 3.1 — PlanningAdapter interface and adapter registry.
 *
 * AC1: adapter.ts declares name, detect, listSourceStories, readSourceStory,
 *      resolveSourcePath, optional watchForChanges, and validateAgainstDiscipline.
 * AC2: registry reads adapter: from workspace config and returns matching adapter
 *      or throws UnknownAdapterError.
 * AC3: no adapter: key → detect() across all adapters; first-match or AmbiguousAdapterError.
 * AC4: vitest covers configured / detected / ambiguous branches via two stub adapters.
 */
export {};
