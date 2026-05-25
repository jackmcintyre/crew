import { AmbiguousBmadRefError, MalformedBmadStoryError, UnknownBmadRefError } from "../../errors.js";
import type { PlanningAdapter, SourceStory } from "../adapter.js";
import { parseBmadStory } from "./parse-bmad-story.js";
import { mapBmadStatusToExecution, reconcileStatus, type BmadStatus, type ExecutionState, type ReconciliationOutcome } from "./map-bmad-status.js";
type BmadContext = {
    targetRepo: string;
    storiesRoot: string;
};
/**
 * Configure the bound `(targetRepo, storiesRoot)` context the adapter's
 * list/read/resolve methods operate against. Called by the runtime
 * (Story 3.1's `getActiveAdapter()`) and by tests.
 */
export declare function configureBmadAdapter(ctx: BmadContext): void;
/** Reset the bound context — primarily for test cleanup. */
export declare function resetBmadAdapter(): void;
export declare const BmadAdapter: PlanningAdapter;
/**
 * Story 3.9 Task 1+2+4: per-file resilient list. Returns successful
 * parses alongside metadata for files that:
 *   - skipped at directory walk because Status is done/optional
 *     (Task 4 — bundled with this story);
 *   - fell back to LLM extraction after the regex parser threw
 *     (Task 2 — the load-bearing change);
 *   - failed both regex and LLM extraction and need routing to
 *     `blocked/<ref>.yaml` with `blocked_by: "unparseable"` (Task 1).
 *
 * `scan-sources` consumes this richer result; the canonical
 * `listSourceStories()` exported on the adapter interface keeps its
 * narrow contract (returns only successful stories) and is implemented
 * in terms of this helper.
 *
 * @see _bmad-output/implementation-artifacts/3-9-bmad-adapter-llm-fallback-extraction.md
 */
export type UnparseableEntry = {
    /** Absolute path to the source file. */
    path: string;
    /** Best-effort ref guess derived from the filename, or null. */
    refGuess: string | null;
    /** The original regex-parse error message. */
    regexError: string;
    /** The LLM extraction error message, when the fallback also failed. */
    llmError?: string;
};
export type ResilientListResult = {
    stories: SourceStory[];
    /** Refs of stories produced by the LLM-fallback path (audit trail). */
    extractedByLlm: string[];
    /** Files that failed both parsing paths (route to `blocked/`). */
    unparseable: UnparseableEntry[];
    /**
     * Number of skipped files at the directory walk (status done/optional).
     * Audit-only — these files are not blocked or failed; they simply do
     * not produce a manifest.
     */
    skippedDone: number;
};
export declare function listSourceStoriesResilient(options?: {
    extractOptionsOverride?: {
        client?: unknown;
        primaryModel?: string;
        retryModel?: string;
    };
}): Promise<ResilientListResult>;
export { parseBmadStory, mapBmadStatusToExecution, reconcileStatus, MalformedBmadStoryError, UnknownBmadRefError, AmbiguousBmadRefError, };
export type { BmadStatus, ExecutionState, ReconciliationOutcome };
