// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Try to connect to the daemon's socket. Resolves with the connected socket
 * on success; rejects on ENOENT / ECONNREFUSED / timeout. The caller
 * distinguishes by inspecting err.code.
 */
function connectWithTimeout(connect, sockPath, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const socket = connect(sockPath);
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            const err = new Error(`connect timeout after ${timeoutMs}ms`);
            err.code = "ETIMEDOUT";
            reject(err);
        }, timeoutMs);
        timer.unref?.();
        const onConnect = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(socket);
        };
        const onError = (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            reject(err);
        };
        socket.once("connect", onConnect);
        // Sockets returned by net.connect that are already connected (mock case)
        // may emit 'ready' instead — handle both.
        socket.once("ready", onConnect);
        socket.once("error", onError);
    });
}
/**
 * kill(pid, 0) returning truthy = alive; throwing ESRCH = dead/stale.
 */
function isDaemonAlive(kill, pid) {
    try {
        kill(pid, 0);
        return true;
    }
    catch (err) {
        const code = err.code;
        if (code === "ESRCH")
            return false;
        // EPERM = process exists but we can't signal it; treat as alive.
        if (code === "EPERM")
            return true;
        return false;
    }
}
function readPidFile(fs, pidPath) {
    try {
        fs.statSync(pidPath);
    }
    catch {
        return null;
    }
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0)
        return null;
    return pid;
}
/**
 * Acquire the flock by opening `lockPath` with O_EXCL. Returns the fd to
 * release later. If another process holds the lock, retries every
 * `retryDelayMs` until `maxWaitMs` elapses, then throws.
 */
async function acquireLock(fs, lockPath, retryDelayMs, maxWaitMs) {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
        try {
            return fs.openSync(lockPath, "wx");
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST")
                throw err;
            if (Date.now() >= deadline) {
                throw new Error(`acquireDaemon: lock ${lockPath} held > ${maxWaitMs}ms`);
            }
            await sleep(retryDelayMs);
        }
    }
}
function releaseLock(fs, fd, lockPath) {
    try {
        fs.closeSync(fd);
    }
    catch {
        /* ignore */
    }
    try {
        fs.unlinkSync(lockPath);
    }
    catch {
        /* ignore */
    }
}
function ensureCrewDir(fs, crewDir) {
    try {
        fs.mkdirSync(crewDir, { recursive: true, mode: 0o700 });
    }
    catch {
        /* ignore — directory may exist */
    }
}
// ---------------------------------------------------------------------------
// Main: acquireDaemon
// ---------------------------------------------------------------------------
/**
 * Returns a connected socket to the daemon, spawning a new daemon if needed.
 *
 * The flock around the spawn block is the only place where the proxy holds
 * synchronous global state. The fast path (daemon already up) skips the
 * flock entirely; only the spawn branch acquires it.
 */
export async function acquireDaemon(opts) {
    const { sockPath, pidPath, lockPath, crewDir, daemonCommand, daemonArgs, daemonEnv, spawn, kill, connect, fs, connectProbeTimeoutMs = 1000, connectReadyTimeoutMs = 3000, spawnSettleDelayMs = 100, lockRetryDelayMs = 50, lockMaxWaitMs = 5000, } = opts;
    ensureCrewDir(fs, crewDir);
    // --- Step 1: fast path. Is a daemon already up? ---------------------------
    const existingPid = readPidFile(fs, pidPath);
    if (existingPid !== null) {
        const alive = isDaemonAlive(kill, existingPid);
        if (alive) {
            // Try connecting; on timeout, the daemon is hung → kill it and respawn.
            try {
                const socket = await connectWithTimeout(connect, sockPath, connectProbeTimeoutMs);
                return { socket, daemonPid: existingPid, spawned: false };
            }
            catch (err) {
                const code = err.code;
                if (code === "ETIMEDOUT") {
                    // Hung daemon — SIGKILL, clear files, fall through to spawn.
                    try {
                        kill(existingPid, "SIGKILL");
                    }
                    catch {
                        /* already dead, ignore */
                    }
                    try {
                        fs.unlinkSync(pidPath);
                    }
                    catch {
                        /* ignore */
                    }
                    try {
                        fs.unlinkSync(sockPath);
                    }
                    catch {
                        /* ignore */
                    }
                }
                else if (code === "ENOENT" || code === "ECONNREFUSED") {
                    // Socket missing or daemon-not-listening; pid claims alive but
                    // the listener is gone. Best to respawn — clear files first.
                    try {
                        kill(existingPid, "SIGKILL");
                    }
                    catch {
                        /* ignore */
                    }
                    try {
                        fs.unlinkSync(pidPath);
                    }
                    catch {
                        /* ignore */
                    }
                    try {
                        fs.unlinkSync(sockPath);
                    }
                    catch {
                        /* ignore */
                    }
                }
                else {
                    throw err;
                }
            }
        }
        else {
            // Stale pidfile — daemon crashed. Clear and respawn.
            try {
                fs.unlinkSync(pidPath);
            }
            catch {
                /* ignore */
            }
            try {
                fs.unlinkSync(sockPath);
            }
            catch {
                /* ignore */
            }
        }
    }
    // --- Step 2: spawn path. Acquire flock to serialise concurrent shims. -----
    const fd = await acquireLock(fs, lockPath, lockRetryDelayMs, lockMaxWaitMs);
    try {
        // Re-check after acquiring lock: another shim may have spawned while we
        // were waiting. If the pidfile now points at a live daemon and the
        // socket connects, reuse it.
        const recheckPid = readPidFile(fs, pidPath);
        if (recheckPid !== null && isDaemonAlive(kill, recheckPid)) {
            try {
                const socket = await connectWithTimeout(connect, sockPath, connectProbeTimeoutMs);
                return { socket, daemonPid: recheckPid, spawned: false };
            }
            catch {
                // Recheck failed — fall through and spawn ourselves.
            }
        }
        // Actually spawn the daemon.
        const child = spawn(daemonCommand, daemonArgs, {
            detached: true,
            stdio: "ignore",
            env: daemonEnv ?? process.env,
        });
        if (typeof child.unref === "function")
            child.unref();
        const newPid = child.pid;
        if (!newPid) {
            throw new Error("acquireDaemon: spawned child has no pid");
        }
        // Write pidfile before connecting so subsequent shims see it.
        fs.writeFileSync(pidPath, `${newPid}\n`);
        // Settle: the daemon needs a moment to bind the socket. Retry connect
        // with a deadline rather than a single attempt.
        const deadline = Date.now() + connectReadyTimeoutMs;
        let lastErr = null;
        while (Date.now() < deadline) {
            await sleep(spawnSettleDelayMs);
            try {
                const socket = await connectWithTimeout(connect, sockPath, Math.max(50, deadline - Date.now()));
                return { socket, daemonPid: newPid, spawned: true };
            }
            catch (err) {
                lastErr = err;
                const code = err.code;
                if (code !== "ENOENT" && code !== "ECONNREFUSED" && code !== "ETIMEDOUT") {
                    throw err;
                }
            }
        }
        throw lastErr ?? new Error("acquireDaemon: daemon did not start in time");
    }
    finally {
        releaseLock(fs, fd, lockPath);
    }
}
