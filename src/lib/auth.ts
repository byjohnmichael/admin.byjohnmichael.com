import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function adminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    throw new Error("ADMIN_PASSWORD is not set");
  }
  return value;
}

// Key used to sign session cookies. Kept separate from ADMIN_PASSWORD so a
// short/simple admin password can't be brute-forced into forging sessions.
// Falls back to ADMIN_PASSWORD only if SESSION_SECRET is unset.
function signingSecret(): string {
  return process.env.SESSION_SECRET || adminPassword();
}

function sign(expiresAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(String(expiresAt))
    .digest("hex");
}

export function createSessionCookieValue(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function isValidSessionCookieValue(value: string | undefined): boolean {
  if (!value) return false;
  const [expiresAtRaw, signature] = value.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAtRaw || !signature || Number.isNaN(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;

  const expected = sign(expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(candidate: string): boolean {
  const expected = adminPassword();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
