import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

// Server-side state for the idle screen lock. A locked session id may only
// read (see proxy.ts); unlocking needs the user's password (/api/unlock).
//
// It's a small JSON file ({ [sid]: expiresAt }) rather than module state
// because proxy.ts and the route handlers are bundled separately and don't
// share memory, and the terminal server is a different process again. The
// file also means a service restart doesn't silently unlock everything.
// scripts/terminal-server.mjs reads the same file.

const FILE = resolve(process.env.SESSION_LOCK_FILE ?? ".session-locks.json");

let cache: { mtimeMs: number; size: number; locks: Record<string, number> } | null = null;

function read(): Record<string, number> {
  try {
    const st = statSync(FILE);
    if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.locks;
    const locks = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, number>;
    cache = { mtimeMs: st.mtimeMs, size: st.size, locks };
    return locks;
  } catch {
    return {}; // no file yet (nothing locked) or unreadable
  }
}

function write(locks: Record<string, number>) {
  const now = Date.now();
  for (const [sid, exp] of Object.entries(locks)) if (exp < now) delete locks[sid];
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(locks), { mode: 0o600 });
  renameSync(tmp, FILE);
  cache = null;
}

export function isLocked(sid: string): boolean {
  return sid in read();
}

export function lockSession(sid: string, expiresAt: number) {
  if (isLocked(sid)) return;
  write({ ...read(), [sid]: expiresAt });
}

export function unlockSession(sid: string) {
  const locks = { ...read() };
  if (!(sid in locks)) return;
  delete locks[sid];
  write(locks);
}

// byjohnmichael*
