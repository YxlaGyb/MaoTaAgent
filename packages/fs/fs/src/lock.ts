import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CallError } from "@maota/plugin-kit";

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

const chains = new Map<string, Promise<unknown>>();

let pending = 0;

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

function lockIsStale(lock: string): boolean {
  const stats = statSync(lock, { throwIfNoEntry: false });
  if (stats === undefined) return true;
  if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) return true;
  let pid = 0;
  try {
    pid = Number.parseInt(readFileSync(lock, "utf8").split("\n")[0] ?? "", 10);
  } catch {
    return true;
  }
  return !alive(pid);
}

function acrossProcesses<T>(path: string, work: () => T | Promise<T>): T | Promise<T> {
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(dirname(path), { recursive: true });
  for (;;) {
    try {
      const handle = openSync(lock, "wx", 0o600);
      try {
        writeSync(handle, `${process.pid}\n${Date.now()}`);
      } finally {
        closeSync(handle);
      }
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    if (lockIsStale(lock)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new CallError(-32603, `${path} stayed locked for ${LOCK_WAIT_MS}ms; another writer is busy`);
    }
    pause(25);
  }
  const done = (): void => {
    rmSync(lock, { force: true });
  };
  try {
    const result = work();
    if (result instanceof Promise) return result.finally(done);
    done();
    return result;
  } catch (error) {
    done();
    throw error;
  }
}

/// One writer at a time for a path: inside this process the calls queue on a
/// promise keyed by the resolved path, and across processes they queue on a
/// `<file>.lock` created with `wx` and holding the pid of the writer. A lock
/// whose owner is gone, or that is older than the stale window, is taken over;
/// one still held when the wait window runs out is an error rather than a
/// half-written file. The lock releases itself whichever way `work` ends.
export function withFileLock<T>(path: string, work: () => T | Promise<T>): Promise<T> {
  const key = resolve(path);
  const previous = chains.get(key) ?? Promise.resolve();
  pending += 1;
  const run = previous.then(() => acrossProcesses(key, work));
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  // The count comes down in a handler attached before the caller is handed the
  // promise, so a caller that awaits the write and then asks sees zero.
  void run.then(
    () => {
      pending -= 1;
    },
    () => {
      pending -= 1;
    },
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

export function pendingFileLocks(): number {
  return pending;
}