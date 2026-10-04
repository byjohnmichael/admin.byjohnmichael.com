import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, parseSession } from "@/lib/auth";
import { isLocked } from "@/lib/sessionLock";

// A locked session (idle screen lock) is read-only: it can load pages and GET
// dashboard data, but can't change anything until it's unlocked with the
// password. These stay open so it can unlock, lock again, or sign out.
const LOCKED_OK = new Set(["/api/unlock", "/api/lock", "/api/logout"]);
// GETs that still hand out something live; refuse them while locked.
const LOCKED_DENY = new Set(["/api/bob/auth"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isLocked(session.sid) && !LOCKED_OK.has(pathname)) {
    const readOnly = request.method === "GET" || request.method === "HEAD";
    if (!readOnly || LOCKED_DENY.has(pathname)) {
      return NextResponse.json({ error: "Screen is locked." }, { status: 423 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

// byjohnmichael*
