/**
 * Test harness for the post-D2 (Story 5.32) MCP daemon.
 *
 * The daemon no longer reads JSON-RPC over stdio — it listens on a unix
 * socket at `~/.crew/mcp-daemon.sock` (per the Story 5.32 transport change).
 * Tests that previously piped JSON-RPC through `child.stdin`/`child.stdout`
 * now spawn the daemon with HOME pointed at a tmpdir and connect to the
 * resulting socket as a client. This helper centralises that plumbing so
 * the existing Story 5.25 assertions (lifecycle log, crash resilience,
 * keepalive, signal handling) can keep their semantics under the new
 * transport.
 *
 * Why a harness, not raw socket calls per test: every Story 5.25 test does
 * roughly the same six things (spawn daemon, wait for socket, connect,
 * initialize, sendRequest, cleanup). Pre-D2 those lived on stdio, now they
 * live on a unix socket — extracting the helper keeps each test focused on
 * its assertion.
 */
import * as cp from "node:child_process";
import * as net from "node:net";
export type JsonRpcRequest = {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: Record<string, unknown>;
};
export type JsonRpcResponse = {
    jsonrpc: "2.0";
    id: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
};
export interface DaemonHarness {
    child: cp.ChildProcess;
    socket: net.Socket;
    tmpHome: string;
    sockPath: string;
    pidPath: string;
    logPath: string;
    sendRequest(req: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse>;
    initHandshake(): Promise<void>;
    close(): Promise<void>;
}
export interface SpawnDaemonOptions {
    distIndex: string;
    /** Overrides $HOME for the spawned daemon (default: a fresh tmpdir). */
    home?: string;
    /** Path inside HOME for the lifecycle log file (default: home/.crew/lifecycle.log). */
    logPath?: string;
    /** Extra env to merge into the daemon's process.env. */
    env?: Record<string, string>;
    /** Ms to wait for the socket file to appear after spawn (default 5000). */
    socketWaitMs?: number;
}
export declare function spawnDaemonHarness(opts: SpawnDaemonOptions): Promise<DaemonHarness>;
