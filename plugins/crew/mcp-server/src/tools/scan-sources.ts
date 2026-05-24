import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { SourceStory } from "../adapters/adapter.js";
import { MalformedExecutionManifestError } from "../errors.js";
import { writeManagedFile } from "../lib/managed-fs.js";
import {
  ExecutionManifestSchema,
  parseExecutionManifest,
} from "../schemas/execution-manifest.js";
import type { ExecutionManifest } from "../schemas/execution-manifest.js";
import { STATE_NAMES, type StateName } from "../state/manifest-state-machine.js";
import { resolveWorkspace } from "../state/workspace-resolver.js";

/**
 * Result returned by `scanSources`. All five ref arrays are disjoint.
 *
 * - `createdRefs`: manifests that did not exist before this scan (AC1 path).
 * - `updatedRefs`: manifests still in `to-do/` whose `source_hash` was
 *   refreshed because the source story changed (AC3 path).
 * - `unchangedRefs`: manifests in `to-do/` with a matching hash — no write
 *   performed (AC2 idempotent path).
 * - `skippedRefs`: refs the adapter listed but the tool deliberately did NOT
 *   touch. `reason: "not-in-to-do"` means the manifest already exists in
 *   another state dir (in-progress, blocked, done) — the dev loop owns it
 *   there, or a prior scan already blocked it. `reason: "discipline-violation"`
 *   means this scan just created a new blocked manifest for the first time.
 * - `blockedRefs`: refs that failed discipline in THIS scan and had a manifest
 *   written to `blocked/` for the first time (Story 3.5 Task 6.3). Overlaps
 *   with `skippedRefs[reason: "discipline-violation"]` by design — `skippedRefs`
 *   is the legacy seam, `blockedRefs` is the new operator-facing surface. On
 *   the second scan after a story is blocked, it appears in skippedRefs with
 *   `reason: "not-in-to-do"` (blocked manifests are owned state, not touched).
 * - `warnings`: structured per-file warnings emitted during this scan (Story 3.8
 *   AC3). Each entry names the path and the issue. The scan CONTINUES after
 *   emitting a warning — warnings do NOT halt the run.
 */
export interface ScanResult {
  targetRepoRoot: string;
  adapterName: string;
  createdRefs: string[];
  updatedRefs: string[];
  unchangedRefs: string[];
  skippedRefs: Array<{
    ref: string;
    reason: "not-in-to-do" | "discipline-violation";
    detail?: string;
  }>;
  /** Story 3.5: refs that failed planning-discipline and were written to blocked/. */
  blockedRefs: string[];
  /**
   * Story 3.8 AC3: per-file warnings emitted during the scan (e.g. unknown
   * Status values). The scan continues after a warning — it does NOT halt.
   */
  warnings: Array<{ path: string; message: string }>;
}

/**
 * Render a `ScanResult` as a human-readable text summary.
 * The tool returns this string verbatim; the `/crew:scan` skill
 * prints it without paraphrase or omission.
 */
export function renderScanResult(result: ScanResult): string {
  const lines: string[] = [
    `scan-sources completed for ${result.targetRepoRoot}`,
    `adapter: ${result.adapterName}`,
    ``,
    `created:   ${result.createdRefs.length} ref(s)${result.createdRefs.length > 0 ? " — " + result.createdRefs.join(", ") : ""}`,
    `updated:   ${result.updatedRefs.length} ref(s)${result.updatedRefs.length > 0 ? " — " + result.updatedRefs.join(", ") : ""}`,
    `unchanged: ${result.unchangedRefs.length} ref(s)${result.unchangedRefs.length > 0 ? " — " + result.unchangedRefs.join(", ") : ""}`,
  ];

  // Omit discipline-violation refs from the skipped line when they are already
  // named in the blocked line — they're the same refs and printing both causes
  // confusion about whether they're separate problems.
  const blockedRefSet = new Set(result.blockedRefs ?? []);
  const skippedForDisplay = result.skippedRefs.filter(
    (s) => !(s.reason === "discipline-violation" && blockedRefSet.has(s.ref)),
  );
  if (skippedForDisplay.length > 0) {
    lines.push(
      `skipped:   ${skippedForDisplay.length} ref(s) — ` +
        skippedForDisplay
          .map((s) => `${s.ref} (${s.reason}${s.detail ? ": " + s.detail : ""})`)
          .join(", "),
    );
  } else {
    lines.push(`skipped:   0 ref(s)`);
  }

  // Story 3.5 Task 6.3: blocked refs line (operator-facing surface).
  // A blocked ref here is the operator's cue to fix the source story
  // (add an integration AC, declare missing depends_on, etc.) and re-run /crew:scan.
  if ((result.blockedRefs ?? []).length > 0) {
    lines.push(
      `blocked:   ${result.blockedRefs.length} ref(s) — ` +
        result.blockedRefs.join(", ") +
        ` (planning-discipline violation — fix the source story and re-run /crew:scan)`,
    );
  } else {
    lines.push(`blocked:   0 ref(s)`);
  }

  // Story 3.8 AC3: structured warnings (e.g. unknown Status values).
  if ((result.warnings ?? []).length > 0) {
    lines.push(``);
    lines.push(`warnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      lines.push(`  [warn] ${w.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Check whether a path exists on disk; returns null if not found.
 */
async function statOrNull(absPath: string): Promise<ReturnType<typeof fs.stat> | null> {
  try {
    return await fs.stat(absPath);
  } catch {
    return null;
  }
}

/**
 * Compute the repo-relative path from `rawPath` if it falls strictly inside
 * `targetRepoRoot`; otherwise return the absolute path as-is.
 * Avoids leaking absolute paths into committed manifests.
 */
function repoRelativePath(rawPath: string, targetRepoRoot: string): string {
  const rel = path.relative(targetRepoRoot, rawPath);
  // If `rel` starts with ".." or is absolute, the path escapes the repo root.
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return rawPath;
  }
  return rel;
}

/**
 * Strip keys with `undefined` values from a plain object before YAML
 * stringification. Prevents `implementation_notes: ~` appearing in on-disk
 * YAML when the field is absent in the source story.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Compose a new `ExecutionManifest` object from a `SourceStory`.
 * Validates through the schema defensively — catches coding mistakes in
 * the composer before writing to disk.
 */
function composeManifest(
  story: SourceStory,
  adapterName: string,
  targetRepoRoot: string,
): ExecutionManifest {
  const raw = stripUndefined({
    ref: story.ref,
    status: "to-do" as const,
    adapter: adapterName,
    source_path: repoRelativePath(story.raw_path, targetRepoRoot),
    source_hash: story.source_hash,
    depends_on: story.depends_on,
    acceptance_criteria: story.acceptance_criteria,
    title: story.title,
    narrative: story.narrative,
    implementation_notes: story.implementation_notes,
    withdrawn: false,
  });
  // Defensive parse — throws if the composer produced an invalid shape.
  return ExecutionManifestSchema.parse(raw);
}

/**
 * Project the active adapter's source stories into per-story execution
 * manifests under `<targetRepoRoot>/.crew/state/to-do/<ref>.yaml`.
 *
 * **Idempotency (AC2 / NFR10):** On a re-scan with no source changes, this
 * function writes nothing. "Not rewritten" is load-bearing: the dev loop's
 * polling semantics detect work by mtime changes. Re-writing byte-identical
 * content would produce spurious mtime updates and corrupt the polling.
 *
 * **Hash-refresh (AC3):** If a source story's hash changed AND its manifest
 * is still in `to-do/`, the manifest is rewritten with the new hash and
 * updated `source_path`. All other fields (including any operator hand-edits
 * to `narrative`, `acceptance_criteria`, or `withdrawn`) are preserved.
 *
 * **Claim isolation (AC3 negative):** Manifests in `in-progress/`, `blocked/`,
 * or `done/` are NEVER touched. They are owned by the dev loop / orchestrator.
 * `scan-sources` only ever writes into `to-do/`.
 *
 * **Concurrency:** v1 assumes at most one `scan-sources` invocation per
 * target repo at a time. The MCP server is single-process; concurrent
 * invocations are out of scope. Do NOT add a lock here — see Story 4.x's
 * claim flow for the locking design.
 *
 * **`validateAgainstDiscipline` seam:** The call at step 3 is a documented
 * seam for Story 3.5. In v1, every adapter's implementation is pass-through
 * (returns the input story unchanged). Story 3.5 will make some adapters
 * return a `DisciplineViolation` — at that point the `skippedRefs` path
 * with `reason: "discipline-violation"` will light up without any change to
 * this file.
 */
export async function scanSources(opts: { targetRepoRoot: string }): Promise<ScanResult> {
  // Step 1: Resolve the workspace. Throws on misconfiguration.
  const workspace = await resolveWorkspace({ targetRepoRoot: opts.targetRepoRoot });
  const { activeAdapter, activeAdapterName, adapterConfig, targetRepoRoot } = workspace;

  // Step 2: List source stories from the active adapter.
  const sourceStories = await activeAdapter.listSourceStories();

  const result: ScanResult = {
    targetRepoRoot,
    adapterName: activeAdapterName,
    createdRefs: [],
    updatedRefs: [],
    unchangedRefs: [],
    skippedRefs: [],
    blockedRefs: [],
    warnings: [],
  };

  const stateRoot = path.join(targetRepoRoot, ".crew", "state");

  // Startup guard: resolve any refs that appear in both to-do/ and blocked/
  // simultaneously. This can occur if a previous blocked→to-do promotion wrote
  // the to-do manifest successfully but the subsequent unlink of the blocked
  // manifest failed (non-atomic write sequence). When both exist, to-do/ wins —
  // delete the stale blocked/ manifest and log a warning so the operator is
  // aware of the recovery. This guard prevents the inconsistency from persisting
  // across subsequent scans.
  {
    const toDoDir = path.join(stateRoot, "to-do");
    const blockedDir = path.join(stateRoot, "blocked");
    let toDoFiles: string[] = [];
    let blockedFiles: string[] = [];
    try {
      toDoFiles = await fs.readdir(toDoDir);
    } catch {
      // Directory may not exist yet on a fresh repo — not an error.
    }
    try {
      blockedFiles = await fs.readdir(blockedDir);
    } catch {
      // Directory may not exist yet on a fresh repo — not an error.
    }
    const toDoRefs = new Set(toDoFiles.filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)));
    for (const blockedFile of blockedFiles) {
      if (!blockedFile.endsWith(".yaml")) continue;
      const ref = blockedFile.slice(0, -5);
      if (toDoRefs.has(ref)) {
        console.warn(
          `[scanSources] Ref ${ref} exists in both to-do/ and blocked/ — recovering by removing stale blocked/ manifest (to-do/ wins).`,
        );
        await fs.unlink(path.join(blockedDir, blockedFile));
      }
    }
  }

  // Step 3 + 4 + 5: For each story, check presence map, validate discipline,
  // then branch on create/blocked-create/update/unchanged/skip.
  //
  // IMPORTANT: The presence check happens FIRST (before discipline). This
  // preserves the "scan does not touch claimed work" invariant for ALL state
  // dirs including `blocked/`. A story already in blocked/ (from a prior scan)
  // is treated as claimed and skipped with reason "not-in-to-do", exactly like
  // stories in in-progress/ or done/. Only if no manifest exists anywhere does
  // the discipline check run and potentially write to blocked/.
  for (const story of sourceStories) {
    // Step 3: Check which state dir this ref's manifest lives in, if any.
    let currentState: StateName | null = null;
    for (const stateName of STATE_NAMES) {
      const absPath = path.join(stateRoot, stateName, `${story.ref}.yaml`);
      const s = await statOrNull(absPath);
      if (s !== null) {
        currentState = stateName;
        break;
      }
    }

    // Step 4: Handle manifests that exist outside to-do/.
    //
    // - in-progress/ or done/: the dev loop owns it — skip unconditionally.
    // - blocked/: re-run the discipline validator. If the source story has been
    //   fixed (validator now passes), promote to to-do/ and delete the blocked
    //   manifest. If it still fails, rewrite the blocked manifest to record the
    //   latest source_hash and updated violations. This is the remediation flow
    //   described in README-install.md § Planning-discipline enforcement.
    if (currentState === "in-progress" || currentState === "done") {
      result.skippedRefs.push({
        ref: story.ref,
        reason: "not-in-to-do",
      });
      continue;
    }

    if (currentState === "blocked") {
      // Read the existing blocked manifest to check whether the source has changed.
      const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
      const rawBlocked = await fs.readFile(absBlockedPath, "utf8");
      const parsedBlocked = yamlParse(rawBlocked) as Record<string, unknown>;
      const existingBlockedHash = parsedBlocked["source_hash"] as string | undefined;

      if (existingBlockedHash === story.source_hash) {
        // Source unchanged — no need to re-evaluate. Skip quietly.
        result.skippedRefs.push({ ref: story.ref, reason: "not-in-to-do" });
        continue;
      }

      // Source hash changed (operator edited the story) — re-run discipline.
      const disciplineResult = activeAdapter.validateAgainstDiscipline(story);
      if (!("kind" in disciplineResult) || disciplineResult.kind !== "discipline-violation") {
        // Story now passes discipline — promote from blocked/ to to-do/.
        // NOTE: This sequence is non-atomic: the to-do/ manifest is written
        // first, then the blocked/ manifest is deleted. If the unlink fails
        // (e.g. a mid-flight crash or permission error), both manifests will
        // exist simultaneously. The startup guard above detects and recovers
        // this state on the next scan (to-do/ wins, blocked/ is deleted).
        const absToDoPathNew = path.join(stateRoot, "to-do", `${story.ref}.yaml`);
        const manifest = composeManifest(story, activeAdapterName, targetRepoRoot);
        const yamlText = yamlStringify(manifest, { lineWidth: 0 });
        await writeManagedFile({
          absPath: absToDoPathNew,
          contents: yamlText,
          targetRepoRoot,
          mcpToolContext: { toolName: "scanSources", role: "operator" },
        });
        await fs.unlink(absBlockedPath);
        result.createdRefs.push(story.ref);
      } else {
        // Still failing — rewrite the blocked manifest with updated hash and violations.
        const blockedManifestRaw = stripUndefined({
          ref: story.ref,
          status: "blocked" as const,
          adapter: activeAdapterName,
          source_path: repoRelativePath(story.raw_path, targetRepoRoot),
          source_hash: story.source_hash,
          depends_on: story.depends_on,
          acceptance_criteria: story.acceptance_criteria,
          title: story.title,
          narrative: story.narrative,
          implementation_notes: story.implementation_notes,
          withdrawn: false,
          blocked_by: "planning-discipline" as const,
          discipline_violations: disciplineResult.violations.map((v) => ({
            code: v.code,
            field: v.field,
            detail: v.detail,
          })),
        });
        const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
        const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
        await writeManagedFile({
          absPath: absBlockedPath,
          contents: yamlText,
          targetRepoRoot,
          mcpToolContext: { toolName: "scanSources", role: "operator" },
        });
        const firstViolation = disciplineResult.violations[0];
        result.skippedRefs.push({
          ref: story.ref,
          reason: "discipline-violation",
          detail: firstViolation?.detail,
        });
        result.blockedRefs.push(story.ref);
      }
      continue;
    }

    // Step 4b: Story 3.8 AC3 — status-vocabulary-unknown gate.
    // If the parser flagged an unknown Status value, route the story to blocked/
    // immediately (before discipline). The scan continues — no throw.
    const statusUnknown = story.raw_frontmatter["status_unknown"] as
      | { raw: string; reason: string }
      | undefined;
    if (statusUnknown !== undefined && currentState === null) {
      const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
      const blockedManifestRaw = stripUndefined({
        ref: story.ref,
        status: "blocked" as const,
        adapter: activeAdapterName,
        source_path: repoRelativePath(story.raw_path, targetRepoRoot),
        source_hash: story.source_hash,
        depends_on: story.depends_on,
        acceptance_criteria: story.acceptance_criteria,
        title: story.title,
        narrative: story.narrative,
        implementation_notes: story.implementation_notes,
        withdrawn: false,
        blocked_by: "status-vocabulary-unknown" as string,
      });
      const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
      const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
      await writeManagedFile({
        absPath: absBlockedPath,
        contents: yamlText,
        targetRepoRoot,
        mcpToolContext: { toolName: "scanSources", role: "operator" },
      });
      result.blockedRefs.push(story.ref);
      result.skippedRefs.push({
        ref: story.ref,
        reason: "discipline-violation",
        detail: `status-vocabulary-unknown: "${statusUnknown.raw}"`,
      });
      const warnMessage =
        `Story \`${story.ref}\` at \`${story.raw_path}\` has a Status value (\`${statusUnknown.raw}\`) ` +
        `that is not one of the known BMad statuses (backlog, ready-for-dev, in-progress, done, optional, contexted). ` +
        `The story has been blocked with reason \`status-vocabulary-unknown\` so the scan can continue. ` +
        `Edit the spec's Status line or remove it (Status defaults to \`backlog\`) and re-run /crew:scan.`;
      result.warnings.push({ path: story.raw_path, message: warnMessage });
      console.warn(`[scanSources] ${warnMessage}`);
      continue;
    }

    // Step 5: validateAgainstDiscipline (Story 3.5 — real enforcement).
    // Only runs when no manifest exists anywhere (currentState === null) or
    // when the manifest is already in to-do/ (currentState === "to-do").
    // For the to-do case, discipline is a no-op (the story already passed
    // discipline at first scan). For the null case, this is the gate.
    if (currentState === null) {
      const disciplineResult = activeAdapter.validateAgainstDiscipline(story);
      if ("kind" in disciplineResult && disciplineResult.kind === "discipline-violation") {
        const firstViolation = disciplineResult.violations[0];
        result.skippedRefs.push({
          ref: story.ref,
          reason: "discipline-violation",
          detail: firstViolation?.detail,
        });

        // Write a blocked manifest into blocked/ (Task 6.1).
        const blockedManifestRaw = stripUndefined({
          ref: story.ref,
          status: "blocked" as const,
          adapter: activeAdapterName,
          source_path: repoRelativePath(story.raw_path, targetRepoRoot),
          source_hash: story.source_hash,
          depends_on: story.depends_on,
          acceptance_criteria: story.acceptance_criteria,
          title: story.title,
          narrative: story.narrative,
          implementation_notes: story.implementation_notes,
          withdrawn: false,
          blocked_by: "planning-discipline" as const,
          discipline_violations: disciplineResult.violations.map((v) => ({
            code: v.code,
            field: v.field,
            detail: v.detail,
          })),
        });
        const blockedManifest = ExecutionManifestSchema.parse(blockedManifestRaw);
        const absBlockedPath = path.join(stateRoot, "blocked", `${story.ref}.yaml`);
        const yamlText = yamlStringify(blockedManifest, { lineWidth: 0 });
        await writeManagedFile({
          absPath: absBlockedPath,
          contents: yamlText,
          targetRepoRoot,
          mcpToolContext: { toolName: "scanSources", role: "operator" },
        });
        result.blockedRefs.push(story.ref);
        continue;
      }
    }

    // Step 6: Branch on to-do presence.
    const absToDoPath = path.join(stateRoot, "to-do", `${story.ref}.yaml`);

    if (currentState === null) {
      // CREATE path (AC1): no manifest exists anywhere and discipline passed.
      const manifest = composeManifest(story, activeAdapterName, targetRepoRoot);
      const yamlText = yamlStringify(manifest, { lineWidth: 0 });
      await writeManagedFile({
        absPath: absToDoPath,
        contents: yamlText,
        targetRepoRoot,
        mcpToolContext: { toolName: "scanSources", role: "operator" },
      });
      result.createdRefs.push(story.ref);
    } else if (currentState === "to-do") {
      // UPDATE or UNCHANGED path (AC2/AC3): manifest is in to-do/.
      const rawText = await fs.readFile(absToDoPath, "utf8");
      let existingManifest: ExecutionManifest;
      try {
        const parsed = yamlParse(rawText) as unknown;
        existingManifest = parseExecutionManifest(parsed, { absPath: absToDoPath });
      } catch (err) {
        // Propagate MalformedExecutionManifestError (AC5) — let the tool handler return isError.
        if (err instanceof MalformedExecutionManifestError) {
          throw err;
        }
        throw err;
      }

      if (existingManifest.source_hash !== story.source_hash) {
        // Hash changed → rewrite with new hash and source_path; preserve all other fields.
        // Operator hand-edits to narrative, acceptance_criteria, withdrawn etc. are preserved
        // per Story 3.7's hand-edit allowance.
        const updatedManifest = {
          ...existingManifest,
          source_hash: story.source_hash,
          source_path: repoRelativePath(story.raw_path, targetRepoRoot),
        };
        const yamlText = yamlStringify(stripUndefined(updatedManifest as Record<string, unknown>), {
          lineWidth: 0,
        });
        await writeManagedFile({
          absPath: absToDoPath,
          contents: yamlText,
          targetRepoRoot,
          mcpToolContext: { toolName: "scanSources", role: "operator" },
        });
        result.updatedRefs.push(story.ref);
      } else {
        // Hash matches → no-op (AC2 idempotency).
        result.unchangedRefs.push(story.ref);
      }
    }
    // Note: the else branch for currentState not null and not "to-do" is handled
    // in Step 4 above (before discipline check) — those refs are already skipped.
  }

  return result;
}
