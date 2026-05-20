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
];
