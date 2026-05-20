import { z } from "zod";

/**
 * Catalogue role file schema (FR82, FR83; architecture
 * Implementation-patterns-consistency-rules §3).
 *
 * Catalogue files live at `plugins/<plugin>/catalogue/<role>.md`. Each
 * file is plain Markdown with YAML frontmatter; the frontmatter shape
 * is fixed by this schema and the body must contain the four canonical
 * `##` sections (`Domain`, `Mandate`, `Out of mandate`, `Prompt`).
 *
 * `.strict()` rejects unknown keys at every level — typos must fail
 * loudly. Persona files (Story 2.3) extend this shape by adding
 * `hired_at` / `catalogue_version` frontmatter and a `## Knowledge`
 * section; persona schema is intentionally NOT defined here.
 *
 * `role` regex enforces kebab-case (consistent with `RolePermissionsSchema`).
 * `domain` is the routing key for FR99 / FR98 — exact-match string.
 *
 * `locked_phrases` carries the three load-bearing strings (handoff /
 * yield / verdict) that the dev/reviewer loops grep against (FR98,
 * FR40a). Missing any of the three is a contract violation.
 */
export const ModelTierSchema = z.enum(["opus", "sonnet", "haiku"]);

export const LockedPhrasesSchema = z
  .object({
    handoff: z.string().min(1),
    yield: z.string().min(1),
    verdict: z.string().min(1),
  })
  .strict();

export const CatalogueRoleFrontmatterSchema = z
  .object({
    role: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    domain: z.string().min(1),
    model_tier: ModelTierSchema,
    tools_allow: z.array(z.string().min(1)).min(1),
    gh_allow: z.array(z.string().min(1)).default([]),
    locked_phrases: LockedPhrasesSchema,
  })
  .strict();

export type CatalogueRoleFrontmatter = z.infer<typeof CatalogueRoleFrontmatterSchema>;

/**
 * The four required `##` section names in a catalogue file body, in
 * the canonical order they appear. The parser tolerates extra sections
 * after `Prompt` but the four required headings must be present.
 */
export const REQUIRED_CATALOGUE_SECTIONS = [
  "Domain",
  "Mandate",
  "Out of mandate",
  "Prompt",
] as const;

export type RequiredCatalogueSection = (typeof REQUIRED_CATALOGUE_SECTIONS)[number];

/**
 * Parsed catalogue role. The frontmatter is Zod-typed; the body
 * sections are returned as a `Map<sectionHeading, bodyText>` so the
 * caller can pull `Prompt` out for persona-prompt assembly (Story 2.3)
 * without re-parsing the file.
 *
 * `sourcePath` is stamped on after parsing; it is NOT part of the
 * on-disk contract.
 */
export type CatalogueRole = {
  role: string;
  domain: string;
  model_tier: z.infer<typeof ModelTierSchema>;
  tools_allow: string[];
  gh_allow: string[];
  locked_phrases: z.infer<typeof LockedPhrasesSchema>;
  sections: Record<RequiredCatalogueSection, string>;
  sourcePath: string;
};
