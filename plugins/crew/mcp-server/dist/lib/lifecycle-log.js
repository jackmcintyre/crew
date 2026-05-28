/**
 * Always-on JSON-line lifecycle logger for the crew MCP server (Story 5.25).
 *
 * Writes one JSON line per event to a persistent log file so that every
 * disconnect reveals its trigger. Logging is fail-open — an unwritable log
 * path never crashes the server.
 *
 * Default log path: ~/.crew/mcp-lifecycle.log
 * Override via: CREW_MCP_LIFECYCLE_LOG env var
 * Back-compat:  CREW_MCP_DIAG env var (used as path if LIFECYCLE_LOG unset)
 *
 * References:
 *   - Story 5.25 spec: _bmad-output/implementation-artifacts/5-25-always-on-mcp-lifecycle-logging.md
 *   - Project memory: project_diag_instrumentation_pattern
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
/**
 * Create a lifecycle logger.
 *
 * Returns `{ log, logSync, close }`. `log` is fire-and-forget; `logSync` is
 * synchronous (for signal handlers). Errors in the underlying WriteStream
 * silently disable further writes without crashing.
 * `close()` flushes pending writes and ends the stream; call it from
 * `process.on('exit')` after logging the final 'exit' event.
 */
export function createLifecycleLog(opts) {
    const logPath = resolveLogPath(opts?.path);
    let disabled = false;
    let stream = null;
    // Attempt mkdir + open the stream; on any failure, set disabled.
    try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        stream = fs.createWriteStream(logPath, { flags: "a" });
        stream.on("error", () => {
            disabled = true;
            stream = null;
        });
    }
    catch {
        disabled = true;
        stream = null;
    }
    function buildLine(event, fields) {
        const line = {
            event,
            ts: Date.now(),
            pid: process.pid,
            ...fields,
        };
        return JSON.stringify(line) + "\n";
    }
    function log(event, fields) {
        if (disabled || stream === null)
            return;
        try {
            stream.write(buildLine(event, fields));
        }
        catch {
            // Fire-and-forget; swallow write errors silently.
        }
    }
    function logSync(event, fields) {
        if (disabled)
            return;
        try {
            fs.appendFileSync(logPath, buildLine(event, fields));
        }
        catch {
            // Synchronous best-effort; swallow errors silently.
        }
    }
    function close() {
        if (stream !== null) {
            try {
                stream.end();
            }
            catch {
                // Best-effort close; ignore errors.
            }
            stream = null;
        }
    }
    return { log, logSync, close };
}
/**
 * Resolve the log file path from options or environment variables.
 *
 * Priority:
 *   1. opts.path (explicit caller override — used in tests)
 *   2. CREW_MCP_LIFECYCLE_LOG env var
 *   3. CREW_MCP_DIAG env var (back-compat: if set, use its value as path)
 *   4. Default: ~/.crew/mcp-lifecycle.log
 */
function resolveLogPath(explicitPath) {
    if (explicitPath)
        return explicitPath;
    const envPath = process.env["CREW_MCP_LIFECYCLE_LOG"] ?? process.env["CREW_MCP_DIAG"];
    if (envPath)
        return envPath;
    return path.join(os.homedir(), ".crew", "mcp-lifecycle.log");
}
