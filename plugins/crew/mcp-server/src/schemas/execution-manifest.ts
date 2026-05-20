import { z } from "zod";
import { MalformedExecutionManifestError } from "../errors.js";

/**
 * Zod schema for an execution manifest at
 * `<target-repo>/.crew/state/to-do/<ref>.yaml`.
 *
 * **Producer:** Task 2.6 (`tools/scan-sources.ts`) is the only writer that
 * creates new `to-do/` manifests. Future stories (Story 4.x claim tool,
 * Story 3.6 discard flow) update in-place fields.
 *
 * **Consumer:** Every future reader (Story 3.5 discipline validator,
 * Story 4.x claim tool, Story 3.6 discard flow) MUST go through
 * `parseExecutionManifest` — the canonical reader — rather than calling
 * `ExecutionManifestSchema.parse` directly. This ensures the typed
 * `MalformedExecutionManifestError` surfaces consistently.
 *
 * **Status vocabulary:** This schema pins `status` to the `"to-do"` literal.
 * It represents the *to-do shape* only. Future stories that need to parse
 * `in-progress/`, `blocked/`, or `done/` manifests will either:
 *  (a) discriminate on the file's parent directory (since `STATE_NAMES` in
 *      `state/manifest-state-machine.ts` is the source of truth), or
 *  (b) add a sibling schema with widened `status`.
 * Both options are left open deliberately — do NOT widen this schema to cover
 * all state-machine states. (Story 1.6 AC/State machine ownership.)
 *
 * **Strict mode:** `.strict()` is intentional — unknown keys are rejected so
 * additive future fields force a coordinated schema bump rather than silent
 * acceptance via Zod's default `strip` mode. The cost is one extra edit per
 * new field; the benefit is no silent-drop round-trip bugs.
 *
 * Field order mirrors the intended on-disk YAML field order so that a
 * `yaml.stringify(schema.parse(obj))` round-trip produces stable output.
 */
export const ExecutionManifestSchema = z
  .object({
    /**
     * Story reference, formatted as `<adapter>:<source-id>` (e.g.
     * `bmad:1.1`). Shape is the adapter's responsibility — no regex
     * enforcement here.
     */
    ref: z.string().min(1),

    /**
     * Always `"to-do"` for manifests written by `scan-sources`.
     * See schema TSDoc above for the status-vocabulary note.
     */
    status: z.literal("to-do"),

    /**
     * Name of the active adapter at scan time (e.g. `"bmad"`). Stored so
     * a manifest is self-describing even if `.crew/config.yaml` later changes
     * the active adapter.
     */
    adapter: z.string().min(1),

    /**
     * Path to the source story. Stored repo-relative if the raw path falls
     * strictly inside `targetRepoRoot`; otherwise absolute. Repo-relative is
     * preferred to avoid leaking absolute paths into committed manifests.
     * See Task 2.4 in the story spec for the conversion rule.
     */
    source_path: z.string().min(1),

    /**
     * sha256 hex digest of the source story's raw bytes, computed by the
     * adapter's `listSourceStories()` call and persisted verbatim by
     * `scan-sources`. Downstream drift detection (Epic 4+) compares a
     * freshly-computed hash against this stored value.
     */
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),

    /**
     * Story references this manifest depends on. Carried verbatim from
     * `SourceStory.depends_on`. Defaults to `[]`.
     */
    depends_on: z.array(z.string().min(1)).default([]),

    /**
     * Acceptance criteria, carried verbatim from the source story.
     * At least one AC is required — a story with zero ACs is malformed
     * and is refused at parse time. (FR13)
     */
    acceptance_criteria: z
      .array(
        z.object({ text: z.string().min(1), kind: z.enum(["integration", "unit"]) }),
      )
      .min(1),

    /**
     * Human-readable story title. Required in v1 so operators can identify
     * manifests at a glance in their editor.
     */
    title: z.string().min(1),

    /**
     * "As a / I want / so that" paragraph. Carried verbatim from source.
     */
    narrative: z.string().min(1),

    /**
     * Optional free-text implementation notes from the source story.
     * Omitted from YAML when `undefined` (use `omitUndefined: true` or
     * strip undefined-keyed pairs before stringifying).
     */
    implementation_notes: z.string().optional(),

    /**
     * `false` for new manifests written by `scan-sources`. Story 3.6
     * (`/plan` discard flow) flips this to `true`. On idempotent re-scan,
     * `scan-sources` does NOT overwrite an existing `true` value.
     */
    withdrawn: z.boolean().default(false),
  })
  .strict();

export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;

/**
 * Canonical reader for execution manifests.
 *
 * **Every future reader MUST go through this helper.** Callers should never
 * call `ExecutionManifestSchema.parse` / `.safeParse` directly because this
 * helper is the only place that maps Zod validation failures to the typed
 * `MalformedExecutionManifestError` that downstream tooling (Story 3.5,
 * Story 4.x) pattern-matches against.
 *
 * @param input - The raw parsed YAML object (result of `yaml.parse(rawText)`).
 * @param opts.absPath - Absolute path to the manifest file, for error context.
 * @throws {MalformedExecutionManifestError} When `input` fails schema
 *   validation (missing required field, wrong type, unknown key, etc.).
 */
export function parseExecutionManifest(
  input: unknown,
  opts: { absPath: string },
): ExecutionManifest {
  const result = ExecutionManifestSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const yamlPath = issue.path.length === 0 ? "(root)" : issue.path.join(".");
    throw new MalformedExecutionManifestError({
      absPath: opts.absPath,
      yamlPath,
      zodMessage: issue.message,
      schemaModule: "mcp-server/src/schemas/execution-manifest.ts",
    });
  }
  return result.data;
}
