/**
 * Story 5.32 — Path resolver for the mcp-proxy's daemon coordination files.
 *
 * The proxy and the daemon both need to agree on three paths under `~/.crew/`:
 *   - mcp-daemon.sock — the unix socket the daemon listens on
 *   - mcp-daemon.pid  — the daemon's pid (written by the proxy on spawn,
 *                       read by subsequent shims and the integration test)
 *   - mcp-daemon.lock — the flock the proxy holds while spawning, to serialise
 *                       concurrent-spawn races (Q4 hybrid recommendation)
 *
 * `home` is normally `process.env.HOME` but the integration test (AC3) and
 * the daemon-socket-mode test (AC6) override it to a tmpdir so the real
 * `~/.crew/` is never touched. Per memory `project_smoke_test_install`, tests
 * must not leak state into the operator's real home.
 */
import path from "node:path";
import os from "node:os";

export interface DaemonPaths {
  crewDir: string;
  sockPath: string;
  pidPath: string;
  lockPath: string;
}

export function resolveDaemonPaths(home?: string): DaemonPaths {
  const resolvedHome = home ?? process.env["HOME"] ?? os.homedir();
  const crewDir = path.join(resolvedHome, ".crew");
  return {
    crewDir,
    sockPath: path.join(crewDir, "mcp-daemon.sock"),
    pidPath: path.join(crewDir, "mcp-daemon.pid"),
    lockPath: path.join(crewDir, "mcp-daemon.lock"),
  };
}
