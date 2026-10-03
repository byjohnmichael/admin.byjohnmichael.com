import { createHmac, timingSafeEqual } from "crypto";

// Signed session cookies. A session is "<expiresAt>.<username>.<hmac>", where
// the HMAC (keyed by SESSION_SECRET) covers both the expiry and the user, so
// neither can be edited client-side. Logins themselves are checked against
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

function sign(expiresAt: number, user: string): string {
  return createHmac("sha256", signingSecret())
    .update(`${expiresAt}.${user}`)
    .digest("hex");
}

export function createSessionCookieValue(user: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${user}.${sign(expiresAt, user)}`;
}

/** The logged-in username, or null if the cookie is missing, expired or forged. */
export function sessionUser(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [expiresAtRaw, user, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !user || !signature || Number.isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const a = Buffer.from(signature);
  const b = Buffer.from(sign(expiresAt, user));
  return a.length === b.length && timingSafeEqual(a, b) ? user : null;
}

export function isValidSessionCookieValue(value: string | undefined): boolean {
  return sessionUser(value) !== null;
}

// byjohnmichael*
