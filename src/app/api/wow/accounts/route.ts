import { NextResponse } from "next/server";
import {
  createAccount,
  getPendingAccountRequests,
  removeAccountRequest,
} from "@/lib/wowAccounts";

export async function GET() {
  const requests = await getPendingAccountRequests();
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

  const requests = await getPendingAccountRequests();
  const target = requests.find((r) => r.id === id);
  if (!target) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (action === "accept") {
    const result = await createAccount(target.username, target.salt, target.verifier);
    if (!result.ok) {
      // Leave the request pending so the admin can see it failed and retry.
      return NextResponse.json(
        { error: result.error || "Failed to create account." },
        { status: 502 },
      );
    }
  }

  await removeAccountRequest(id);
  return NextResponse.json({ ok: true });
}

// byjohnmichael*
