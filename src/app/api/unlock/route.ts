import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, parseSession } from "@/lib/auth";
import { isLocked, unlockSession } from "@/lib/sessionLock";
import { verifySystemLogin } from "@/lib/systemAuth";
import { checkRateLimit, recordFailure, resetRateLimit } from "@/lib/rateLimit";

// Backs the idle screen lock: GET reports whether this session is locked, POST
// re-checks the signed-in user's password and unlocks it. proxy.ts has already required a valid session cookie.

async function currentSession() {
  return parseSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  return NextResponse.json({ user: session.user, locked: isLocked(session.sid) });
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { user, sid } = session;

  const key = `unlock:${user}`;
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const mins = Math.ceil(limit.retryAfterSec / 60);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let password: unknown;
  try {
    password = (await request.json())?.password;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof password !== "string") {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const result = await verifySystemLogin(user, password);
  if (!result.ok) {
    if (result.reason === "unavailable") {
      return NextResponse.json({ error: result.detail }, { status: 503 });
    }
    recordFailure(key);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  resetRateLimit(key);
  unlockSession(sid);
  return NextResponse.json({ ok: true });
}

// byjohnmichael*
