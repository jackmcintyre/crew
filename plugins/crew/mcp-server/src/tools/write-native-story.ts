import * as path from "node:path";
import { ulid as generateUlid } from "ulid";
import { z } from "zod";
import { WrongAdapterError } from "../errors.js";
import { parseNativeStory } from "../adapters/native/parse-native-story.js";
import { atomicWriteFile } from "../lib/managed-fs.js";
import { resolveWorkspace } from "../state/workspace-resolver.js";

/**
 * Input schema for `writeNativeStory`. Mirrors the four-section native-story
 * body shape (Story 3.4 Task 4.1).
 */
export const WriteNativeStoryInputSchema = z.object({
  targetRepoRoot: z.string().min(1),
  title: z.string().min(1),
  narrative: z.string().min(1),
  acceptance_criteria: z
    .array(
      z.object({
        text: z.string().min(1),
        kind: z.enum(["integration", "unit"]),
      }),
    )
    .min(1),
  implementation_notes: z.string().optional(),
  depends_on: z.array(z.string()),
});

export type WriteNativeStoryInput = z.infer<typeof WriteNativeStoryInputSchema>;

export interface WriteNativeStoryOutput {
  ref: string;
  path: string;
}

/**
 * Render a native-story file body from validated inputs.
 *
 * Produces the canonical four-section order:
 *   1. `## Narrative`
 *   2. `## Acceptance Criteria`
 *   3. `## Implementation Notes` (omitted if empty/absent)
 *   4. `## Dependencies`
 */
export function renderNativeStoryBody(input: WriteNativeStoryInput): string {
  const lines: string[] = [`# ${input.title}`, ""];

  // ## Narrative
  lines.push("## Narrative", "");
  lines.push(input.narrative);
  lines.push("");

  // ## Acceptance Criteria
  lines.push("## Acceptance Criteria", "");
  for (let i = 0; i < input.acceptance_criteria.length; i++) {
    const ac = input.acceptance_criteria[i]!;
    const tag = ac.kind === "integration" ? " (integration)" : "";
    lines.push(`**AC${i + 1}${tag}:**`);
    lines.push(ac.text);
    lines.push("");
  }

  // ## Implementation Notes (optional)
  if (input.implementation_notes && input.implementation_notes.trim().length > 0) {
    lines.push("## Implementation Notes", "");
    lines.push(input.implementation_notes.trim());
    lines.push("");
  }

  // ## Dependencies
  lines.push("## Dependencies", "");
  if (input.depends_on.length > 0) {
    for (const dep of input.depends_on) {
      lines.push(`- ${dep}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Write a new native-story file under `<targetRepoRoot>/.crew/native-stories/`.
 *
 * Steps:
 *   1. Resolve workspace; throw `WrongAdapterError` if not `native`.
 *   2. Generate a fresh ULID.
 *   3. Render the four-section body.
 *   4. Round-trip through `parseNativeStory()` — throw if invalid.
 *   5. Write atomically (`.tmp` + rename).
 *   6. Return `{ ref, path }`.
 *
 * @see _bmad-output/implementation-artifacts/3-4-native-adapter-planner-subagent-and-plan-skill.md § Task 4
 */
export async function writeNativeStory(
  rawInput: unknown,
): Promise<WriteNativeStoryOutput> {
  const input = WriteNativeStoryInputSchema.parse(rawInput);
  const targetRepoRoot = path.resolve(input.targetRepoRoot);

  // Resolve workspace to confirm the active adapter is `native`.
  const workspace = await resolveWorkspace({ targetRepoRoot });
  if (workspace.activeAdapterName !== "native") {
    throw new WrongAdapterError({
      expectedAdapter: "native",
      actualAdapter: workspace.activeAdapterName,
      targetRepoRoot,
    });
  }

  // Generate a fresh ULID.
  const newUlid = generateUlid();
  const storiesDir = path.join(targetRepoRoot, ".crew", "native-stories");
  const absPath = path.join(storiesDir, `${newUlid}.md`);
  const ref = `native:${newUlid}`;

  // Render the body.
  const body = renderNativeStoryBody(input);

  // Round-trip validation — throws MalformedNativeStoryError if the rendered
  // body would not parse back cleanly. This ensures the file on disk always
  // conforms to the schema.
  parseNativeStory(absPath, body);

  // Write atomically via atomicWriteFile: writes to <absPath>.tmp first, then
  // renames to <absPath> in a single fs.rename(2) syscall — atomic on the same
  // filesystem (Task 4.5). The `.crew/native-stories/` path is non-canonical
  // so no mcpToolContext is required.
  await atomicWriteFile(absPath, body);

  return { ref, path: absPath };
}
