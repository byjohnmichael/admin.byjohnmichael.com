import { NextResponse } from "next/server";
import { runServiceAction } from "@/lib/serverStatus";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const unit = body?.unit;
  const action = body?.action;

  if (typeof unit !== "string" || typeof action !== "string") {
    return NextResponse.json(
      { error: "unit and action are required." },
      { status: 400 },
    );
  }

  const result = await runServiceAction(unit, action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    deferred: result.deferred ?? false,
    service: result.service ?? null,
  });
}

// byjohnmichael*
