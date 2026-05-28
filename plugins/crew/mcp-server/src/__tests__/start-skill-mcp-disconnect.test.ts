/**
 * Integration test for the MCP cascade halt seam — Story 5.30 AC4.
 *
 * Asserts:
 *   (a) the verbatim halt line is present in the start SKILL.md file
 *   (b) `isMcpDisconnectError` returns true on the SDK's disconnect-text error
 *   (c) `McpDisconnectedError` carries the expected `methodName`, `causeMessage`,
 *       and optional `ref` fields
 *   (d) a wrapper around a stub MCP boundary halts after the disconnect —
 *       no further MCP calls attempted after the typed error is raised
 *
 * Follows the spy-harness precedent set by `start-skill-blocked-recovery.test.ts`.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpDisconnectedError } from "../errors.js";
import { isMcpDisconnectError } from "../lib/detect-mcp-disconnect.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD_PATH = path.resolve(HERE, "..", "..", "..", "skills", "start", "SKILL.md");

const HALT_LINE =
  `[mcp-cascade-halted] MCP child killed by subagent Task termination — ` +
  `restart Claude Code and re-run /crew:start. The in-progress manifest will ` +
  `surface as an orphan; choose "reattach" to resume without losing work.`;

// ---------------------------------------------------------------------------
// (a) Halt line present in SKILL.md
// ---------------------------------------------------------------------------

describe("AC4(a) — verbatim halt line present in SKILL.md", () => {
  it("SKILL.md contains the exact halt line", async () => {
    const body = await fs.readFile(SKILL_MD_PATH, "utf8");
    expect(body).toContain(HALT_LINE);
  });

  it("SKILL.md references McpDisconnectedError as a failure mode", async () => {
    const body = await fs.readFile(SKILL_MD_PATH, "utf8");
    expect(body).toContain("McpDisconnectedError");
  });

  it("SKILL.md references the project memory for the cascade RCA", async () => {
    const body = await fs.readFile(SKILL_MD_PATH, "utf8");
    expect(body).toContain("project_mcp_cascade_sigterm");
  });
});

// ---------------------------------------------------------------------------
// (b) isMcpDisconnectError detects SDK surface
// ---------------------------------------------------------------------------

describe("AC4(b) — isMcpDisconnectError matches the SDK surface", () => {
  it("matches 'tools no longer available'", () => {
    const err = new Error("Tools no longer available on this transport");
    expect(isMcpDisconnectError(err)).toBe(true);
  });

  it("matches 'MCP server has disconnected'", () => {
    const err = new Error("MCP server has disconnected");
    expect(isMcpDisconnectError(err)).toBe(true);
  });

  it("does not match generic errors", () => {
    expect(isMcpDisconnectError(new Error("validation failed"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) McpDisconnectedError carries expected fields
// ---------------------------------------------------------------------------

describe("AC4(c) — McpDisconnectedError carries expected fields", () => {
  it("populates methodName, causeMessage, ref", () => {
    const err = new McpDisconnectedError({
      methodName: "processDevTranscript",
      causeMessage: "MCP server has disconnected",
      ref: "5-30-mcp-cascade-halt-seam-and-lifecycle-diagnostics",
    });
    expect(err.methodName).toBe("processDevTranscript");
    expect(err.causeMessage).toBe("MCP server has disconnected");
    expect(err.ref).toBe("5-30-mcp-cascade-halt-seam-and-lifecycle-diagnostics");
    expect(err.message).toContain("processDevTranscript");
    expect(err.message).toContain("MCP server has disconnected");
    expect(err.name).toBe("McpDisconnectedError");
  });

  it("ref is optional — omitted from the message when absent", () => {
    const err = new McpDisconnectedError({
      methodName: "claimNextStory",
      causeMessage: "connection closed",
    });
    expect(err.ref).toBeUndefined();
    expect(err.message).not.toContain("ref=");
  });

  it("message ends with the lifecycle-log reference for operator triage", () => {
    const err = new McpDisconnectedError({
      methodName: "runReviewerSession",
      causeMessage: "transport closed",
    });
    expect(err.message).toContain("~/.crew/mcp-lifecycle.log");
  });
});

// ---------------------------------------------------------------------------
// (d) Wrapper halts after disconnect — no further MCP calls attempted
// ---------------------------------------------------------------------------

/**
 * Minimal prose-layer wrapper analogue for testing. Mirrors the contract
 * SKILL.md prose follows: every MCP call is wrapped; on `isMcpDisconnectError`
 * the wrapper re-raises as `McpDisconnectedError`. The catch-site (the
 * inner-cycle loop) halts on this error type.
 */
async function wrapMcpCall<T>(
  methodName: string,
  ref: string | undefined,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (isMcpDisconnectError(err)) {
      const causeMessage =
        err instanceof Error ? err.message : String(err);
      throw new McpDisconnectedError({ methodName, causeMessage, ref });
    }
    throw err;
  }
}

describe("AC4(d) — wrapper halts inner cycle on disconnect", () => {
  it("re-raises as McpDisconnectedError; no further MCP calls attempted", async () => {
    const calls: string[] = [];

    // Stub MCP boundary: the first call succeeds (claimNextStory),
    // the second call throws the SDK's disconnect surface.
    async function claimNextStory(): Promise<{ ref: string }> {
      calls.push("claimNextStory");
      return { ref: "bmad:5.30" };
    }
    async function processDevTranscript(): Promise<never> {
      calls.push("processDevTranscript");
      throw new Error("MCP server has disconnected");
    }
    async function processReviewerTranscript(): Promise<never> {
      // Should NEVER be called once the cascade fires.
      calls.push("processReviewerTranscript");
      throw new Error("must not be reached");
    }

    const claimed = await wrapMcpCall(
      "claimNextStory",
      undefined,
      claimNextStory,
    );
    expect(claimed.ref).toBe("bmad:5.30");

    // Simulate the inner-cycle loop: each MCP call is wrapped.
    // The disconnect on call #2 must surface as McpDisconnectedError;
    // the loop's catch handler stops — call #3 never fires.
    let halted = false;
    let typedError: unknown = null;
    try {
      await wrapMcpCall(
        "processDevTranscript",
        claimed.ref,
        processDevTranscript,
      );
      // Only reached if the wrapper failed to throw — which would be a bug.
      await wrapMcpCall(
        "processReviewerTranscript",
        claimed.ref,
        processReviewerTranscript,
      );
    } catch (err) {
      typedError = err;
      if (err instanceof McpDisconnectedError) {
        halted = true;
      }
    }

    expect(halted).toBe(true);
    expect(typedError).toBeInstanceOf(McpDisconnectedError);
    const mcpErr = typedError as McpDisconnectedError;
    expect(mcpErr.methodName).toBe("processDevTranscript");
    expect(mcpErr.causeMessage).toBe("MCP server has disconnected");
    expect(mcpErr.ref).toBe("bmad:5.30");

    // Exactly two MCP calls attempted — the successful first one and the
    // one that disconnected. Nothing after.
    expect(calls).toEqual(["claimNextStory", "processDevTranscript"]);
  });

  it("non-disconnect errors propagate unchanged through the wrapper", async () => {
    async function boom(): Promise<never> {
      throw new Error("validation failed: missing field");
    }
    await expect(wrapMcpCall("foo", "ref", boom)).rejects.toThrow(
      "validation failed",
    );
    await expect(wrapMcpCall("foo", "ref", boom)).rejects.not.toBeInstanceOf(
      McpDisconnectedError,
    );
  });
});
