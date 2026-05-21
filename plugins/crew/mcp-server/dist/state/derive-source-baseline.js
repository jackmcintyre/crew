/**
 * `deriveSourceBaseline` — source-hash + source-fields derivation helper.
 *
 * Both `claimStory` and `completeStory` must supply a `{ sourceHash,
 * sourceFields }` pair to `detectInProgressHandEdit` before acting on any
 * manifest in `in-progress/`. This helper resolves the active adapter,
 * reads the current source story, and builds the canonical baseline that
 * `scan-sources` would write.
 *
 * Co-located with `manifest-state-machine.ts` because it serves the
 * state-machine layer — it is the FR14a baseline builder, not a tool.
 *
 * Story 4.1 — Task 5.
 */
import { resolveWorkspace } from "./workspace-resolver.js";
/**
 * Derive the canonical hand-edit baseline for a ref by reading the current
 * source story via the active adapter.
 *
 * The baseline mirrors what `scan-sources` would write: `sourceHash` comes
 * from `SourceStory.source_hash` (computed by the adapter from the raw bytes),
 * and `sourceFields` are the six operator-editable fields extracted from the
 * same `SourceStory`.
 *
 * **Edge case:** If the source story has been deleted from the planning tool
 * (BMad file removed; native file removed), `readSourceStory` throws (e.g.
 * `UnknownBmadRefError`). In that case this helper propagates the error —
 * `claimStory` and `completeStory` cannot proceed against a source-less ref.
 * The orchestrator will surface this as a state inconsistency.
 *
 * @param opts.targetRepoRoot - Absolute path to the target repository root.
 * @param opts.ref - Manifest ref (e.g. `"native:01HZ..."` or `"bmad:1.1"`).
 * @throws When the active adapter's `readSourceStory` fails (source deleted,
 *   workspace not resolved, etc.).
 */
export async function deriveSourceBaseline(opts) {
    const { targetRepoRoot, ref } = opts;
    const workspace = await resolveWorkspace({ targetRepoRoot });
    const sourceStory = await workspace.activeAdapter.readSourceStory(ref);
    const sourceFields = {
        title: sourceStory.title,
        narrative: sourceStory.narrative,
        acceptance_criteria: sourceStory.acceptance_criteria,
        implementation_notes: sourceStory.implementation_notes,
        depends_on: sourceStory.depends_on,
        withdrawn: false,
    };
    return {
        sourceHash: sourceStory.source_hash,
        sourceFields,
    };
}
