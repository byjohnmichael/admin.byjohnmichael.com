import { NextResponse } from "next/server";
import { runRcon, whitelistAddSucceeded } from "@/lib/rcon";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = body?.username;

  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: "Invalid username." }, { status: 400 });
  }

  const result = await runRcon(["whitelist", "add", username]);
  if (!whitelistAddSucceeded(result)) {
    return NextResponse.json(
      { error: result || "Failed to add to whitelist." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, message: result });
}
