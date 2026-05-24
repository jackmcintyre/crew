/**
 * Shared `gh` execa stub factory for integration tests.
 *
 * Extracted from `run-reviewer-session.test.ts` (Story 4.6 Issue 2).
 * Extended in Story 4.6b to support `gh pr view --json baseRepository`
 * and `gh api` routing.
 *
 * Story 4.6b Task 8.2
 */
import { vi } from "vitest";
const DEFAULT_PR_VIEW_JSON = JSON.stringify({
    baseRepository: { name: "crew", owner: { login: "jackmcintyre" } },
});
const DEFAULT_API_RESPONSE = JSON.stringify({ id: 12345 });
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
export function makeGhExecaStub(opts = {}) {
    return vi.fn().mockImplementation(async (cmd, args, callOpts) => {
        if (cmd === "gh") {
            const sub0 = args[0];
            const sub1 = args[1];
            if (sub0 === "pr" && sub1 === "diff") {
                const r = opts.prDiff ?? {};
                return {
                    stdout: r.stdout ?? "",
                    stderr: r.stderr ?? "",
                    exitCode: r.exitCode ?? 0,
                    timedOut: r.timedOut ?? false,
                };
            }
            if (sub0 === "pr" && sub1 === "view") {
                const r = opts.prView ?? {};
                return {
                    stdout: r.stdout ?? DEFAULT_PR_VIEW_JSON,
                    stderr: r.stderr ?? "",
                    exitCode: r.exitCode ?? 0,
                    timedOut: r.timedOut ?? false,
                };
            }
            if (sub0 === "api") {
                if (opts.onApiCall) {
                    opts.onApiCall(callOpts?.input, args);
                }
                const r = opts.api ?? {};
                return {
                    stdout: r.stdout ?? DEFAULT_API_RESPONSE,
                    stderr: r.stderr ?? "",
                    exitCode: r.exitCode ?? 0,
                    timedOut: r.timedOut ?? false,
                };
            }
            // Fallback gh sub
            return { stdout: "", stderr: `unexpected gh subcommand: ${sub0}`, exitCode: 1, timedOut: false };
        }
        if (cmd === "pnpm") {
            const r = opts.vitest ?? {};
            return {
                stdout: r.stdout ?? "",
                stderr: r.stderr ?? "",
                exitCode: r.exitCode ?? 0,
                timedOut: r.timedOut ?? false,
            };
        }
        return { stdout: "", stderr: `unexpected command: ${cmd}`, exitCode: 1, timedOut: false };
    });
}
