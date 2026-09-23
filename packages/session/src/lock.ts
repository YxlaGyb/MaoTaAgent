/// The serial chain that keeps one key's work in order, and the on-disk lock a
/// document is guarded by across processes. A lock whose owner is gone, or that
/// is older than the stale window, is taken over; one still held when the wait
/// runs out is an error, never an interleave.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { CallError } from "@maota/plugin-kit";

import { warn } from "./document.ts";

const chains = new Map<string, Promise<unknown>>();

export function serially<T>(key: string, work: () => T): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

export function pendingWrites(): number {
  return chains.size;
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

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

/// A document is guarded across processes, not only inside this one. The lock
/// is a sibling file created with `wx`, so a second host pointed at the same
/// `$MAOTA_HOME` waits its turn instead of renaming over a write it never read.
/// A lock whose owner is gone, or that is older than the stale window, is taken
/// over; one still held when the wait window runs out is an error, never an
/// interleave.
export function withLock<T>(path: string, work: () => T): T {
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
      try {
        return work();
      } finally {
        rmSync(lock, { force: true });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    if (lockIsStale(lock)) {
      warn(`session document ${path} held a lock left behind by another writer; taking it over`);
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new CallError(-32603, `session document stayed locked for ${LOCK_WAIT_MS}ms; another writer is busy`);
    }
    pause(25);
  }
}
