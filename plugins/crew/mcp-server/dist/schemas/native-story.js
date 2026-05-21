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
export const NativeAcSchema = z.object({
    text: z.string().min(1, "AC text must be non-empty"),
    kind: z.enum(["integration", "unit"]),
});
export const NativeStorySchema = z.object({
    ref: z
        .string()
        .regex(/^native:[0-9A-HJKMNP-TV-Z]{26}$/, "ref must match 'native:<ULID>'"),
    title: z.string().min(1, "title must be non-empty"),
    narrative: z.string().min(1, "narrative must be non-empty"),
    acceptance_criteria: z
        .array(NativeAcSchema)
        .min(1, "at least one AC is required"),
    depends_on: z.array(z.string().regex(/^(native:[0-9A-HJKMNP-TV-Z]{26}|bmad:\d+\.\d+)$/, "depends_on entries must be 'native:<ULID>' or 'bmad:<epic>.<story>'")),
    implementation_notes: z.string().optional(),
    raw_path: z.string().min(1),
    raw_frontmatter: z.record(z.string(), z.unknown()),
    source_hash: z.string().min(64).max(64),
});
