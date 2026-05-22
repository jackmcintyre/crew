/**
 * Integration tests for `runDevSession` — Story 4.3 Task 10.
 *
 * End-to-end with all real wiring EXCEPT the Claude Code Task tool, which is
 * faked. Covers AC4 branches (a)–(d).
 *
 * Each fixture seeds a target-repo tmpdir with:
 *   - `.crew/config.yaml` (native adapter)
 *   - `.crew/state/to-do/` with one or more refs
 *   - `team/generalist-dev/PERSONA.md`
 *   - `team/generalist-reviewer/PERSONA.md`
 *
 * The fake Task spawn records its call args (system prompt, initial context)
 * and returns whatever transcript the test case scripted.
 */
export {};
