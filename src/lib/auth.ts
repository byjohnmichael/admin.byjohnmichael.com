import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// Signed session cookies. A session is "<expiresAt>.<username>.<sid>.<hmac>",
// where the HMAC (keyed by SESSION_SECRET) covers the expiry, the user and a
// random session id, so none can be edited client-side. The sid is what the
// screen lock (sessionLock.ts) keys on, so a locked session stays locked
// server-side even for a copy of its cookie. Logins themselves are checked against
// the machine's own accounts — see systemAuth.ts.

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signingSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "SESSION_SECRET is not set (or shorter than 16 characters) — generate one with `openssl rand -hex 32`",
    );
  }
  return value;
}

function sign(expiresAt: number, user: string, sid: string): string {
  return createHmac("sha256", signingSecret())
    .update(`${expiresAt}.${user}.${sid}`)
    .digest("hex");
}

export function createSessionCookieValue(user: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const sid = randomBytes(16).toString("hex");
  return `${expiresAt}.${user}.${sid}.${sign(expiresAt, user, sid)}`;
}

export type Session = { user: string; sid: string; expiresAt: number };

/** The session behind a cookie, or null if it's missing, expired or forged. */
export function parseSession(value: string | undefined): Session | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [expiresAtRaw, user, sid, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !user || !sid || !signature || Number.isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const a = Buffer.from(signature);
  const b = Buffer.from(sign(expiresAt, user, sid));
  return a.length === b.length && timingSafeEqual(a, b) ? { user, sid, expiresAt } : null;
}

/** The logged-in username, or null if the cookie is missing, expired or forged. */
export function sessionUser(value: string | undefined): string | null {
  return parseSession(value)?.user ?? null;
}

export function isValidSessionCookieValue(value: string | undefined): boolean {
  return sessionUser(value) !== null;
}

// byjohnmichael*
