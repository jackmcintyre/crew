/**
 * Story 5.32 — AC6: daemon binds unix socket at mode 0600 under ~/.crew/.
 *
 * Asserts:
 *   - ~/.crew/ created with mode 0700
 *   - socket file at mode 0600
 *   - per-connection verify hook is wired (server.listenerCount('connection') >= 1)
 *
 * Test sets process.env.HOME = tmpdir so the real ~/.crew/ is never touched
 * (per memory `project_smoke_test_install`).
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startSocketServer } from "../lib/socket-server.js";
let tmpHome;
let server;
let prevHome;
afterEach(async () => {
    if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
        server = undefined;
    }
    if (prevHome !== undefined) {
        process.env["HOME"] = prevHome;
    }
    else {
        delete process.env["HOME"];
    }
    if (tmpHome) {
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
        tmpHome = undefined;
    }
});
describe("AC6 — daemon socket binding mode + perms", () => {
    it("creates ~/.crew/ at 0700, socket at 0600, wires verify hook", async () => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-socket-mode-"));
        prevHome = process.env["HOME"];
        process.env["HOME"] = tmpHome;
        const handles = await startSocketServer({});
        server = handles.server;
        const crewDir = path.join(tmpHome, ".crew");
        const sockPath = path.join(crewDir, "mcp-daemon.sock");
        expect(fs.existsSync(crewDir)).toBe(true);
        const dirMode = fs.statSync(crewDir).mode & 0o777;
        expect(dirMode).toBe(0o700);
        expect(fs.existsSync(sockPath)).toBe(true);
        expect(fs.statSync(sockPath).isSocket()).toBe(true);
        const sockMode = fs.statSync(sockPath).mode & 0o777;
        expect(sockMode).toBe(0o600);
        // Verify hook wired: at least one 'connection' listener.
        expect(server.listenerCount("connection")).toBeGreaterThanOrEqual(1);
    });
    it("honours opts.home over process.env.HOME and binds under that dir", async () => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "crew-socket-mode-"));
        const handles = await startSocketServer({ home: tmpHome });
        server = handles.server;
        expect(handles.sockPath.startsWith(tmpHome)).toBe(true);
        expect(fs.statSync(handles.sockPath).mode & 0o777).toBe(0o600);
    });
});
