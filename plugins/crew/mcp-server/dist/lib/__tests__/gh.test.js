/**
 * Unit tests for gh.ts extensions added by Story 4.4.
 * Covers: negative-capability refusal for --no-verify, --force,
 * --force-with-lease, --force-with-lease=<ref>.
 * (Story 4.4 Task 1.2 / Task 1.4 / AC2)
 */
import { describe, expect, it, vi } from "vitest";
import { gh } from "../gh.js";
import { NegativeCapabilityDeniedError, GhSubcommandDeniedError } from "../../errors.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePermissions(overrides) {
    return {
        role: "generalist-dev",
        tools_allow: ["runDevTerminalAction"],
        gh_allow: ["pr-create", "pr-view"],
        gh_allow_args: {},
        sourcePath: "/fake/permissions/generalist-dev.yaml",
        ...overrides,
    };
}
function makeOkStub() {
    return vi.fn(async () => ({
        stdout: "https://github.com/owner/repo/pull/1",
        stderr: "",
        exitCode: 0,
    }));
}
// ---------------------------------------------------------------------------
// Negative-capability refusal (Task 1.2 / Task 1.4 / AC2)
// ---------------------------------------------------------------------------
describe("gh wrapper — negative-capability refusal (Task 1.2 / AC2)", () => {
    const permissions = makePermissions();
    it("Task 1.4: refuses --no-verify BEFORE spawn and throws NegativeCapabilityDeniedError", async () => {
        const spy = vi.fn();
        await expect(gh({
            role: "generalist-dev",
            permissions,
            subcommand: "pr-create",
            args: ["--no-verify", "--title", "foo", "--body", "bar"],
            execaImpl: spy,
        })).rejects.toBeInstanceOf(NegativeCapabilityDeniedError);
        expect(spy).not.toHaveBeenCalled();
    });
    it("Task 1.4: refuses --force BEFORE spawn", async () => {
        const spy = vi.fn();
        await expect(gh({
            role: "generalist-dev",
            permissions,
            subcommand: "pr-create",
            args: ["--force"],
            execaImpl: spy,
        })).rejects.toBeInstanceOf(NegativeCapabilityDeniedError);
        expect(spy).not.toHaveBeenCalled();
    });
    it("Task 1.4: refuses --force-with-lease BEFORE spawn", async () => {
        const spy = vi.fn();
        await expect(gh({
            role: "generalist-dev",
            permissions,
            subcommand: "pr-create",
            args: ["--force-with-lease"],
            execaImpl: spy,
        })).rejects.toBeInstanceOf(NegativeCapabilityDeniedError);
        expect(spy).not.toHaveBeenCalled();
    });
    it("Task 1.4: refuses --force-with-lease=refs/heads/main BEFORE spawn", async () => {
        const spy = vi.fn();
        await expect(gh({
            role: "generalist-dev",
            permissions,
            subcommand: "pr-create",
            args: ["--force-with-lease=refs/heads/main"],
            execaImpl: spy,
        })).rejects.toBeInstanceOf(NegativeCapabilityDeniedError);
        expect(spy).not.toHaveBeenCalled();
    });
    it("negative-capability check runs AFTER gh_allow (denied subcommand still surfaces as GhSubcommandDeniedError)", async () => {
        const spy = vi.fn();
        // "push" is not in gh_allow → GhSubcommandDeniedError
        await expect(gh({
            role: "generalist-dev",
            permissions,
            subcommand: "push",
            args: ["--no-verify"],
            execaImpl: spy,
        })).rejects.toBeInstanceOf(GhSubcommandDeniedError);
        expect(spy).not.toHaveBeenCalled();
    });
    it("happy path: allowed subcommand with clean args proceeds to spawn", async () => {
        const spy = makeOkStub();
        const result = await gh({
            role: "generalist-dev",
            permissions,
            subcommand: "pr-create",
            args: ["--title", "My PR", "--body", "body text"],
            execaImpl: spy,
        });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.exitCode).toBe(0);
    });
});
