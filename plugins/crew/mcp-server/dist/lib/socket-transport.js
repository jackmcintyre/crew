import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
export class SocketServerTransport {
    _socket;
    _readBuffer = new ReadBuffer();
    _started = false;
    onclose;
    onerror;
    onmessage;
    constructor(socket) {
        this._socket = socket;
    }
    async start() {
        if (this._started) {
            throw new Error("SocketServerTransport already started!");
        }
        this._started = true;
        this._socket.on("data", (chunk) => {
            this._readBuffer.append(chunk);
            this._processReadBuffer();
        });
        this._socket.on("error", (err) => {
            this.onerror?.(err);
        });
        this._socket.on("close", () => {
            this._readBuffer.clear();
            this.onclose?.();
        });
    }
    _processReadBuffer() {
        while (true) {
            try {
                const message = this._readBuffer.readMessage();
                if (message === null)
                    break;
                this.onmessage?.(message);
            }
            catch (err) {
                this.onerror?.(err);
            }
        }
    }
    async close() {
        this._socket.removeAllListeners("data");
        this._socket.removeAllListeners("error");
        this._socket.removeAllListeners("close");
        this._readBuffer.clear();
        this._socket.end();
        this.onclose?.();
    }
    send(message, _options) {
        return new Promise((resolve) => {
            const json = serializeMessage(message);
            if (this._socket.write(json)) {
                resolve();
            }
            else {
                this._socket.once("drain", resolve);
            }
        });
    }
}
