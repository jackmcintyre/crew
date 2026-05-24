/**
 * Typed error hierarchy for the crew plugin.
 *
 * All domain errors extend `DomainError`. The MCP boundary
 * (tool handlers in later stories) maps these to MCP errors.
 */
export declare class DomainError extends Error {
    constructor(message: string);
}
/**
 * Thrown when a method or seam exists for future stories but has
 * no behavior yet. Always include the story reference that will
 * land the real implementation.
 */
export declare class NotImplementedError extends DomainError {
}
/**
 * `.crew/config.yaml` exists but failed schema validation
 * (malformed YAML, missing required keys, wrong types, unknown adapter
 * name, or invalid adapter_config). User must fix the file by hand —
 * the resolver does NOT fall back to `detect()`.
 */
export declare class InvalidWorkspaceConfigError extends DomainError {
    readonly configPath: string;
    readonly yamlPath: string;
    readonly zodMessage: string;
    readonly schemaModule: string;
    constructor(opts: {
        configPath: string;
        yamlPath: string;
        zodMessage: string;
        schemaModule: string;
    });
}
/**
 * `.crew/config.yaml` declares an `adapter:` name that does not match
 * any registered adapter. The user must either install the matching
 * adapter package or edit the `adapter:` key in the config file.
 *
 * Thrown by `getActiveAdapter()` in Branch A (configured-adapter path)
 * when the named adapter is absent from the in-process registry.
 * (Story 3.1 AC2)
 */
export declare class UnknownAdapterError extends DomainError {
    readonly configuredAdapterName: string;
    readonly registeredAdapterNames: string[];
    readonly configPath: string;
    constructor(opts: {
        configuredAdapterName: string;
        registeredAdapterNames: string[];
        configPath: string;
    });
}
/**
 * No registered adapter's `detect()` returned true for the target repo.
 * User must author `.crew/config.yaml` manually.
 */
export declare class NoAdapterMatchedError extends DomainError {
    readonly targetRepoRoot: string;
    readonly registeredAdapters: string[];
    constructor(opts: {
        targetRepoRoot: string;
        registeredAdapters: string[];
    });
}
/**
 * Two or more registered adapters' `detect()` returned true for the
 * target repo. User must disambiguate by authoring config manually.
 */
export declare class AmbiguousAdapterError extends DomainError {
    readonly targetRepoRoot: string;
    readonly matchingAdapters: string[];
    constructor(opts: {
        targetRepoRoot: string;
        matchingAdapters: string[];
    });
}
/**
 * The configured adapter's detect() returned false for the target repo.
 * The config parsed cleanly — it is just no longer (or never was) a match
 * for this repo. Typical cause: user copied example config into a repo
 * that doesn't fit. Distinct from InvalidWorkspaceConfigError (schema fail)
 * and NoAdapterMatchedError (no config + no detect match).
 */
export declare class StaleWorkspaceConfigError extends DomainError {
    readonly targetRepoRoot: string;
    readonly configuredAdapter: string;
    readonly otherMatchingAdapters: string[];
    readonly schemaModule: string;
    constructor(opts: {
        targetRepoRoot: string;
        configuredAdapter: string;
        otherMatchingAdapters: string[];
        schemaModule: string;
    });
}
/**
 * `docs/standards.md` was not found at the expected path under the target
 * repo. User must copy the shipped example to bootstrap. Distinct from
 * StandardsDocMalformedError (file exists but fails the schema).
 */
export declare class StandardsDocMissingError extends DomainError {
    readonly expectedPath: string;
    readonly copyTarget: string;
    constructor(opts: {
        expectedPath: string;
        copyTarget: string;
    });
}
/**
 * `docs/standards.md` was found but failed the parser: either YAML syntax
 * is invalid, a required field is missing or wrongly typed, or the
 * 10-criterion hard cap (FR46) is exceeded. The `zodMessage` field carries
 * the formatted Zod error (or the explicit cap-violation message). The
 * user-facing `message` cites the offending field or the cap.
 */
export declare class StandardsDocMalformedError extends DomainError {
    readonly sourcePath: string;
    readonly zodMessage: string;
    readonly copyTarget: string;
    constructor(opts: {
        sourcePath: string;
        zodMessage: string;
        copyTarget: string;
    });
}
/**
 * An agent operating under a known role attempted to invoke an MCP tool
 * whose name is not in the role's tools_allow. Caught at the
 * CallToolRequestSchema handler before the tool's handler runs.
 */
export declare class PermissionDeniedError extends DomainError {
    readonly role: string;
    readonly attemptedTool: string;
    readonly allowedTools: readonly string[];
    readonly specPath: string;
    constructor(opts: {
        role: string;
        attemptedTool: string;
        allowedTools: readonly string[];
        specPath: string;
    });
}
/**
 * An agent operating under a known role attempted to invoke a gh
 * subcommand not in the role's gh_allow. Caught at the gh() wrapper
 * before any subprocess is spawned.
 */
export declare class GhSubcommandDeniedError extends DomainError {
    readonly role: string;
    readonly attemptedSubcommand: string;
    readonly allowedSubcommands: readonly string[];
    readonly specPath: string;
    constructor(opts: {
        role: string;
        attemptedSubcommand: string;
        allowedSubcommands: readonly string[];
        specPath: string;
    });
}
/**
 * A code path attempted to write to a canonical-state path under the
 * target repo without an MCP tool context. Routes through
 * writeManagedFile() are the only permitted entrypoint, and they
 * require an explicit { toolName, role } context.
 */
export declare class CanonicalFsWriteError extends DomainError {
    readonly attemptedPath: string;
    readonly canonicalPathGlob: string;
    constructor(opts: {
        attemptedPath: string;
        canonicalPathGlob: string;
    });
}
/**
 * Permission spec file for the named role does not exist at the
 * expected path. Distinct from RolePermissionsMalformedError (file
 * exists but fails the schema).
 */
export declare class RolePermissionsMissingError extends DomainError {
    readonly role: string;
    readonly specPath: string;
    constructor(opts: {
        role: string;
        specPath: string;
    });
}
/**
 * Permission spec file exists but failed the parser (YAML syntax,
 * missing required field, or unknown key).
 */
export declare class RolePermissionsMalformedError extends DomainError {
    readonly specPath: string;
    readonly zodMessage: string;
    constructor(opts: {
        specPath: string;
        zodMessage: string;
    });
}
/**
 * A caller invoked `logTelemetryEvent` with an event whose payload
 * failed its `type`-specific Zod schema. The invalid event was NOT
 * written to the JSONL file; a `telemetry.invalid` failure event was
 * recorded in its place so the failure is never silent (NFR6 / NFR21).
 */
export declare class TelemetryEventInvalidError extends DomainError {
    readonly attemptedType: string;
    readonly zodPath: string;
    readonly zodMessage: string;
    constructor(opts: {
        attemptedType: string;
        zodPath: string;
        zodMessage: string;
    });
}
/**
 * `gitCommit` refused a call because either the commit message did
 * not match the required `<tool-name>: <ref-or-proposal-id>` shape,
 * or the `paths` set was empty. Thrown BEFORE any subprocess spawn
 * (Story 1.5 AC4).
 */
export declare class GitCommitMessageMalformedError extends DomainError {
    readonly invalidMessage: string;
    readonly paths: readonly string[];
    readonly reason: string;
    constructor(opts: {
        message: string;
        paths: readonly string[];
        reason: string;
    });
}
/**
 * BMad story file failed parser-side validation: the H1 disagrees with
 * the filename's epic/story numbers, the `Status:` line carries an
 * unknown vocabulary value, or an AC block could not be parsed. Thrown
 * by `parseBmadStory` (Story 3.3).
 */
export declare class MalformedBmadStoryError extends DomainError {
    readonly path: string;
    readonly reason: string;
    readonly details: Record<string, unknown>;
    constructor(opts: {
        path: string;
        reason: string;
        details?: Record<string, unknown>;
    });
}
/**
 * `BmadAdapter.readSourceStory(ref)` or `resolveSourcePath(ref)` was
 * given a ref that does not resolve to any file under `stories_root`.
 */
export declare class UnknownBmadRefError extends DomainError {
    readonly ref: string;
    readonly storiesRoot: string;
    constructor(opts: {
        ref: string;
        storiesRoot: string;
    });
}
/**
 * Two or more files under `stories_root` share the same
 * `<epic>-<story>-` prefix, so a ref cannot be resolved unambiguously.
 */
export declare class AmbiguousBmadRefError extends DomainError {
    readonly ref: string;
    readonly matches: readonly string[];
    constructor(opts: {
        ref: string;
        matches: readonly string[];
    });
}
/**
 * `moveBetweenStates` refused a move because the underlying `fs.rename`
 * returned `EXDEV` — the source and destination resolve to different
 * filesystems. v1 explicitly does NOT fall back to copy+delete because
 * that would create an observable in-between state, violating NFR8's
 * single-syscall atomicity guarantee. (Story 1.6 AC2)
 */
export declare class CrossFilesystemMoveError extends DomainError {
    readonly absFromPath: string;
    readonly absToPath: string;
    readonly ref: string;
    readonly originalCode: string;
    constructor(opts: {
        absFromPath: string;
        absToPath: string;
        ref: string;
        originalCode: string;
    });
}
/**
 * `moveBetweenStates` was asked to move a manifest from a state
 * directory where the source file does not exist. Maps the underlying
 * `ENOENT` errno from `fs.rename` to a typed domain error. (Story 1.6 AC5)
 */
export declare class ManifestNotFoundError extends DomainError {
    readonly ref: string;
    readonly expectedAbsPath: string;
    readonly fromState: string;
    constructor(opts: {
        ref: string;
        expectedAbsPath: string;
        fromState: string;
    });
}
/**
 * `moveBetweenStates` refused a transition because either the `from`
 * or `to` state name is not in the canonical whitelist, OR because
 * the resolved absolute path escapes the canonical state-root tree.
 * Thrown BEFORE any filesystem operation. (Story 1.6 AC4)
 */
export declare class InvalidStateNameError extends DomainError {
    readonly attemptedFrom: string;
    readonly attemptedTo: string;
    readonly allowedStates: readonly string[];
    readonly reason: string;
    constructor(opts: {
        attemptedFrom: string;
        attemptedTo: string;
        allowedStates: readonly string[];
        reason: string;
    });
}
/**
 * Catalogue role file (`plugins/<plugin>/catalogue/<role>.md`) exists
 * but failed the parser — YAML frontmatter syntax error, missing /
 * unknown frontmatter key, or a required `##` section that is missing
 * or out of canonical order (Story 2.1).
 */
export declare class CatalogueShapeError extends DomainError {
    readonly code: "CATALOGUE_SHAPE_ERROR";
    readonly sourcePath: string;
    readonly zodMessage: string;
    constructor(opts: {
        sourcePath: string;
        zodMessage: string;
    });
}
/**
 * An execution manifest at `<target-repo>/.crew/state/<state>/<ref>.yaml`
 * failed schema validation: malformed YAML, missing required field, wrong
 * type, or an unknown key (strict-mode rejection). Named so downstream
 * tooling (Story 3.5, Story 4.x) can pattern-match the error class name
 * without parsing the message string.
 *
 * Thrown by `parseExecutionManifest` in
 * `schemas/execution-manifest.ts` — every reader MUST go through that
 * helper so this error surfaces consistently. (Story 3.2 / FR13)
 */
export declare class MalformedExecutionManifestError extends DomainError {
    readonly absPath: string;
    readonly yamlPath: string;
    readonly zodMessage: string;
    readonly schemaModule: string;
    constructor(opts: {
        absPath: string;
        yamlPath: string;
        zodMessage: string;
        schemaModule: string;
    });
}
/**
 * `readCatalogue` / `instantiatePersona` was asked for a role that
 * does not exist in `plugins/crew/catalogue/`. Distinct from
 * `CatalogueShapeError` (file exists but malformed) — this error
 * means no file was found at the expected path. (Story 2.3)
 */
export declare class CatalogueRoleNotFoundError extends DomainError {
    readonly code: "CATALOGUE_ROLE_NOT_FOUND";
    readonly role: string;
    readonly cataloguePath: string;
    constructor(opts: {
        role: string;
        cataloguePath: string;
    });
}
/**
 * `instantiatePersona` was asked to materialise a persona file for a
 * role that has already been hired (the persona file already exists
 * on disk). v1's `/hire` skill checks this and surfaces the re-entry
 * actions (FR90); the underlying tool stays a pure create-or-fail.
 * (Story 2.3)
 */
export declare class PersonaAlreadyExistsError extends DomainError {
    readonly code: "PERSONA_ALREADY_EXISTS";
    readonly role: string;
    readonly personaPath: string;
    constructor(opts: {
        role: string;
        personaPath: string;
    });
}
/**
 * A native-story file at `<target-repo>/.crew/native-stories/<ULID>.md`
 * failed parser-side validation: missing H1, missing required section,
 * zero parseable ACs, an AC block with no Given/When/Then, or a
 * `## Dependencies` bullet that does not parse as a ref.
 *
 * Thrown by `parseNativeStory` (Story 3.4). The error message names the
 * offending file path and section.
 */
export declare class MalformedNativeStoryError extends DomainError {
    readonly path: string;
    readonly section: string;
    readonly reason: string;
    constructor(opts: {
        path: string;
        section: string;
        reason: string;
    });
}
/**
 * An MCP tool was invoked against a workspace whose active adapter does not
 * match the tool's requirement. Widened in Story 3.6 to carry `toolName` so
 * the error message names the actual calling tool rather than always saying
 * `writeNativeStory`. Both call-sites (writeNativeStory, markWithdrawn)
 * pass their own `toolName`.
 *
 * Story 3.4: initial guard for `writeNativeStory`.
 * Story 3.6: widened with `toolName`; `markWithdrawn` added as second call-site.
 */
export declare class WrongAdapterError extends DomainError {
    readonly expectedAdapter: string;
    readonly actualAdapter: string;
    readonly targetRepoRoot: string;
    readonly toolName: string;
    constructor(opts: {
        expectedAdapter: string;
        actualAdapter: string;
        targetRepoRoot: string;
        /** Name of the MCP tool that raised this error. Defaults to "writeNativeStory" for backward compatibility. */
        toolName?: string;
    });
}
/**
 * An execution manifest at `<target-repo>/.crew/state/in-progress/<ref>.yaml`
 * was found to have been hand-edited after it was claimed by the dev loop.
 * Thrown by `detectInProgressHandEdit` when the on-disk manifest's
 * operator-editable fields or `source_hash` differ from the canonical values
 * at scan-time.
 *
 * This is a hard refusal: the caller MUST surface this to the operator and
 * MUST NOT proceed with any operation on the manifest. The operator's options
 * are: wait for the story to land in `done/` or `blocked/`, or use
 * `/crew:plan` to discard the story (Story 3.6 flow).
 *
 * See Story 3.7, FR14 (second half — "orchestration surfaces the violation in v1").
 */
export declare class InProgressHandEditError extends DomainError {
    readonly ref: string;
    readonly changedFields: readonly string[];
    readonly absPath: string;
    constructor(opts: {
        ref: string;
        changedFields: readonly string[];
        absPath: string;
    });
}
/**
 * `claimStory` refused because one or more `depends_on` refs are not yet in
 * `done/`. The calling session must wait for the listed dependencies to
 * complete before the ref can be claimed.
 *
 * FR18 — dependency check at claim time (Story 4.1).
 * Message format mirrors `GitCommitMessageMalformedError`'s `<tool-name> refused: <reason>`.
 */
export declare class DependenciesNotReadyError extends DomainError {
    readonly ref: string;
    readonly missingDeps: readonly string[];
    constructor(opts: {
        ref: string;
        missingDeps: readonly string[];
    });
}
/**
 * `completeStory` refused because the calling session's ULID does not match
 * the `claimed_by` field on the `in-progress/` manifest. Only the session
 * that claimed the story may complete it.
 *
 * Story 4.1 AC4.
 */
export declare class WrongClaimantError extends DomainError {
    readonly ref: string;
    readonly expectedSessionUlid: string;
    readonly actualSessionUlid: string;
    constructor(opts: {
        ref: string;
        expectedSessionUlid: string;
        actualSessionUlid: string;
    });
}
/**
 * `readPersona` was asked for a role whose persona file does not
 * exist under `<target-repo>/team/<role>/PERSONA.md`. (Story 2.3)
 */
export declare class PersonaFileNotFoundError extends DomainError {
    readonly code: "PERSONA_FILE_NOT_FOUND";
    readonly role: string;
    readonly personaPath: string;
    constructor(opts: {
        role: string;
        personaPath: string;
    });
}
/**
 * Thrown when the dev subagent's final-output transcript does not contain
 * the verbatim locked handoff phrase `Handoff to reviewer — story <story-id>
 * ready for review.` on its last non-empty line. The in-progress manifest
 * is stamped with `blocked_by: "handoff-grammar"` in-place (Story 5.1 will
 * retrofit the atomic move to `blocked/`).
 *
 * Reserved for callers that prefer exception-style flow control over the
 * tagged-union result from `parseHandoff`. The inner cycle uses the tagged
 * union; this class is declared here for SKILL.md failure-modes documentation
 * and for future callers.
 *
 * Added in Story 4.3.
 */
export declare class HandoffGrammarDriftError extends DomainError {
    readonly ref: string;
    constructor(opts: {
        ref: string;
    });
}
/**
 * `parsePersonaFile` found a file on disk but it failed the parser —
 * YAML frontmatter syntax error, missing / unknown frontmatter key,
 * a required `##` section missing / out of canonical order, or the
 * required `## Knowledge` section absent / preceding `## Prompt`.
 * (Story 2.3)
 */
export declare class PersonaFileMalformedError extends DomainError {
    readonly code: "PERSONA_FILE_MALFORMED";
    readonly personaPath: string;
    readonly zodMessage: string;
    constructor(opts: {
        personaPath: string;
        zodMessage: string;
    });
}
/**
 * An execa wrapper (`gh` or `git`) refused a call because the `args`
 * array contained a flag that the dev role's permission spec forbids
 * unconditionally (NFR16 / Pattern §9). Thrown BEFORE any subprocess
 * spawn; an `execaImpl` spy confirms zero calls.
 *
 * Covered by Story 4.4 AC2 (negative-capability refusal).
 */
export declare class NegativeCapabilityDeniedError extends DomainError {
    readonly attempted_flag: string;
    readonly role: string;
    readonly callSite: "gh" | "git";
    constructor(opts: {
        attempted_flag: string;
        role: string;
        callSite: "gh" | "git";
    });
}
/**
 * `gitCreateBranch` refused to create a branch because the supplied
 * branch name did not match the `^story/[a-z0-9-]+$` pattern.
 * Thrown BEFORE any subprocess spawn. (Story 4.4 Task 2.1)
 */
export declare class GitBranchNameMalformedError extends DomainError {
    readonly branchName: string;
    constructor(opts: {
        branchName: string;
    });
}
/**
 * `gitPush` returned a non-zero exit code. The local branch and commit
 * are left in place for operator-side recovery. Story 4.5 will classify
 * this as a recoverable error. (Story 4.4 AC1e)
 */
export declare class GitPushFailedError extends DomainError {
    readonly branchName: string;
    readonly stderr: string;
    constructor(opts: {
        branchName: string;
        stderr: string;
    });
}
/**
 * `gh pr create` returned a non-zero exit code, or the stdout did not
 * contain a valid PR URL (starts with `https://github.com/`). Story
 * 4.5 will wrap this in the recoverable-error classifier. (Story 4.4
 * AC1g, AC1i)
 */
export declare class GhPrCreateFailedError extends DomainError {
    readonly stderr: string;
    readonly diagnostic: string;
    constructor(opts: {
        stderr: string;
        diagnostic: string;
    });
}
/**
 * `plugins/crew/permissions/gh-error-map.yaml` failed schema validation: the
 * top-level shape was wrong, a per-entry key was unknown, `class` was not in
 * the literal set, `exit_code` was missing or non-integer, or a `stderr_regex`
 * string could not be compiled as a JavaScript regex.
 *
 * Thrown by `parseGhErrorMap` in `lib/gh-error-map.ts`.
 *
 * `rowIndex` is 1-indexed (the first entry is row 1). Present only when the
 * error is tied to a specific entry. `offendingKey` names the YAML key that
 * caused the failure. `reason` carries the human-readable cause string.
 *
 * Story 4.5 Task 1.3
 */
export declare class MalformedGhErrorMapError extends DomainError {
    readonly filePath: string;
    readonly reason: string;
    readonly rowIndex?: number;
    readonly offendingKey?: string;
    constructor(opts: {
        filePath: string;
        reason: string;
        rowIndex?: number;
        offendingKey?: string;
    });
}
/**
 * `gh()` wrapper detected a mapped recoverable error via the `gh-error-map.yaml`
 * classifier. Raised AFTER `execaImpl` returns with a non-zero exit code and the
 * classifier returns a non-null class. The error propagates through
 * `runDevTerminalAction` unchanged; the dev subagent emits the locked marker line
 * so `processDevTranscript` can stamp `blocked_by: gh-<class>` on the in-progress
 * manifest.
 *
 * Fields:
 * - `class` — one of `"defer" | "retry" | "needs-human"` (the mapped class from the YAML table).
 * - `exitCode` — the `gh` process exit code.
 * - `stderr` — the raw stderr string from `gh`.
 * - `subcommand` — the kebab-cased subcommand (e.g. `"pr-create"`).
 *
 * Story 4.5 Task 3.1
 */
export declare class GhRecoverableError extends DomainError {
    readonly class: "defer" | "retry" | "needs-human";
    readonly exitCode: number;
    readonly stderr: string;
    readonly subcommand: string;
    constructor(opts: {
        class: "defer" | "retry" | "needs-human";
        exitCode: number;
        stderr: string;
        subcommand: string;
    });
}
/**
 * `runDevTerminalAction` received a `type` argument that is not in the
 * conventional-commits type set. Thrown BEFORE any subprocess spawn.
 * (Story 4.4 AC1b)
 */
export declare class ConventionalCommitTypeUnknownError extends DomainError {
    readonly attempted_type: string;
    readonly allowed_types: readonly string[];
    constructor(opts: {
        attempted_type: string;
        allowed_types: readonly string[];
    });
}
/**
 * Two or more standards criteria slugify to the same id.
 *
 * `runReviewerSession` raises this when building `standardsByCriterionId`
 * and detects that `slugifyStandardsCriterion(name)` produces the same key
 * for two distinct criteria. This is an authoring bug in `docs/standards.md`
 * — the operator must rename one criterion to make ids unique.
 *
 * (Story 4.6 Task 3.3 / AC3c)
 */
export declare class DuplicateStandardsCriterionIdError extends DomainError {
    readonly criterionId: string;
    readonly names: string[];
    constructor(opts: {
        criterionId: string;
        names: string[];
    });
}
/**
 * `processDevTranscript` could not parse a GitHub PR URL from the dev
 * subagent's transcript on the happy-path `spawn-reviewer` branch.
 *
 * Raised when `parseHandoff` succeeds (the dev claimed completion) but no
 * line in the transcript matches `https://github.com/.../pull/<n>`. This
 * typically means the dev pushed but `gh pr create` did not surface the PR
 * URL in the transcript, or the PR was not created at all.
 *
 * The `transcriptTail` field carries the last ~500 characters of the
 * transcript for operator diagnostics.
 *
 * (Story 4.6 Task 3.4 / AC1g)
 */
export declare class PrUrlNotFoundInDevTranscriptError extends DomainError {
    readonly ref: string;
    readonly transcriptTail: string;
    constructor(opts: {
        ref: string;
        transcriptTail: string;
    });
}
/**
 * `processReviewerTranscript` found `reviewer-result.json` at the expected
 * path but could not parse or validate it. This is a bug in `runReviewerSession`
 * — the file should always be schema-valid when present.
 *
 * Fields:
 * - `path` — the absolute path to the malformed file.
 * - `cause` — the raw parse/validation error.
 *
 * (Story 4.6 Task 8b.8 / revision 2)
 */
export declare class ReviewerResultFileMalformedError extends DomainError {
    readonly path: string;
    readonly cause: unknown;
    constructor(opts: {
        path: string;
        cause: unknown;
    });
}
/**
 * A `gh api` subcommand returned a response body that could not be parsed
 * as JSON or did not match the expected shape. Raised by
 * `postReviewerComments` when `gh api .../reviews` returns non-JSON stdout
 * or when `gh pr view --json baseRepository` returns an unexpected shape.
 *
 * Fields:
 * - `subcommand` — the kebab-cased subcommand (e.g. `"api"`, `"pr-view"`).
 * - `url` — the API URL path (only present for `api` calls).
 * - `cause` — the raw parse/validation error.
 *
 * Story 4.6b Task 6.1
 */
export declare class GhApiResponseShapeError extends DomainError {
    readonly subcommand: string;
    readonly url?: string;
    readonly cause: unknown;
    constructor(opts: {
        subcommand: string;
        url?: string;
        cause: unknown;
    });
}
/**
 * `composeVerdictLine` reached the BLOCKED branch but `acResults` is neither
 * empty nor contains a `manual-check-required` entry. Per Story 4.6 §3f this
 * state is unreachable in a non-mutated `reviewer-result.json` — reaching it
 * means the persisted file was mutated out-of-band (e.g. hand-edited). Raised
 * to refuse fabricating a reason string that would violate AC2's enumerated
 * grammar.
 *
 * Story 4.6b Task 6.2
 */
export declare class UnreachableBlockedReasonError extends DomainError {
    readonly acResultKeys: readonly string[];
    constructor(opts: {
        acResults: Record<number, unknown>;
    });
}
/**
 * `buildBranchSlug` produced a slug that had no alphanumeric characters
 * after the `story/` prefix (e.g. a title composed entirely of Unicode
 * / punctuation). Thrown BEFORE any subprocess spawn. (Story 4.4
 * Implementation strategy — Risks)
 */
export declare class BranchSlugUnrenderableError extends DomainError {
    readonly ref: string;
    readonly title: string;
    constructor(opts: {
        ref: string;
        title: string;
    });
}
/**
 * `processDevTranscript` found `dev-outcome.json` at the expected path but
 * could not parse or validate it. This is a bug in `runDevTerminalAction`
 * — the file should always be schema-valid when present.
 *
 * A malformed file is NOT silently fallen back to transcript scanning;
 * it is a write-seam bug and must surface as a hard error.
 *
 * Fields:
 * - `path` — the absolute path to the malformed file (encodes the session
 *             via `.../sessions/<sessionUlid>/dev-outcome.json`).
 * - `cause` — the raw parse/validation error or a descriptive string naming
 *             the offending field.
 *
 * (Story 4.8b Task 2 / AC4)
 */
export declare class DevOutcomeFileMalformedError extends DomainError {
    readonly path: string;
    readonly cause: unknown;
    constructor(opts: {
        path: string;
        cause: unknown;
    });
}
