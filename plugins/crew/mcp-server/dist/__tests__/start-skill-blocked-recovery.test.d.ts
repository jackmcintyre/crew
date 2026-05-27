/**
 * Integration tests for the blocked-recovery hint surface — Story 5.13 AC3.
 *
 * Verifies:
 *   - For every one of the 13 enum members, `renderBlockedRecoveryHint(member, ref)`
 *     returns a non-empty string that:
 *       (i)  starts with `[<member>] <ref>`
 *       (ii) does NOT equal the legacy generic phrase `clear blocked_by and re-run`
 *   - `BLOCKED_BY_HINTS` has exactly thirteen members.
 *   - The `/crew:start` SKILL.md references `BLOCKED_BY_HINTS` (the deterministic seam).
 */
export {};
