/**
 * Unit tests for isMcpDisconnectError (Story 5.30, Task 2.3).
 *
 * Verifies:
 *   - matches every known SDK disconnect-surface phrase (positive)
 *   - returns false for unrelated DomainError / Error / nullish inputs (negative)
 *   - tolerates any error shape without throwing
 */
import { describe, it, expect } from "vitest";
import { isMcpDisconnectError } from "../detect-mcp-disconnect.js";
import { DomainError, ManifestNotFoundError } from "../../errors.js";
describe("isMcpDisconnectError — positive matches", () => {
    it("matches 'tools no longer available' (case-insensitive)", () => {
        const err = new Error("Tools no longer available on this connection");
        expect(isMcpDisconnectError(err)).toBe(true);
    });
    it("matches 'MCP server has disconnected'", () => {
        const err = new Error("MCP server has disconnected");
        expect(isMcpDisconnectError(err)).toBe(true);
    });
    it("matches 'connection closed'", () => {
        const err = new Error("Transport: connection closed unexpectedly");
        expect(isMcpDisconnectError(err)).toBe(true);
    });
    it("matches 'transport closed'", () => {
        const err = new Error("transport closed before initialize completed");
        expect(isMcpDisconnectError(err)).toBe(true);
    });
    it("matches a plain-string thrown value", () => {
        expect(isMcpDisconnectError("MCP server disconnected mid-call")).toBe(true);
    });
});
describe("isMcpDisconnectError — negative matches", () => {
    it("returns false for a generic Error with unrelated message", () => {
        const err = new Error("ENOENT: no such file");
        expect(isMcpDisconnectError(err)).toBe(false);
    });
    it("returns false for a typed DomainError subclass", () => {
        const err = new ManifestNotFoundError({
            ref: "foo",
            expectedAbsPath: "/tmp/nope.yaml",
            fromState: "in-progress",
        });
        // ManifestNotFoundError's message does not contain any disconnect phrase
        // — confirm the detector is specific to the SDK's surface, not the
        // generic "error" class.
        expect(isMcpDisconnectError(err)).toBe(false);
    });
    it("returns false for an arbitrary DomainError instance", () => {
        class CustomError extends DomainError {
        }
        const err = new CustomError("validation failed: field missing");
        expect(isMcpDisconnectError(err)).toBe(false);
    });
    it("returns false for null", () => {
        expect(isMcpDisconnectError(null)).toBe(false);
    });
    it("returns false for undefined", () => {
        expect(isMcpDisconnectError(undefined)).toBe(false);
    });
    it("returns false for an object with no message", () => {
        expect(isMcpDisconnectError({ code: "BAD" })).toBe(false);
    });
    it("returns false for a number / boolean", () => {
        expect(isMcpDisconnectError(42)).toBe(false);
        expect(isMcpDisconnectError(true)).toBe(false);
    });
});
