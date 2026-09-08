import { NextResponse } from "next/server";
import { runRcon, whitelistAddSucceeded } from "@/lib/rcon";
import { getPendingWhitelistRequests, removeWhitelistRequest } from "@/lib/store";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export async function GET() {
  const requests = await getPendingWhitelistRequests();
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const action = body?.action;

  if (typeof id !== "string") {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  if (action !== "accept" && action !== "deny") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const requests = await getPendingWhitelistRequests();
  const target = requests.find((r) => r.id === id);
  if (!target) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (action === "accept") {
    if (!USERNAME_PATTERN.test(target.username)) {
      return NextResponse.json({ error: "Invalid username." }, { status: 400 });
    }
    const result = await runRcon(["whitelist", "add", target.username]);
    if (!whitelistAddSucceeded(result)) {
      // Leave the request pending so the admin can see it failed and retry.
      return NextResponse.json(
        { error: result || "Failed to whitelist player." },
        { status: 502 },
      );
    }
  }

  await removeWhitelistRequest(id);
  return NextResponse.json({ ok: true });
}
