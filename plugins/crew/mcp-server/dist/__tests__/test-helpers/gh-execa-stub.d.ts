/**
 * Shared `gh` execa stub factory for integration tests.
 *
 * Extracted from `run-reviewer-session.test.ts` (Story 4.6 Issue 2).
 * Extended in Story 4.6b to support `gh pr view --json baseRepository`
 * and `gh api` routing.
 *
 * Story 4.6b Task 8.2
 */
export interface GhStubResult {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
}
export interface GhExecaStubOpts {
    /** Override for `gh pr diff <prNumber>` calls. Default: empty diff, exitCode 0. */
    prDiff?: GhStubResult;
    /** Override for `gh pr view --json baseRepository` calls. Default: crew repo JSON, exitCode 0. */
    prView?: GhStubResult;
    /** Override for `gh api ...` calls. Default: { id: 12345 }, exitCode 0. */
    api?: GhStubResult;
    /** Override for `pnpm vitest ...` calls. Default: exitCode 0. */
    vitest?: GhStubResult;
    /**
     * Capture callback for `gh api` calls — receives the `input` option
     * so tests can JSON-parse and assert the request body shape.
     */
    onApiCall?: (input: string | undefined, args: string[]) => void;
}
/**
 * Build a discriminating `execaImpl` stub for integration tests that need
 * to mock `gh` calls (pr diff, pr view, api) and optionally `pnpm vitest`.
 *
 * Routes by `cmd` and `args[0..1]`:
 *   - `cmd === "gh" && args[0] === "pr" && args[1] === "diff"` → prDiff response
 *   - `cmd === "gh" && args[0] === "pr" && args[1] === "view"` → prView response
 *   - `cmd === "gh" && args[0] === "api"` → api response (+ fires onApiCall)
 *   - `cmd === "pnpm"` → vitest response
 */
export declare function makeGhExecaStub(opts?: GhExecaStubOpts): typeof import("execa").execa;
