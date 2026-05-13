/**
 * Locked output format for the `/sprint-orchestrator:run-sprint` wrapper.
 *
 * The wrapper computes a turn cap and prints a canonical `/goal` command
 * for the user to copy. To make that copy-paste trivial — and to keep the
 * skill and the e2e harness from drifting — we lock the final two lines
 * of run-sprint's stdout in this module:
 *
 *   - second-to-last non-empty line: FRESH_CONTEXT_GUIDANCE_LINE
 *   - last line: the exact /goal command, on a single line, with nothing
 *     after it except at most one trailing newline.
 *
 * Same discipline as `format-end-of-run-line.ts` and
 * `readme-adopt-phrases.ts` from prior sprints: constants here, e2e
 * asserts on them directly, SKILL.md references them so prose and
 * behaviour stay in lockstep.
 */
import { buildGoalCommand } from "./plan-run-sprint.js";

/**
 * One-line, user-facing note printed immediately above the /goal command.
 * Tells the user the cleanest place to paste it is a fresh context window
 * — a fresh transcript gives /goal a clean signal to evaluate the drain
 * condition against, free of prior conversation noise.
 */
export const FRESH_CONTEXT_GUIDANCE_LINE =
  "Paste this in a fresh context window for the cleanest run:";

/**
 * One-line note that would sit immediately above FRESH_CONTEXT_GUIDANCE_LINE
 * *if* the OSC 52 clipboard auto-copy path were active. Locked here so prose
 * and behaviour stay in lockstep, exactly like FRESH_CONTEXT_GUIDANCE_LINE.
 *
 * IMPORTANT — currently inert. The goal-adoption sprint story 2 spike
 * confirmed Claude Code's harness does NOT pass OSC 52 terminal escape
 * sequences through to the user's terminal verbatim (see
 * `_bmad-output/planning-artifacts/follow-ups.md` → "OSC 52 clipboard
 * auto-copy blocked by harness escape filtering"). So
 * `buildRunSprintFinalOutput` never emits this line today. It is kept
 * exported so a future harness change can flip the gate on with one
 * touchpoint, no string drift.
 */
export const CLIPBOARD_AUTOCOPY_NOTE_LINE =
  "(your /goal command is also copied to your clipboard — paste with Cmd+V / Ctrl+V)";

/**
 * Environment variable name for the user-facing opt-out of OSC 52 clipboard
 * auto-copy. When set to "1" or "true" (case-insensitive), no clipboard
 * escape and no clipboard note are emitted. Wired as a no-op safety today
 * because the spike failed and `buildRunSprintFinalOutput` never emits the
 * escape regardless — but the gate is in place so behaviour is predictable
 * the moment a harness change makes auto-copy viable.
 */
export const CLIPBOARD_OPT_OUT_ENV_VAR = "SPRINT_ORCHESTRATOR_NO_CLIPBOARD";

/**
 * Returns true when the user has opted out of OSC 52 clipboard auto-copy
 * via `SPRINT_ORCHESTRATOR_NO_CLIPBOARD=1` (or "true", case-insensitive).
 * Reads from the supplied env bag (defaults to `process.env`) so tests can
 * inject a fixture without mutating the real environment.
 */
export function isClipboardOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CLIPBOARD_OPT_OUT_ENV_VAR];
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
}

/**
 * Pure helper: wrap a UTF-8 payload as an OSC 52 clipboard-set escape
 * sequence. Format: `ESC ] 52 ; c ; <base64> BEL`. Exported so a future
 * harness change can switch on auto-copy with a one-line edit in
 * `buildRunSprintFinalOutput` — no string drift between the helper and the
 * emitter.
 *
 * NOTE — not invoked from `buildRunSprintFinalOutput` today. The story 2
 * spike showed Claude Code strips/escapes the ESC byte from subprocess
 * stdout, so emitting this would only leak visible `]52;c;<base64>` text
 * into the user's terminal. Kept as a pure, tested function so the
 * cost-to-revive is near zero when the harness changes.
 */
export function buildClipboardEscape(payload: string): string {
  const b64 = Buffer.from(payload, "utf8").toString("base64");
  return `\x1b]52;c;${b64}\x07`;
}

/**
 * The canonical /goal command for the wrapper, as a single line.
 *
 * Delegates to `buildGoalCommand` from plan-run-sprint so the wrapper,
 * the planner, and the e2e share one source of truth for the drain
 * condition wording. Re-exported here as `formatGoalCommandLine` so the
 * intent ("this is the literal last line of run-sprint's output") is
 * obvious at the call site.
 */
export function formatGoalCommandLine(turnCap: number): string {
  return buildGoalCommand(turnCap);
}

/**
 * Assemble the locked last-two-lines block that run-sprint MUST emit at
 * the end of its stdout. The block is intentionally returned with no
 * leading newline (the caller is expected to print a blank line above it
 * to separate from any preceding narrative) and exactly one trailing
 * newline (so the /goal line is the final non-empty line of output).
 *
 * Contract:
 *   - the last line of the returned string (after stripping the single
 *     trailing newline) is `formatGoalCommandLine(turnCap)` verbatim;
 *   - the second-to-last non-empty line is `FRESH_CONTEXT_GUIDANCE_LINE`;
 *   - the /goal line contains no embedded newlines (it is one physical
 *     line, no soft-wrap concerns for callers that respect the contract);
 *   - nothing appears after the /goal line except at most one trailing
 *     `\n`.
 */
export function buildRunSprintFinalOutput(
  turnCap: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Spike-failure path (goal-adoption sprint, story 2): Claude Code does not
  // pass OSC 52 escapes through to the terminal verbatim, so the auto-copy
  // branch is currently inert. We still read the opt-out env var so the
  // gate is wired and observable, and so the e2e can prove that setting it
  // is a perfect no-op (no OSC 52 leak, no clipboard note, /goal line still
  // the literal last line). When the harness gains escape-passthrough or a
  // clipboard primitive, flip `clipboardEnabled` to `!isClipboardOptOut(env)`
  // and the rest of this function will compose the right block.
  const _optOut = isClipboardOptOut(env); // read for predictable env-var semantics
  const clipboardEnabled = false; // hard-wired off — spike failed; see follow-ups.md
  void _optOut;

  if (clipboardEnabled) {
    // Dead code today; lives here as a single touchpoint for the future flip.
    const goalLine = formatGoalCommandLine(turnCap);
    const escape = buildClipboardEscape(goalLine);
    return `${escape}${CLIPBOARD_AUTOCOPY_NOTE_LINE}\n${FRESH_CONTEXT_GUIDANCE_LINE}\n${goalLine}\n`;
  }

  return `${FRESH_CONTEXT_GUIDANCE_LINE}\n${formatGoalCommandLine(turnCap)}\n`;
}
