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
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

export class SocketServerTransport implements Transport {
  private readonly _socket: Socket;
  private readonly _readBuffer = new ReadBuffer();
  private _started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(socket: Socket) {
    this._socket = socket;
  }

  async start(): Promise<void> {
    if (this._started) {
      throw new Error("SocketServerTransport already started!");
    }
    this._started = true;

    this._socket.on("data", (chunk: Buffer) => {
      this._readBuffer.append(chunk);
      this._processReadBuffer();
    });
    this._socket.on("error", (err: Error) => {
      this.onerror?.(err);
    });
    this._socket.on("close", () => {
      this._readBuffer.clear();
      this.onclose?.();
    });
  }

  private _processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (err) {
        this.onerror?.(err as Error);
      }
    }
  }

  async close(): Promise<void> {
    this._socket.removeAllListeners("data");
    this._socket.removeAllListeners("error");
    this._socket.removeAllListeners("close");
    this._readBuffer.clear();
    this._socket.end();
    this.onclose?.();
  }

  send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    return new Promise((resolve) => {
      const json = serializeMessage(message);
      if (this._socket.write(json)) {
        resolve();
      } else {
        this._socket.once("drain", resolve);
      }
    });
  }
}
