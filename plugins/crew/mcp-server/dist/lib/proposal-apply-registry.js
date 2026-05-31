/**
 * Proposal apply-handler registry — Story 6.4 (the `/accept-proposal` gate's
 * dispatch seam).
 *
 * The `acceptProposal` gate is **kind-agnostic**: it never reads kind-specific
 * proposal fields. It locates a proposal by id, asks the registered handler for
 * the proposal's `type` to render a diff (preview) or apply the change
 * (confirm), commits the handler's changed paths together with the proposal
 * stamp, and records telemetry. All kind-specific behaviour lives behind this
 * handler interface.
 *
 * **This story ships ONLY the gate machinery.** The production registry is
 * deliberately EMPTY — every kind fails closed via
 * `ProposalKindNotApplicableYetError` (AC6). The real handlers are registered
 * by later stories:
 *
 *   - `rule` / `rule-retirement`                      → Story 6.5
 *   - `skill-create` / `skill-revise` /
 *     `skill-supersede` / `skill-retire`              → Story 6.7
 *   - `team-change`                                   → Story 6.10
 *   - persona-append (when 6.9 routes through here)   → Story 6.9
 *
 * The gate is proven end-to-end in tests with a **test-injected fake handler**,
 * mirroring the `execaImpl` injection pattern used by the git wrapper: the tool
 * takes an optional `handlers` injection (defaulting to the empty production
 * registry); tests pass a fake handler, production passes nothing.
 *
 * (Story 6.4 — FR61, Architecture §Skill calibration loop)
 */
/**
 * The PRODUCTION registry — empty in Story 6.4 by design (AC6). Later stories
 * register their handlers into this map. The gate defaults to this registry
 * when no `handlers` injection is provided.
 *
 * It is intentionally a fresh empty map (not a shared mutable singleton) per
 * import so a test that mutates a registry never leaks into production.
 */
export function createProductionRegistry() {
    return new Map();
}
/**
 * Maps each proposal kind to the story that will ship its apply handler. Used
 * to build an actionable `ProposalKindNotApplicableYetError` message. Closed
 * over the seven retro-proposal kinds; a new kind would require a schema-change
 * story that also extends this map.
 */
export const KIND_TO_STORY = {
    rule: "Story 6.5",
    "rule-retirement": "Story 6.5",
    "skill-create": "Story 6.7",
    "skill-revise": "Story 6.7",
    "skill-supersede": "Story 6.7",
    "skill-retire": "Story 6.7",
    "team-change": "Story 6.10",
};
