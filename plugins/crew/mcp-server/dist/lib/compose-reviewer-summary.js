/**
 * Pure helpers for composing the PR review summary body and verdict line
 * from a persisted `reviewer-result.json` file.
 *
 * Both `composeSummaryBody` and `composeVerdictLine` are pure functions:
 * no I/O, no Date.now(), no env reads. Inputs are the parsed file shape only.
 *
 * The verdict line grammar is the load-bearing contract from Story 4.6b AC2:
 *   - "READY FOR MERGE"  → `**Verdict: READY FOR MERGE**`
 *   - "NEEDS CHANGES"    → `**Verdict: NEEDS CHANGES** [N issues, M questions]`
 *   - "BLOCKED"          → `**Verdict: BLOCKED** [no ACs declared | manual checks required]`
 *
 * Any other state throws `UnreachableBlockedReasonError` to prevent fabricating
 * an unknown reason string.
 *
 * Story 4.6b Task 3.1–3.2
 */
import { UnreachableBlockedReasonError } from "../errors.js";
// ---------------------------------------------------------------------------
// Verdict line composer
// ---------------------------------------------------------------------------
/**
 * Compose the single load-bearing verdict line from the persisted result.
 * Follows the closed table from Story 4.6b spec §2e.
 *
 * Throws `UnreachableBlockedReasonError` if `recommendedVerdict` is "BLOCKED"
 * but `acResults` is neither empty nor contains a `manual-check-required` entry —
 * indicating an out-of-band mutation of the persisted file.
 */
export function composeVerdictLine(result) {
    const { recommendedVerdict, acResults } = result;
    if (recommendedVerdict === "READY FOR MERGE") {
        return "**Verdict: READY FOR MERGE**";
    }
    if (recommendedVerdict === "NEEDS CHANGES") {
        const failCount = Object.values(acResults).filter((r) => (r.applicability === "runnable-artifact-check" ||
            r.applicability === "runnable-vitest") &&
            r.status === "fail").length;
        const manualCount = Object.values(acResults).filter((r) => r.applicability === "manual-check-required").length;
        return `**Verdict: NEEDS CHANGES** [${failCount} issues, ${manualCount} questions]`;
    }
    // recommendedVerdict === "BLOCKED"
    if (Object.keys(acResults).length === 0) {
        return "**Verdict: BLOCKED** [no ACs declared]";
    }
    if (Object.values(acResults).some((r) => r.applicability === "manual-check-required")) {
        return "**Verdict: BLOCKED** [manual checks required]";
    }
    // Per Story 4.6 §3f, BLOCKED is only reachable via empty-ACs or manual-check-required.
    // A file that reaches here was mutated out-of-band — refuse to fabricate a reason.
    throw new UnreachableBlockedReasonError({ acResults });
}
// ---------------------------------------------------------------------------
// Summary body composer
// ---------------------------------------------------------------------------
/**
 * Compose the full PR review summary body from the persisted result.
 *
 * Body skeleton (Story 4.6b spec §2a):
 *   # Reviewer summary — ${ref}
 *   ## Acceptance criteria
 *   <per-AC lines>
 *   ## Standards check
 *   <per-criterion lines>
 *   [## Manual checks required before merge]  (only if any manual-check-required ACs)
 *   <verdict line>
 */
export function composeSummaryBody(result) {
    const { ref, acResults, standardsByCriterionId } = result;
    // --- Per-AC lines (spec §2b) ---
    const acEntries = Object.entries(acResults)
        .map(([key, ac]) => ({ sortKey: Number(key), ac }))
        .sort((a, b) => a.sortKey - b.sortKey);
    let perAcLines;
    if (acEntries.length === 0) {
        perAcLines = "_No ACs declared in the source story._";
    }
    else {
        perAcLines = acEntries
            .map(({ sortKey, ac }) => formatAcLine(sortKey, ac))
            .join("\n");
    }
    // --- Standards-check section (spec §2c) ---
    const criterionEntries = Object.values(standardsByCriterionId);
    let standardsLines;
    if (criterionEntries.length === 0) {
        standardsLines = "_No standards criteria declared._";
    }
    else {
        standardsLines = criterionEntries
            .map((c) => `- 📋 **${c.name}** — ${c.what}`)
            .join("\n");
    }
    // --- Manual-checks-required section (spec §2d) ---
    const manualAcs = acEntries.filter(({ ac }) => ac.applicability === "manual-check-required");
    let manualChecksSection = "";
    if (manualAcs.length > 0) {
        const manualLines = manualAcs
            .map(({ sortKey, ac }) => `- AC${sortKey}: ${ac.reason}`)
            .join("\n");
        manualChecksSection = `\n## Manual checks required before merge\n\n${manualLines}`;
    }
    // --- Verdict line (spec §2e) ---
    const verdictLine = composeVerdictLine(result);
    // --- Assemble body ---
    const parts = [
        `# Reviewer summary — ${ref}`,
        ``,
        `## Acceptance criteria`,
        ``,
        perAcLines,
        ``,
        `## Standards check`,
        ``,
        standardsLines,
    ];
    if (manualChecksSection) {
        parts.push(manualChecksSection);
    }
    parts.push(``, verdictLine);
    return parts.join("\n");
}
// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------
function formatAcLine(index, ac) {
    if (ac.applicability === "manual-check-required") {
        return `- ⚠️ **AC${index}** — ${ac.reason}`;
    }
    if (ac.status === "pass") {
        return `- ✅ **AC${index}** — ${ac.reason}`;
    }
    return `- ❌ **AC${index}** — ${ac.reason}`;
}
