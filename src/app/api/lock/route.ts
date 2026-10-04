import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, parseSession } from "@/lib/auth";
import { lockSession } from "@/lib/sessionLock";

// Locks this session on the server: from now on proxy.ts only lets it read.
// Only /api/unlock (with the password) lifts it.
export async function POST() {
  const session = parseSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  lockSession(session.sid, session.expiresAt);
  return NextResponse.json({ ok: true });
}

// byjohnmichael*
