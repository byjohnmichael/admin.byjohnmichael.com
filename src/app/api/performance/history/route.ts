import { NextResponse } from "next/server";
import { RANGES, queryHistory, type RangeKey } from "@/lib/perfHistory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range") ?? "1d";
  if (!(range in RANGES)) {
    return NextResponse.json({ error: "Unknown range." }, { status: 400 });
  }
  return NextResponse.json(queryHistory(range as RangeKey));
}

// byjohnmichael*
