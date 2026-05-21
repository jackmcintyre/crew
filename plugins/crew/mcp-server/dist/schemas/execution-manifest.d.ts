import { z } from "zod";
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
export declare const ExecutionManifestSchema: z.ZodObject<{
    ref: z.ZodString;
    status: z.ZodEnum<{
        "to-do": "to-do";
        blocked: "blocked";
    }>;
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
    blocked_by: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"planning-discipline">, z.ZodLiteral<"source-drift">, z.ZodString]>>;
    discipline_violations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        field: z.ZodString;
        detail: z.ZodString;
    }, z.core.$strip>>>;
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
