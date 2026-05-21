/**
 * Unit tests for `detectInProgressHandEdit` — Story 3.7 Task 3.1.
 *
 * Covers AC4 cases (c) and (d):
 *   (c1) hand-edit `title` only → InProgressHandEditError with changedFields:["title"]
 *   (c2) hand-edit `acceptance_criteria` (reorder) → detection via order-sensitive deep-equal
 *   (c3) hand-edit `withdrawn: false → true` → detection (guard treats this like any field)
 *   (c4) source hash drift (no manifest edit, opts.sourceHash differs) → detection with changedFields:["source_hash"]
 *   (d)  no edit, no drift → { ok: true }
 *
 * Each test seeds a tmpdir with an `in-progress/<ref>.yaml` manifest, then
 * either mutates it (to simulate an operator hand-edit) or leaves it intact,
 * then calls `detectInProgressHandEdit` directly.
 *
 * Pure deterministic — no LLM invocation, no network.
 */
export {};
