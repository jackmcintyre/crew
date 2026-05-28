/**
 * Story 5.32 — AC2: proxy lockfile + daemon-liveness lifecycle.
 *
 * Exercises the hybrid daemon-acquisition logic from Q4 of the spike. Five
 * cases:
 *   1. No PID file → spawn
 *   2. PID file alive + connect ok → reuse, no spawn
 *   3. PID file present + kill(0) throws ESRCH → unlink + respawn
 *   4. Concurrent acquire → one spawn, one wait-and-reuse
 *   5. Hung daemon (kill(0) ok + connect times out) → SIGKILL + respawn
 *
 * All five mock `spawn`, `kill`, `connect`, and the fs port so no real
 * processes or sockets are touched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import * as os from "node:os";
import { acquireDaemon, type FsPort, type SpawnPort, type KillPort, type ConnectPort } from "../../../mcp-proxy/src/acquire-daemon.js";

// ---------------------------------------------------------------------------
// Mock socket — emits 'connect' immediately or after a delay, or 'error' with
// ENOENT/ECONNREFUSED, or never settles (timeout case).
// ---------------------------------------------------------------------------

type MockSocketBehaviour =
  | { kind: "connect-ok"; delayMs?: number }
  | { kind: "error"; code: string }
  | { kind: "hang" };

function makeMockSocket(behaviour: MockSocketBehaviour): {
  socket: EventEmitter & { destroy: () => void };
  fire: () => void;
} {
  const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
  let destroyed = false;
  socket.destroy = (): void => {
    destroyed = true;
  };
  const fire = (): void => {
    if (destroyed) return;
    if (behaviour.kind === "connect-ok") {
      const delay = behaviour.delayMs ?? 0;
      if (delay > 0) {
        setTimeout(() => socket.emit("connect"), delay);
      } else {
        setImmediate(() => socket.emit("connect"));
      }
    } else if (behaviour.kind === "error") {
      const err = new Error(behaviour.code) as NodeJS.ErrnoException;
      err.code = behaviour.code;
      setImmediate(() => socket.emit("error", err));
    }
    // "hang" — never fire any event; the acquireDaemon timeout triggers.
  };
  return { socket, fire };
}

// ---------------------------------------------------------------------------
// Mock fs — backed by an in-memory map. Supports the subset of the FsPort
// surface that acquireDaemon uses.
// ---------------------------------------------------------------------------

interface MockFsState {
  files: Map<string, string>;
  dirs: Set<string>;
  // pidPath → whether the file represents a "stat-able" entry
}

function makeMockFs(state: MockFsState): FsPort {
  return {
    statSync(p: string): import("node:fs").Stats {
      if (state.files.has(p) || state.dirs.has(p)) {
        return {
          isFile: () => state.files.has(p),
          isDirectory: () => state.dirs.has(p),
        } as unknown as import("node:fs").Stats;
      }
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    },
    readFileSync(p: string, _enc: BufferEncoding): string {
      const v = state.files.get(p);
      if (v === undefined) {
        const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return v;
    },
    writeFileSync(p: string, data: string): void {
      state.files.set(p, data);
    },
    unlinkSync(p: string): void {
      state.files.delete(p);
    },
    openSync(p: string, flags: string): number {
      if (flags === "wx") {
        if (state.files.has(p)) {
          const err = new Error(`EEXIST: ${p}`) as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        }
        state.files.set(p, "lock");
      }
      // Return a fake fd; the test never reads from it.
      return Math.floor(Math.random() * 1_000_000);
    },
    closeSync(_fd: number): void {
      /* no-op */
    },
    mkdirSync(p: string, _opts: { recursive: boolean; mode?: number }): void {
      state.dirs.add(p);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to construct standard test opts.
// ---------------------------------------------------------------------------

function makePaths(): { sockPath: string; pidPath: string; lockPath: string; crewDir: string } {
  const root = path.join(os.tmpdir(), `acquire-test-${Math.random()}`);
  return {
    crewDir: root,
    sockPath: path.join(root, "mcp-daemon.sock"),
    pidPath: path.join(root, "mcp-daemon.pid"),
    lockPath: path.join(root, "mcp-daemon.lock"),
  };
}

function makeFakeChild(pid: number): import("node:child_process").ChildProcess {
  const cp = new EventEmitter() as import("node:child_process").ChildProcess;
  Object.defineProperty(cp, "pid", { value: pid, writable: false });
  cp.unref = vi.fn();
  return cp;
}

// ---------------------------------------------------------------------------
// Case 1: no PID file → spawn
// ---------------------------------------------------------------------------

describe("AC2 case 1 — spawns daemon when no PID file exists", () => {
  it("invokes spawn once, writes PID file, returns spawned: true", async () => {
    const state: MockFsState = { files: new Map(), dirs: new Set() };
    const fsPort = makeMockFs(state);
    const paths = makePaths();

    const spawn: SpawnPort = vi.fn(() => makeFakeChild(12345));
    const kill: KillPort = vi.fn(() => true);
    const connect: ConnectPort = vi.fn(() => {
      const { socket, fire } = makeMockSocket({ kind: "connect-ok", delayMs: 10 });
      fire();
      return socket as unknown as import("node:net").Socket;
    });

    const result = await acquireDaemon({
      ...paths,
      daemonCommand: "node",
      daemonArgs: ["daemon.js"],
      spawn,
      kill,
      connect,
      fs: fsPort,
      connectProbeTimeoutMs: 100,
      connectReadyTimeoutMs: 1000,
      spawnSettleDelayMs: 10,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.spawned).toBe(true);
    expect(result.daemonPid).toBe(12345);
    expect(state.files.get(paths.pidPath)).toBe("12345\n");
  });
});

// ---------------------------------------------------------------------------
// Case 2: PID file alive + connect ok → reuse
// ---------------------------------------------------------------------------

describe("AC2 case 2 — reuses daemon when PID file alive and connect succeeds", () => {
  it("does not spawn; returns spawned: false with existing pid", async () => {
    const state: MockFsState = { files: new Map(), dirs: new Set() };
    const paths = makePaths();
    state.files.set(paths.pidPath, "9999\n");
    const fsPort = makeMockFs(state);

    const spawn: SpawnPort = vi.fn(() => makeFakeChild(0));
    const kill: KillPort = vi.fn(() => true); // alive
    const connect: ConnectPort = vi.fn(() => {
      const { socket, fire } = makeMockSocket({ kind: "connect-ok", delayMs: 10 });
      fire();
      return socket as unknown as import("node:net").Socket;
    });

    const result = await acquireDaemon({
      ...paths,
      daemonCommand: "node",
      daemonArgs: ["daemon.js"],
      spawn,
      kill,
      connect,
      fs: fsPort,
      connectProbeTimeoutMs: 100,
      connectReadyTimeoutMs: 1000,
    });

    expect(spawn).toHaveBeenCalledTimes(0);
    expect(result.spawned).toBe(false);
    expect(result.daemonPid).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// Case 3: PID file present but kill(0) throws ESRCH → unlink + respawn
// ---------------------------------------------------------------------------

describe("AC2 case 3 — respawns when PID file is stale", () => {
  it("unlinks PID + sock, spawns new daemon", async () => {
    const state: MockFsState = { files: new Map(), dirs: new Set() };
    const paths = makePaths();
    state.files.set(paths.pidPath, "12345\n");
    state.files.set(paths.sockPath, ""); // simulate stale sock file
    const fsPort = makeMockFs(state);

    const spawn: SpawnPort = vi.fn(() => makeFakeChild(54321));
    const kill: KillPort = vi.fn(() => {
      // Always ESRCH for the stale pid
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    const connect: ConnectPort = vi.fn(() => {
      const { socket, fire } = makeMockSocket({ kind: "connect-ok", delayMs: 10 });
      fire();
      return socket as unknown as import("node:net").Socket;
    });

    const result = await acquireDaemon({
      ...paths,
      daemonCommand: "node",
      daemonArgs: ["daemon.js"],
      spawn,
      kill,
      connect,
      fs: fsPort,
      connectProbeTimeoutMs: 100,
      connectReadyTimeoutMs: 1000,
      spawnSettleDelayMs: 10,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.spawned).toBe(true);
    expect(result.daemonPid).toBe(54321);
    // PID file rewritten with the new pid
    expect(state.files.get(paths.pidPath)).toBe("54321\n");
  });
});

// ---------------------------------------------------------------------------
// Case 4: concurrent acquire → exactly one spawn across both calls
// ---------------------------------------------------------------------------

describe("AC2 case 4 — concurrent acquire calls result in exactly one spawn", () => {
  it("two parallel acquire calls: one spawns, the other waits and reuses", async () => {
    const state: MockFsState = { files: new Map(), dirs: new Set() };
    const paths = makePaths();
    const fsPort = makeMockFs(state);

    let spawnCount = 0;
    const spawn: SpawnPort = vi.fn(() => {
      spawnCount++;
      // After spawning, the second caller should find the pidfile and reuse.
      // The pidfile gets written by acquireDaemon AFTER spawn returns, so we
      // simulate the daemon settling: the next connect succeeds.
      return makeFakeChild(77777);
    });

    // kill returns true once the pidfile is written (first call's daemon is alive).
    const kill: KillPort = vi.fn(() => true);

    const connect: ConnectPort = vi.fn(() => {
      const { socket, fire } = makeMockSocket({ kind: "connect-ok", delayMs: 5 });
      fire();
      return socket as unknown as import("node:net").Socket;
    });

    const baseOpts = {
      ...paths,
      daemonCommand: "node",
      daemonArgs: ["daemon.js"],
      spawn,
      kill,
      connect,
      fs: fsPort,
      connectProbeTimeoutMs: 100,
      connectReadyTimeoutMs: 1000,
      spawnSettleDelayMs: 5,
      lockRetryDelayMs: 5,
      lockMaxWaitMs: 5000,
    };

    const [r1, r2] = await Promise.all([
      acquireDaemon(baseOpts),
      acquireDaemon(baseOpts),
    ]);

    expect(spawnCount).toBe(1);
    // Exactly one call returns spawned: true; the other returns spawned: false.
    const spawnedFlags = [r1.spawned, r2.spawned].sort();
    expect(spawnedFlags).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// Case 5: hung daemon (kill(0) alive + connect times out) → SIGKILL + respawn
// ---------------------------------------------------------------------------

describe("AC2 case 5 — hung daemon: kill(0) alive + connect timeout → SIGKILL + respawn", () => {
  it("calls SIGKILL on hung pid, unlinks files, spawns new daemon", async () => {
    const state: MockFsState = { files: new Map(), dirs: new Set() };
    const paths = makePaths();
    state.files.set(paths.pidPath, "55555\n");
    state.files.set(paths.sockPath, ""); // stale sock file
    const fsPort = makeMockFs(state);

    const killCalls: { pid: number; sig: number | NodeJS.Signals }[] = [];
    const kill: KillPort = vi.fn((pid, sig) => {
      killCalls.push({ pid, sig });
      // For the liveness check (sig===0) say alive; for SIGKILL no-op.
      return true;
    });

    let connectCallCount = 0;
    const connect: ConnectPort = vi.fn(() => {
      connectCallCount++;
      // First connect: hang. Second connect (after respawn): succeed.
      if (connectCallCount === 1) {
        const { socket, fire } = makeMockSocket({ kind: "hang" });
        fire();
        return socket as unknown as import("node:net").Socket;
      }
      const { socket, fire } = makeMockSocket({ kind: "connect-ok", delayMs: 5 });
      fire();
      return socket as unknown as import("node:net").Socket;
    });

    const spawn: SpawnPort = vi.fn(() => makeFakeChild(66666));

    const result = await acquireDaemon({
      ...paths,
      daemonCommand: "node",
      daemonArgs: ["daemon.js"],
      spawn,
      kill,
      connect,
      fs: fsPort,
      connectProbeTimeoutMs: 100,
      connectReadyTimeoutMs: 2000,
      spawnSettleDelayMs: 5,
    });

    // The proxy must have SIGKILLed the hung daemon (the pid 55555) at least once.
    expect(killCalls.some((c) => c.pid === 55555 && c.sig === "SIGKILL")).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.spawned).toBe(true);
    expect(result.daemonPid).toBe(66666);
  });
});
