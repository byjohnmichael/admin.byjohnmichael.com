import { NextResponse } from "next/server";
import { adjustMedals } from "@/lib/store";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = body?.username;
  const delta = body?.delta;

  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: "Invalid username." }, { status: 400 });
  }
  if (typeof delta !== "number" || !Number.isInteger(delta)) {
    return NextResponse.json({ error: "Invalid delta." }, { status: 400 });
  }

  const medals = await adjustMedals(username, delta);
  return NextResponse.json({ medals });
}

// byjohnmichael*
