import * as net from "node:net";
export interface SocketServerOptions {
    /**
     * Overrides $HOME for path resolution. Used by tests so they never touch
     * the operator's real ~/.crew/.
     */
    home?: string;
    /**
     * Called for each accepted connection. The daemon wires this to a
     * SocketServerTransport that the MCP Server connects to.
     */
    onConnection?: (socket: net.Socket) => void;
}
export interface SocketServerHandles {
    server: net.Server;
    sockPath: string;
    crewDir: string;
}
/**
 * Defence-in-depth peer-EUID check. macOS exposes LOCAL_PEEREUID via
 * `getsockopt(2)`; Node's net.Socket does not expose getsockopt directly, so
 * the check is wired as a no-op for v1.1. A follow-up story can land the
 * real call (the AC asserts the wiring, not the behaviour — Q5 verdict).
 */
export declare function verifyPeerEuid(_socket: net.Socket): boolean;
export declare function startSocketServer(opts?: SocketServerOptions): Promise<SocketServerHandles>;
