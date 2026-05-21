import { z } from "zod";
/**
 * Content-level Zod schema for native-story body files (Story 3.4 Task 2.4).
 *
 * Asserts the four required sections are present in canonical order:
 *   1. `## Narrative`
 *   2. `## Acceptance Criteria`
 *   3. `## Implementation Notes` (optional)
 *   4. `## Dependencies` (optional)
 *
 * This schema operates on the *parsed* representation returned by
 * `parseNativeStory`, not the raw markdown. Use it for round-trip validation
 * (e.g. asserting that a rendered story body re-parses cleanly) rather than
 * for arbitrary markdown linting.
 *
 * @see _bmad-output/implementation-artifacts/3-4-native-adapter-planner-subagent-and-plan-skill.md § Task 2
 */
export declare const NativeAcSchema: z.ZodObject<{
    text: z.ZodString;
    kind: z.ZodEnum<{
        integration: "integration";
        unit: "unit";
    }>;
}, z.core.$strip>;
export declare const NativeStorySchema: z.ZodObject<{
    ref: z.ZodString;
    title: z.ZodString;
    narrative: z.ZodString;
    acceptance_criteria: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        kind: z.ZodEnum<{
            integration: "integration";
            unit: "unit";
        }>;
    }, z.core.$strip>>;
    depends_on: z.ZodArray<z.ZodString>;
    implementation_notes: z.ZodOptional<z.ZodString>;
    raw_path: z.ZodString;
    raw_frontmatter: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    source_hash: z.ZodString;
}, z.core.$strip>;
export type NativeStory = z.infer<typeof NativeStorySchema>;
