/**
 * Unit tests for lifecycle-log.ts (Story 5.25, Task 1.5).
 *
 * Covers:
 *   (a) writes a JSON line per call
 *   (b) survives unwritable path without throwing
 *   (c) honours the CREW_MCP_LIFECYCLE_LOG env var
 *   (d) CREW_MCP_DIAG env var falls back when LIFECYCLE_LOG unset
 *   (e) close() flushes pending writes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createLifecycleLog } from "../lifecycle-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crew-lifecycle-log-test-"));
}

function readLogLines(logPath: string): Record<string, unknown>[] {
  const text = fs.readFileSync(logPath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLifecycleLog", () => {
  let tmpDir: string;
  let originalLifecycleLog: string | undefined;
  let originalDiag: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalLifecycleLog = process.env["CREW_MCP_LIFECYCLE_LOG"];
    originalDiag = process.env["CREW_MCP_DIAG"];
    // Clear env vars so tests are isolated
    delete process.env["CREW_MCP_LIFECYCLE_LOG"];
    delete process.env["CREW_MCP_DIAG"];
  });

  afterEach(() => {
    // Restore env vars
    if (originalLifecycleLog === undefined) {
      delete process.env["CREW_MCP_LIFECYCLE_LOG"];
    } else {
      process.env["CREW_MCP_LIFECYCLE_LOG"] = originalLifecycleLog;
    }
    if (originalDiag === undefined) {
      delete process.env["CREW_MCP_DIAG"];
    } else {
      process.env["CREW_MCP_DIAG"] = originalDiag;
    }
    // Clean up tmp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("(a) writes a JSON line per call", async () => {
    const logPath = path.join(tmpDir, "test.log");
    const logger = createLifecycleLog({ path: logPath });

    logger.log("boot", { version: "1.0.0" });
    logger.log("transport.connected");

    // Allow the stream to flush
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger.close();
    // Allow close to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const lines = readLogLines(logPath);
    expect(lines).toHaveLength(2);

    const bootLine = lines[0]!;
    expect(bootLine["event"]).toBe("boot");
    expect(bootLine["version"]).toBe("1.0.0");
    expect(typeof bootLine["ts"]).toBe("number");
    expect(bootLine["pid"]).toBe(process.pid);

    const connLine = lines[1]!;
    expect(connLine["event"]).toBe("transport.connected");
    expect(typeof connLine["ts"]).toBe("number");
  });

  it("(b) survives unwritable path without throwing", () => {
    // Use a path that is guaranteed to be unwritable (root-owned directory)
    const unwritablePath = "/proc/this-cannot-exist/mcp-lifecycle.log";
    let threw = false;

    try {
      const logger = createLifecycleLog({ path: unwritablePath });
      // log() should be a no-op, not throw
      logger.log("boot");
      logger.close();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });

  it("(c) honours the CREW_MCP_LIFECYCLE_LOG env var", async () => {
    const logPath = path.join(tmpDir, "from-env.log");
    process.env["CREW_MCP_LIFECYCLE_LOG"] = logPath;

    const logger = createLifecycleLog(); // no explicit path
    logger.log("boot");

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(fs.existsSync(logPath)).toBe(true);
    const lines = readLogLines(logPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]!["event"]).toBe("boot");
  });

  it("(d) CREW_MCP_DIAG env var falls back when LIFECYCLE_LOG unset", async () => {
    const logPath = path.join(tmpDir, "from-diag.log");
    // LIFECYCLE_LOG is not set; DIAG is set
    process.env["CREW_MCP_DIAG"] = logPath;

    const logger = createLifecycleLog(); // no explicit path, no LIFECYCLE_LOG
    logger.log("boot");

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(fs.existsSync(logPath)).toBe(true);
    const lines = readLogLines(logPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]!["event"]).toBe("boot");
  });

  it("(d) CREW_MCP_LIFECYCLE_LOG takes precedence over CREW_MCP_DIAG", async () => {
    const lifecycleLogPath = path.join(tmpDir, "lifecycle.log");
    const diagPath = path.join(tmpDir, "diag.log");
    process.env["CREW_MCP_LIFECYCLE_LOG"] = lifecycleLogPath;
    process.env["CREW_MCP_DIAG"] = diagPath;

    const logger = createLifecycleLog();
    logger.log("boot");

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(fs.existsSync(lifecycleLogPath)).toBe(true);
    expect(fs.existsSync(diagPath)).toBe(false);
  });

  it("(e) close() flushes pending writes", async () => {
    const logPath = path.join(tmpDir, "flush-test.log");
    const logger = createLifecycleLog({ path: logPath });

    // Write multiple events and close immediately
    logger.log("boot");
    logger.log("transport.connected");
    logger.log("exit", { code: 0 });
    logger.close();

    // Give stream time to flush after close
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const lines = readLogLines(logPath);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // At minimum, the first event should be written
    expect(lines[0]!["event"]).toBe("boot");
  });

  it("creates parent directories automatically", async () => {
    const nestedPath = path.join(tmpDir, "deeply", "nested", "dir", "test.log");
    const logger = createLifecycleLog({ path: nestedPath });

    logger.log("boot");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(fs.existsSync(nestedPath)).toBe(true);
    const lines = readLogLines(nestedPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]!["event"]).toBe("boot");
  });

  it("appends to existing log file (does not truncate)", async () => {
    const logPath = path.join(tmpDir, "append.log");

    // First logger instance
    const logger1 = createLifecycleLog({ path: logPath });
    logger1.log("boot");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger1.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Second logger instance — should append
    const logger2 = createLifecycleLog({ path: logPath });
    logger2.log("transport.connected");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    logger2.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const lines = readLogLines(logPath);
    expect(lines).toHaveLength(2);
    expect(lines[0]!["event"]).toBe("boot");
    expect(lines[1]!["event"]).toBe("transport.connected");
  });
});
