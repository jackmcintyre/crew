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
export declare const ModelTierSchema: z.ZodEnum<{
    opus: "opus";
    sonnet: "sonnet";
    haiku: "haiku";
}>;
export declare const LockedPhrasesSchema: z.ZodObject<{
    handoff: z.ZodString;
    yield: z.ZodString;
    verdict: z.ZodString;
}, z.core.$strict>;
export declare const CatalogueRoleFrontmatterSchema: z.ZodObject<{
    role: z.ZodString;
    domain: z.ZodString;
    model_tier: z.ZodEnum<{
        opus: "opus";
        sonnet: "sonnet";
        haiku: "haiku";
    }>;
    tools_allow: z.ZodArray<z.ZodString>;
    gh_allow: z.ZodDefault<z.ZodArray<z.ZodString>>;
    locked_phrases: z.ZodObject<{
        handoff: z.ZodString;
        yield: z.ZodString;
        verdict: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CatalogueRoleFrontmatter = z.infer<typeof CatalogueRoleFrontmatterSchema>;
/**
 * The four required `##` section names in a catalogue file body, in
 * the canonical order they appear. The parser tolerates extra sections
 * after `Prompt` but the four required headings must be present.
 */
export declare const REQUIRED_CATALOGUE_SECTIONS: readonly ["Domain", "Mandate", "Out of mandate", "Prompt"];
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
