import { parse as yamlParse } from "yaml";
import { CatalogueRoleMalformedError } from "../errors.js";
import { CatalogueRoleFrontmatterSchema, REQUIRED_CATALOGUE_SECTIONS, } from "../schemas/catalogue-role.js";
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
export function parseCatalogueRole(raw, sourcePath) {
    // Normalise CRLF, strip BOM. Mirrors parse-bmad-story.ts.
    const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    // Frontmatter must be the first non-empty content, opened by a `---`
    // line at file start and closed by another `---` line.
    if (!text.startsWith("---\n") && !text.startsWith("---\r")) {
        throw new CatalogueRoleMalformedError({
            sourcePath,
            zodMessage: "file must start with '---' YAML frontmatter opener",
        });
    }
    const closeIdx = text.indexOf("\n---", 4);
    if (closeIdx === -1) {
        throw new CatalogueRoleMalformedError({
            sourcePath,
            zodMessage: "missing closing '---' YAML frontmatter delimiter",
        });
    }
    const frontmatterRaw = text.slice(4, closeIdx);
    // Body starts after the closing fence + its newline.
    const afterFence = text.slice(closeIdx + 4);
    const body = afterFence.replace(/^\s*\n/, "");
    let parsedYaml;
    try {
        parsedYaml = yamlParse(frontmatterRaw);
    }
    catch (err) {
        throw new CatalogueRoleMalformedError({
            sourcePath,
            zodMessage: `frontmatter YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
    const result = CatalogueRoleFrontmatterSchema.safeParse(parsedYaml);
    if (!result.success) {
        throw new CatalogueRoleMalformedError({
            sourcePath,
            zodMessage: formatZodIssues(result.error.issues),
        });
    }
    const sections = extractSections(body);
    const missing = REQUIRED_CATALOGUE_SECTIONS.filter((s) => !(s in sections));
    if (missing.length > 0) {
        throw new CatalogueRoleMalformedError({
            sourcePath,
            zodMessage: `missing required '##' section(s): ${missing.join(", ")}`,
        });
    }
    return {
        ...result.data,
        sections: sections,
        sourcePath,
    };
}
/**
 * Walk the body line-by-line and collect `## <Heading>` sections.
 * Returns a map from heading text to the joined body lines (with
 * leading / trailing blank lines trimmed). Only top-level `##`
 * headings split sections — `###` and deeper are part of the
 * enclosing `##` section.
 */
function extractSections(body) {
    const lines = body.split("\n");
    const out = {};
    let currentHeading = null;
    let currentBody = [];
    const flush = () => {
        if (currentHeading !== null) {
            out[currentHeading] = currentBody.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
        }
    };
    for (const line of lines) {
        const match = /^##\s+(.+?)\s*$/.exec(line);
        if (match && !line.startsWith("###")) {
            flush();
            currentHeading = match[1].trim();
            currentBody = [];
        }
        else if (currentHeading !== null) {
            currentBody.push(line);
        }
    }
    flush();
    // Narrow to only the required heading set; extra `##` sections are
    // ignored by the schema (the four required headings must be present
    // but a future catalogue file is free to add more).
    const filtered = {};
    for (const required of REQUIRED_CATALOGUE_SECTIONS) {
        if (required in out)
            filtered[required] = out[required] ?? "";
    }
    return filtered;
}
function formatZodIssues(issues) {
    const first = issues[0];
    if (!first)
        return "(no issue details)";
    const dottedPath = first.path.length > 0 ? first.path.join(".") : "<root>";
    return `${dottedPath}: ${first.message}`;
}
