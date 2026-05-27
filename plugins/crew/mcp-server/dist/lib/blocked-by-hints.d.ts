/**
 * `BLOCKED_BY_HINTS` — Story 5.13, AC3.
 *
 * A single exported lookup table mapping every `BlockedBy` enum member to a
 * per-case operator hint. The hint text is the deterministic seam (per project
 * memory `feedback_default_to_deterministic_seams`) — it lives here, not in
 * SKILL.md prose, so the skill can reference the tool-written artefact's return
 * shape verbatim.
 *
 * Hint format: `[<member>] {ref} — <operator action>`
 * where `{ref}` is a literal placeholder the caller substitutes at render time.
 *
 * The thirteen members are the closed v1 enum defined in `execution-manifest.ts`
 * § AC2. Any new block reason requires a deliberate schema-change story.
 */
import type { BlockedBy } from "../schemas/execution-manifest.js";
export type { BlockedBy };
/**
 * Per-case operator hints for every `BlockedBy` enum member.
 *
 * `{ref}` is a literal placeholder — callers should replace it with the actual
 * story ref before displaying the hint to the operator.
 */
export declare const BLOCKED_BY_HINTS: Readonly<Record<BlockedBy, string>>;
/**
 * Render the per-case operator hint for a blocked manifest, substituting
 * the actual `ref` string for the `{ref}` placeholder.
 *
 * Returns the verbatim hint string with `{ref}` replaced by `ref`.
 * Called by `/crew:start`'s blocked-recovery surface.
 */
export declare function renderBlockedRecoveryHint(blockedBy: BlockedBy, ref: string): string;
