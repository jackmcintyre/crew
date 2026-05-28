/**
 * Story 5.32 — SDK-compatible Transport that wraps a net.Socket.
 *
 * The MCP SDK's `StdioServerTransport` reads JSON-RPC messages from
 * `process.stdin` (line-delimited per `shared/stdio.js#ReadBuffer`) and writes
 * them to `process.stdout`. Path D2 detaches the daemon from the host's stdio,
 * so the daemon now reads/writes JSON-RPC frames over a unix socket instead.
 *
 * `SocketServerTransport` is the SDK Transport contract reimplemented over a
 * `net.Socket`. Framing is identical to stdio (newline-delimited JSON via
 * `ReadBuffer` / `serializeMessage` — the same primitives the SDK uses) so
 * the proxy can pure-byte-forward between Claude Code's stdio and this
 * transport without inspecting messages.
 *
 * Lifecycle:
 *   - `start()` wires the socket's 'data' / 'error' / 'close' listeners.
 *   - `send(msg)` serializes and writes; awaits drain on backpressure.
 *   - `close()` removes listeners and ends the socket.
 *
 * One transport per accepted connection. The daemon calls
 * `server.connect(new SocketServerTransport(sock))` inside the
 * `startSocketServer` `onConnection` hook.
 */
import type { Socket } from "node:net";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
export declare class SocketServerTransport implements Transport {
    private readonly _socket;
    private readonly _readBuffer;
    private _started;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
    constructor(socket: Socket);
    start(): Promise<void>;
    private _processReadBuffer;
    close(): Promise<void>;
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
}
