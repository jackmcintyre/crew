import { type CatalogueRole } from "../schemas/catalogue-role.js";
/**
 * Pure catalogue file parser — no IO. The caller supplies the file
 * contents and a `sourcePath` for error reporting (mirrors
 * `parseStandardsDoc`).
 *
 * Validates:
 *  - YAML frontmatter delimited by `---` lines parses cleanly.
 *  - Frontmatter matches `CatalogueRoleFrontmatterSchema`.
 *  - Body contains all four required `##` sections (`Domain`,
 *    `Mandate`, `Out of mandate`, `Prompt`).
 *
 * Throws `CatalogueRoleMalformedError` on any failure.
 */
export declare function parseCatalogueRole(raw: string, sourcePath: string): CatalogueRole;
