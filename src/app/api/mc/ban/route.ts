import { NextResponse } from "next/server";
import { runRcon } from "@/lib/rcon";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = body?.username;
  const action = body?.action;

  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: "Invalid username." }, { status: 400 });
  }
  if (action !== "ban" && action !== "unban") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  await runRcon([action === "ban" ? "ban" : "pardon", username]);
  return NextResponse.json({ ok: true, banned: action === "ban" });
}

// byjohnmichael*
