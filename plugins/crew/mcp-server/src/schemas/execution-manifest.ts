import { z } from "zod";
import { MalformedExecutionManifestError } from "../errors.js";

/**
 * Zod schema for execution manifests.
 *
 * **Producer:** `scan-sources.ts` is the only writer that creates manifests.
 *   - New source stories → `to-do/<ref>.yaml` with `status: "to-do"`.
 *   - Discipline violations → `blocked/<ref>.yaml` with `status: "blocked"`
 *     and the `blocked_by` / `discipline_violations` fields populated
 *     (Story 3.5 Task 6.2).
 *
 * **Consumer:** Every future reader MUST go through `parseExecutionManifest`
 * rather than calling `ExecutionManifestSchema.parse` directly.
 *
 * **Status vocabulary:** This schema accepts `"to-do"` and `"blocked"`.
 * Future stories that need to parse `in-progress/` or `done/` manifests
 * should extend this schema rather than add a separate one.
 *
 * **Strict mode:** `.strict()` is intentional — unknown keys are rejected so
 * additive future fields force a coordinated schema bump rather than silent
 * acceptance via Zod's default `strip` mode.
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
     * Manifest status. `"to-do"` for normal scan-sources output;
     * `"blocked"` for discipline-violation blocked manifests (Story 3.5 Task 6.2).
     */
    status: z.enum(["to-do", "blocked"]),

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

    /**
     * When set, names the reason the manifest was placed in `blocked/`
     * instead of `to-do/`. Only populated for blocked manifests.
     * Forward-compat: a string fallback is included for future block reasons
     * beyond `"planning-discipline"` and `"source-drift"`.
     *
     * Added in Story 3.5 Task 6.2.
     */
    blocked_by: z
      .union([z.literal("planning-discipline"), z.literal("source-drift"), z.string()])
      .optional(),

    /**
     * Structured violation list for manifests blocked by `planning-discipline`.
     * Shape matches `DisciplineViolationReason` from `adapters/adapter.ts`.
     * Absent on all non-blocked manifests.
     *
     * Added in Story 3.5 Task 6.2.
     */
    discipline_violations: z
      .array(
        z.object({
          code: z.string().min(1),
          field: z.string().min(1),
          detail: z.string().min(1),
        }),
      )
      .optional(),
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
