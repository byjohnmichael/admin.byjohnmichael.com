import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionCookieValue } from "@/lib/auth";
import { verifySystemLogin } from "@/lib/systemAuth";
import {
  checkRateLimit,
  recordFailure,
  resetRateLimit,
} from "@/lib/rateLimit";

/** Best-effort client identifier for rate limiting. With no reverse proxy in
 * front this is usually "unknown" (i.e. a global limiter, which is fine for a
 * single-admin panel). Behind nginx it becomes per-IP automatically. */
function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  const key = clientKey(request);

  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const mins = Math.ceil(limit.retryAfterSec / 60);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let username: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    username = body?.username;
    password = body?.password;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
  }

  const result = await verifySystemLogin(username.trim().toLowerCase(), password);
  if (!result.ok) {
    if (result.reason === "unavailable") {
      // server misconfiguration, not the user's fault — don't count it
      return NextResponse.json({ error: result.detail }, { status: 503 });
    }
    recordFailure(key);
    // same message whether the user doesn't exist, isn't allowed, or typed
    // the wrong password, so the form can't be used to probe accounts
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  resetRateLimit(key);

  const response = NextResponse.json({ ok: true, user: result.user });
  response.cookies.set(SESSION_COOKIE, createSessionCookieValue(result.user), {
    httpOnly: true,
    // Secure whenever the browser reached us over https (directly or via nginx)
    secure:
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}

// byjohnmichael*
