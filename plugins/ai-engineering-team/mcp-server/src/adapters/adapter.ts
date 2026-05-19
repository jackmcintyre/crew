/**
 * Planning-adapter contract.
 *
 * Story 1.1 ships the interface only (with an empty `BmadAdapter`).
 * Story 3.1 wires up the registry and `getActiveAdapter()`.
 * Story 3.3 lands the real `BmadAdapter` methods.
 */
export interface PlanningAdapter {
  name: string;
  detect(targetRepo: string): Promise<boolean>;
  listSourceStories(): Promise<SourceStory[]>;
  readSourceStory(ref: string): Promise<SourceStory>;
  resolveSourcePath(ref: string): string;
  watchForChanges?(): AsyncIterable<ChangeEvent>;
}

export type AC = { text: string; kind: "integration" | "unit" };

export type SourceStory = {
  ref: string;
  title: string;
  narrative: string;
  acceptance_criteria: AC[];
  depends_on: string[];
  implementation_notes?: string;
  raw_path: string;
  raw_frontmatter: Record<string, unknown>;
  source_hash: string;
};

export type ChangeEvent =
  | { kind: "added"; ref: string }
  | { kind: "edited"; ref: string; new_hash: string }
  | { kind: "removed"; ref: string };
