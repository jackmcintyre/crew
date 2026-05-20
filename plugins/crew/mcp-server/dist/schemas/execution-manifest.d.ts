import { z } from "zod";
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
export declare const ExecutionManifestSchema: z.ZodObject<{
    ref: z.ZodString;
    status: z.ZodLiteral<"to-do">;
    adapter: z.ZodString;
    source_path: z.ZodString;
    source_hash: z.ZodString;
    depends_on: z.ZodDefault<z.ZodArray<z.ZodString>>;
    acceptance_criteria: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        kind: z.ZodEnum<{
            integration: "integration";
            unit: "unit";
        }>;
    }, z.core.$strip>>;
    title: z.ZodString;
    narrative: z.ZodString;
    implementation_notes: z.ZodOptional<z.ZodString>;
    withdrawn: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
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
export declare function parseExecutionManifest(input: unknown, opts: {
    absPath: string;
}): ExecutionManifest;
