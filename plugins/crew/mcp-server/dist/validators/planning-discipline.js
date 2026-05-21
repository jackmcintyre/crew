/**
 * Planning-discipline pure validator (Story 3.5).
 *
 * Implements the four enforcement rules from the planning-discipline doctrine:
 *   1. State-mutating stories must have at least one integration AC.
 *   2. Implicit `depends_on` references in narrative/AC text must be declared.
 *   3. Every backlog must contain at least one ship-gate story (backlog-level only).
 *   4. BMad scan-time: same as rule 1 applied via BmadAdapter.
 *
 * All functions are pure — no I/O, no side effects, deterministic.
 *
 * @see _bmad-output/implementation-artifacts/3-5-planning-discipline-validation-at-authoring-and-scan-time.md
 */
/**
 * Path-glob tokens that indicate a story is state-mutating.
 * Conservative list: false positives are acceptable, false negatives are not.
 */
export const STATE_MUTATING_GLOBS = [
    "**/state/**",
    "**/manifest*",
    "**/sprint-status.yaml",
    "mark-story-*.ts",
    "scan-sources.ts",
    "write-native-story.ts",
];
/**
 * Verb+object pattern indicating state mutation.
 * Conservative: matches common mutation verbs paired with state/manifest/status/backlog.
 */
export const STATE_MUTATING_TOKEN_RE = /\b(mutates?|writes?|persists?|commits?)\s+(state|manifest|status|backlog)\b/i;
/**
 * Ref pattern: identifiers of the form `<adapter>:<id>` embedded in prose.
 * Detects cross-story references like `native:01JX9000000000000000000001`
 * or `bmad:1.3`.
 */
const IMPLICIT_REF_RE = /\b(native|bmad):[A-Za-z0-9.\-:_]+\b/g;
/**
 * Convert a simple glob pattern to a regex for full-token matching against
 * text tokens. The regex is anchored (start and end) so it must match the
 * entire token, not just a substring.
 *
 * Supported conversions:
 *   - ** followed by / is an optional path prefix (matches with or without prefix)
 *   - ** elsewhere matches any sequence of characters
 *   - * matches any sequence of non-separator characters
 *   - . is escaped to match a literal dot
 *
 * Example: the glob star-star/sprint-status.yaml becomes a regex that matches
 * both "sprint-status.yaml" (no prefix) and ".crew/sprint-status.yaml" (with prefix).
 *
 * Only intended for the STATE_MUTATING_GLOBS which are simple path patterns.
 */
function globToRegex(glob) {
    // Use placeholder tokens to avoid replacement strings being re-processed
    // by subsequent replaces.
    const OPTIONAL_PREFIX = "\x00OPTPREFIX\x00";
    const ANY_CHARS = "\x00ANYCHARS\x00";
    const NON_SEP = "\x00NONSEP\x00";
    // 1. Escape regex-special chars except *.
    let pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    // 2. Replace ** followed by / with placeholder for optional path prefix.
    //    This makes **/foo.yaml match "foo.yaml" (no prefix) and "path/to/foo.yaml".
    pattern = pattern.replace(/\*\*\//g, OPTIONAL_PREFIX);
    // 3. Replace remaining ** with placeholder for any-char wildcard.
    pattern = pattern.replace(/\*\*/g, ANY_CHARS);
    // 4. Replace single * with placeholder for non-separator wildcard.
    pattern = pattern.replace(/\*/g, NON_SEP);
    // 5. Expand placeholders to their regex equivalents.
    pattern = pattern
        .split(OPTIONAL_PREFIX).join("(?:.*\\/)?")
        .split(ANY_CHARS).join(".*")
        .split(NON_SEP).join("[^/]*");
    return new RegExp("^" + pattern + "$", "i");
}
const STATE_MUTATING_GLOB_RES = STATE_MUTATING_GLOBS.map(globToRegex);
/**
 * Determine whether a story is state-mutating using the conservative heuristic.
 *
 * Scans `narrative`, `implementation_notes`, and all AC text for:
 *   - File-path tokens matching any STATE_MUTATING_GLOBS pattern
 *   - Verb phrases matching STATE_MUTATING_TOKEN_RE
 *
 * @param story - The story to inspect.
 * @returns `true` if the heuristic fires, `false` otherwise.
 */
function isStateMutatingByHeuristic(story) {
    const texts = [
        story.narrative,
        ...(story.implementation_notes ? [story.implementation_notes] : []),
        ...story.acceptance_criteria.map((ac) => ac.text),
    ];
    for (const text of texts) {
        // Check verb+object pattern first (fast).
        if (STATE_MUTATING_TOKEN_RE.test(text))
            return true;
        // Check path-glob patterns against each whitespace-delimited token.
        // Strip trailing/leading punctuation from tokens so "sprint-status.yaml."
        // (end of sentence) still matches the glob "sprint-status.yaml".
        const tokens = text.split(/\s+/).map((t) => t.replace(/^[^\w*]+|[^\w*]+$/g, ""));
        for (const token of tokens) {
            if (!token)
                continue;
            for (const re of STATE_MUTATING_GLOB_RES) {
                if (re.test(token))
                    return true;
            }
        }
    }
    return false;
}
/**
 * Validate a single `SourceStory` against per-story discipline rules.
 *
 * Rules checked:
 *   - Missing integration AC (when story is state-mutating).
 *   - Implicit `depends_on` refs in narrative / AC text.
 *
 * Ship-gate is a backlog-level concept — NOT checked here.
 *
 * @param story - The story to validate.
 * @param opts.stateMutating - Override the heuristic. `true`/`false` overrides;
 *   `undefined` runs the heuristic. Used when the planner operator dismisses a
 *   false positive.
 * @returns The original `story` on pass, or a `DisciplineViolation` on fail.
 */
export function validateStoryAgainstDiscipline(story, opts) {
    const reasons = [];
    // Rule 1: State-mutating story needs an integration AC.
    const stateMutating = opts?.stateMutating !== undefined ? opts.stateMutating : isStateMutatingByHeuristic(story);
    if (stateMutating) {
        const hasIntegrationAC = story.acceptance_criteria.some((ac) => ac.kind === "integration");
        if (!hasIntegrationAC) {
            reasons.push({
                code: "missing-integration-ac",
                field: "acceptance_criteria",
                detail: "State-mutating story has no integration-tagged AC. Add at least one AC tagged (integration) that exercises the changed code path end-to-end.",
            });
        }
    }
    // Rule 2: Implicit depends_on — scan narrative and AC text for ref patterns.
    const allTexts = [
        story.narrative,
        ...story.acceptance_criteria.map((ac) => ac.text),
    ].join("\n");
    const foundRefs = new Set();
    let match;
    // Reset lastIndex for global regex.
    IMPLICIT_REF_RE.lastIndex = 0;
    while ((match = IMPLICIT_REF_RE.exec(allTexts)) !== null) {
        foundRefs.add(match[0]);
    }
    const declaredDeps = new Set(story.depends_on);
    // Exclude the story's own ref (self-references in AC text or narrative
    // are not implicit dependencies). Also exclude refs that are declared
    // in depends_on.
    const implicitRefs = [...foundRefs].filter((ref) => ref !== story.ref && !declaredDeps.has(ref));
    if (implicitRefs.length > 0) {
        for (const implicitRef of implicitRefs) {
            reasons.push({
                code: "implicit-depends-on",
                field: "depends_on",
                detail: `Story body references ref '${implicitRef}' but it is missing from depends_on. Add it or rephrase to remove the cross-story reference.`,
            });
        }
    }
    if (reasons.length === 0) {
        return story;
    }
    return {
        kind: "discipline-violation",
        ref: story.ref,
        violations: reasons,
    };
}
/**
 * Validate a backlog of stories for the ship-gate rule.
 *
 * Only the backlog-level check is performed here — per-story rules are
 * validated by `validateStoryAgainstDiscipline`.
 *
 * Ship-gate detection: a story is a ship-gate if
 * `raw_frontmatter.ship_gate === true` (native stories) OR
 * `raw_frontmatter.ship_gate === true` (BMad stories, set by the parser
 * from the `ship-gate` tag — see parse-bmad-story.ts Task 4).
 *
 * @param stories - Pending stories being authored/scanned.
 * @param opts.existingStories - Already-on-disk stories to include in the
 *   ship-gate search. Pass `[]` if not available.
 * @param opts.backlogPseudoRef - Ref to use for the violation (defaults to
 *   `"backlog:default"`).
 * @returns Empty array on pass; one-element array with `missing-ship-gate`
 *   violation on fail.
 */
export function validateBacklogAgainstDiscipline(stories, opts) {
    const allStories = [...stories, ...opts.existingStories];
    const hasShipGate = allStories.some((s) => s.raw_frontmatter["ship_gate"] === true);
    if (hasShipGate)
        return [];
    return [
        {
            kind: "discipline-violation",
            ref: opts.backlogPseudoRef ?? "backlog:default",
            violations: [
                {
                    code: "missing-ship-gate",
                    field: "backlog",
                    detail: "No story in the backlog is flagged as the ship-gate. Designate one story (set ship_gate: true) or author a dedicated ship-gate story that depends_on every other story.",
                },
            ],
        },
    ];
}
