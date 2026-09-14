import { NextResponse } from "next/server";
import { getPerfServers, runPerfServerAction } from "@/lib/serverStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ servers: await getPerfServers() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const key = body?.key;
  const action = body?.action;
  if (typeof key !== "string" || typeof action !== "string") {
    return NextResponse.json(
      { error: "key and action are required." },
      { status: 400 },
    );
  }
  const result = await runPerfServerAction(key, action);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

// byjohnmichael*
