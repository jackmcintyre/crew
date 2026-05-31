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
 * **Story 6.4 shipped the gate machinery with an EMPTY production registry.**
 * Each kind's real handler is registered by its story; an unregistered kind
 * still fails closed via `ProposalKindNotApplicableYetError` (AC6). Status:
 *
 *   - `skill-create` / `skill-revise` /
 *     `skill-supersede` / `skill-retire`              → Story 6.7 (REGISTERED)
 *   - `rule` / `rule-retirement`                      → Story 6.5
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
import { createSkillProposalHandlers } from "./apply-skill-proposal.js";
/**
 * The PRODUCTION registry. The gate defaults to this registry when no
 * `handlers` injection is provided.
 *
 * Registered handlers:
 *   - `skill-create` / `skill-revise` /
 *     `skill-supersede` / `skill-retire`              → Story 6.7
 *
 * Still fail closed (no handler) until their story registers them:
 *   - `rule` / `rule-retirement`                      → Story 6.5
 *   - `team-change`                                   → Story 6.10
 *   - persona-append (when 6.9 routes through here)   → Story 6.9
 *
 * It is intentionally a fresh map (not a shared mutable singleton) per import so
 * a test that mutates a registry never leaks into production. The `skill-*`
 * handlers use the default `Date` clock; tests that need a deterministic
 * `introduced_at` / `retired_at` build their own registry from
 * `createSkillProposalHandlers({ now })` and inject it.
 */
export function createProductionRegistry() {
    const registry = new Map();
    for (const handler of createSkillProposalHandlers()) {
        registry.set(handler.type, handler);
    }
    return registry;
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
