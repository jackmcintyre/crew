/**
 * `readBacklogInventory` MCP tool — Story 3.6 HIGH-1 fix.
 *
 * Builds the backlog inventory server-side so the `/crew:plan` skill does
 * not need to enumerate `.yaml` files itself via the `Read` tool (which
 * requires known paths and cannot glob). The skill declares
 * `allowed_tools: [Task, readBacklogInventory]` and delegates enumeration
 * to this tool.
 *
 * Returns the typed `BacklogInventory` JSON the planner skill prose
 * consumes, including:
 *   - `mode`: `"first-run"` | `"re-open"`
 *   - `backlog_inventory`: array of `{ ref, title, state, withdrawn }`
 *
 * `MalformedExecutionManifestError` (and any other `parseExecutionManifest`
 * typed errors) are surfaced verbatim — this resolves MEDIUM-1 as well.
 *
 * Architecture reference: Story 3.6 reviewer HIGH-1.
 */
import { z } from "zod";
import { type StateName } from "../state/manifest-state-machine.js";
export declare const ReadBacklogInventoryInputSchema: z.ZodObject<{
    targetRepoRoot: z.ZodString;
}, z.core.$strip>;
export type ReadBacklogInventoryInput = z.infer<typeof ReadBacklogInventoryInputSchema>;
/** State values for backlog inventory entries. Extends StateName with the native-source-only sentinel. */
export type InventoryState = StateName | "native-source-only";
/** A single entry in the backlog inventory. */
export interface BacklogInventoryEntry {
    ref: string;
    title: string;
    state: InventoryState;
    withdrawn: boolean;
}
/** Output shape returned by `readBacklogInventory`. */
export interface ReadBacklogInventoryOutput {
    /** `"first-run"` when the inventory is empty; `"re-open"` when at least one entry exists. */
    mode: "first-run" | "re-open";
    backlog_inventory: BacklogInventoryEntry[];
}
/**
 * Build the backlog inventory for the target repo.
 *
 * - Scans all four state directories (`to-do`, `in-progress`, `blocked`, `done`)
 *   for `.yaml` manifest files. Each is parsed via `parseExecutionManifest`
 *   (typed errors surface verbatim — not caught here).
 * - On the native-adapter branch only: also scans `.crew/native-stories/` for
 *   ULID-pattern `.md` files whose `native:<ULID>` ref does not already appear
 *   in the manifest inventory. Those entries get `state: "native-source-only"`,
 *   `withdrawn: false`, and `title` from the file's first H1.
 * - Derives `mode`: `"re-open"` if at least one entry exists, else `"first-run"`.
 *
 * @throws {MalformedExecutionManifestError} if any manifest fails schema validation.
 */
export declare function readBacklogInventory(rawInput: unknown): Promise<ReadBacklogInventoryOutput>;
