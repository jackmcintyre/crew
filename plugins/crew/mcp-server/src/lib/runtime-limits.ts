/**
 * Runtime limit constants for the crew plugin.
 *
 * These constants are the single source of truth for the hard caps declared
 * in PRD NFR2 (8-min reviewer cap) and NFR3 (30-min dev budget). They live
 * in this module so a future config-overlay story (post-4.12) can introduce
 * a `plugin.runtime_limits` block in `.crew/config.yaml` and replace reads
 * here with a config-aware loader, without touching any emission seam.
 *
 * Story 4.12 (FR65, NFR2, NFR3).
 */

/**
 * Hard wall-clock cap for the reviewer subagent (NFR2).
 * If a reviewer invocation's runtime exceeds this, `recordAgentInvoke`
 * substitutes the verdict comment, applies `needs-human`, and returns
 * `{ kind: "reviewer-timed-out" }`. Value: 8 minutes in milliseconds.
 */
export const REVIEWER_HARD_CAP_MS = 8 * 60 * 1000; // 480_000

/**
 * Per-story cumulative dev-subagent budget (NFR3).
 * When the running total of `agent.invoke` events for a given story crosses
 * this threshold, `recordAgentInvoke` emits a `dev.budget_exceeded` event
 * and returns `{ kind: "dev-budget-exceeded" }`. Value: 30 minutes in ms.
 */
export const DEV_BUDGET_MS = 30 * 60 * 1000; // 1_800_000
